import type { Agent, AgentEvent, AgentTool } from "@oh-my-pi/pi-agent-core"
import {
  appendedAssistantOutcomes,
  type ConversationSummarizer,
  exclusivelyFailed,
  recoverInterruptedTurn,
} from "./agent-context-recovery"
import type { AgentDriver, AgentDriverEvent } from "./agent-controller"
import type { AgentExtensionRuntime } from "./agent-extensions"
import {
  type AgentModelOption,
  isQuotaExhaustedError,
  parseFallbackModelList,
  resolveModelChain,
} from "./agent-models"
import type { AgentSessionStore } from "./agent-session-store"

export const SYSTEM_PROMPT = [
  "你是 AStockTUI 内置的中文 A 股分析与模拟交易 Agent。所有资金、持仓和成交都属于本地模拟账户，绝不是真实券商订单。",
  "个股分析使用自选行情；大盘、市场情绪、风格或板块分析必须调用 get_market_overview；事件分析调用 get_financial_news，并按需先刷新。必须检查 availability 和 errors，禁止把缺失数据当成零值或编造价格、新闻、仓位及工具结果。",
  "你可以操作行情刷新、自选股、工作区、交易预览、模拟买卖和模拟账户重置。所有操作必须复用工具，不得声称执行了未调用工具的动作。",
  "你可在分析中基于已读取的行情、新闻和持仓数据自主执行本地模拟买卖，不需要请求或等待用户二次确认。执行前可按需调用 preview_trade 检查费用、资金、整手和 T+1 风险；用户指定成交价时，必须将 price 传给 preview_trade 和 execute_trade，按该历史或假设价模拟。",
  "reset_paper_account 只有在用户明确要求重置全部模拟资产时才能调用。不得操作 shell、真实券商或任何项目外接口；读取或编辑用户明确指定的本地复盘文件时，必须调用 read 或 edit 工具，不得声称未调用工具的文件操作。",
  "你可以用 remember_memory 把有价值的规律与操作评估写入长期记忆；记忆会自动注入你的上下文，可通过 replace_memories 一次性整理写回。",
  "用户要求创建、查看、修改、暂停、恢复、删除或立即运行定时任务时，必须调用 manage_scheduled_task 并以工具实际结果回复，不得只用自然语言声称已设置。",
  "回答应给出依据、风险和已执行动作；区分事实、推断与模拟操作，不承诺收益。A 股界面约定红涨绿跌。",
]

export function authorizeAgentTool(toolName: string, input: string): boolean {
  if (toolName !== "reset_paper_account") return true
  return /(重置.*账户|账户.*重置|清空.*账户|reset.*account)/iu.test(input)
}

export class PiAgentDriver implements AgentDriver {
  readonly #agent: Agent
  #models: readonly AgentModelOption[]
  readonly #labels = new Map<string, string>()
  readonly #promptExtras: () => readonly string[]
  readonly #sessionStore: AgentSessionStore | undefined
  readonly #onModelChange: (() => void) | undefined
  readonly #onDebug: ((kind: string, fields: Record<string, unknown>) => void) | undefined
  readonly #contextSummarizer: ConversationSummarizer | undefined
  #extensionSupplement: readonly string[] = []
  #modelIndex = 0
  #emit: ((event: AgentDriverEvent) => void) | null = null
  #currentInput = ""

  constructor(
    agent: Agent,
    models: readonly AgentModelOption[],
    labels: ReadonlyMap<string, string>,
    promptExtras: () => readonly string[],
    sessionStore?: AgentSessionStore,
    onModelChange?: () => void,
    onDebug?: (kind: string, fields: Record<string, unknown>) => void,
    contextSummarizer?: ConversationSummarizer,
  ) {
    this.#agent = agent
    this.#models = models
    this.#promptExtras = promptExtras
    this.#sessionStore = sessionStore
    this.#onModelChange = onModelChange
    this.#onDebug = onDebug
    this.#contextSummarizer = contextSummarizer
    for (const [name, label] of labels) this.#labels.set(name, label)
    this.#agent.subscribe((event) => this.#handleEvent(event))
    this.#agent.beforeToolCall = ({ toolCall }) =>
      authorizeAgentTool(toolCall.name, this.#currentInput)
        ? undefined
        : { block: true, reason: "用户未明确授权当前请求执行该模拟账户操作" }
    this.#agent.setSystemPrompt(this.#composePrompt())
  }

  get modelLabel(): string {
    return this.#models[this.#modelIndex]?.label ?? ""
  }

  /** 当前生效的模型对象，供上下文压缩等旁路调用使用 */
  get activeModel(): AgentModelOption["model"] | undefined {
    return this.#models[this.#modelIndex]?.model
  }

  modelLabels(): readonly string[] {
    return this.#models.map((option) => option.label)
  }

  selectModel(target: string): string {
    const ordinal = Number(target)
    let index =
      Number.isInteger(ordinal) && ordinal >= 1
        ? ordinal - 1
        : this.#models.findIndex((option) => option.label === target)
    if (index < 0 || index >= this.#models.length) {
      const spec = parseFallbackModelList(target)[0]
      if (spec === undefined) throw new Error(`无效模型：${target}`)
      const resolved = resolveModelChain({
        provider: spec.provider,
        modelId: spec.model,
        fallbackSpecs: [],
      })
      const option = resolved.chain[0]
      if (resolved.error !== null || option === undefined)
        throw new Error(resolved.error ?? `模型不存在：${target}`)
      this.#models = [...this.#models, option]
      index = this.#models.length - 1
    }
    if (index === this.#modelIndex) return this.modelLabel
    this.#modelIndex = index
    const option = this.#models[index]
    if (option === undefined) throw new Error(`无效模型：${target}`)
    this.#agent.setModel(option.model)
    this.#onDebug?.("agent_model_switch", { to: option.label })
    this.#onModelChange?.()
    return option.label
  }

  setExtensions(baseTools: readonly AgentTool[], runtime: AgentExtensionRuntime): void {
    const seen = new Set<string>()
    const deduped: string[] = []
    const tools = [...baseTools, ...runtime.getTools()].filter((tool) => {
      if (seen.has(tool.name)) {
        deduped.push(tool.name)
        return false
      }
      seen.add(tool.name)
      return true
    })
    if (deduped.length > 0) this.#onDebug?.("agent_tools_deduped", { names: deduped })
    this.#agent.setTools(tools)
    this.#extensionSupplement = runtime.getSystemPromptSupplement()
    this.#agent.setSystemPrompt(this.#composePrompt())
    this.#labels.clear()
    for (const tool of tools) this.#labels.set(tool.name, tool.label)
  }

  toolLabel(name: string): string {
    return this.#labels.get(name) ?? name
  }

  async run(input: string, emit: (event: AgentDriverEvent) => void): Promise<void> {
    this.#emit = emit
    this.#currentInput = input
    this.#agent.setSystemPrompt(this.#composePrompt())
    try {
      let base = this.#agent.state.messages.length
      this.#onDebug?.("agent_prompt", { model: this.modelLabel, input: input.slice(0, 200) })
      await this.#agent.prompt(input)
      while (this.#advanceAfterQuotaFailure(base)) {
        await this.#agent.continue()
      }
      base = await recoverInterruptedTurn({
        agent: this.#agent,
        base,
        summarizer: this.#contextSummarizer,
        emit: this.#emit,
        advanceAfterQuotaFailure: (attemptBase) => this.#advanceAfterQuotaFailure(attemptBase),
        onDebug: this.#onDebug,
      })
      const fatal = this.#fatalError(base)
      if (fatal !== null) {
        this.#onDebug?.("agent_error", { model: this.modelLabel, error: fatal.message })
        throw fatal
      }
      this.#onDebug?.("agent_run_end", { model: this.modelLabel })
    } finally {
      this.#emit = null
      this.#currentInput = ""
      this.#saveSession()
    }
  }

  #advanceAfterQuotaFailure(base: number): boolean {
    const assistants = appendedAssistantOutcomes(this.#agent.state.messages, base)
    if (!exclusivelyFailed(assistants)) return false
    const exhausted = assistants.some(
      (message) =>
        message.stopReason === "error" && isQuotaExhaustedError(message.errorMessage ?? ""),
    )
    if (!exhausted || this.#modelIndex + 1 >= this.#models.length) return false
    const reason = assistants.find((message) => message.stopReason === "error")?.errorMessage
    this.#agent.replaceMessages(this.#agent.state.messages.slice(0, base + 1))
    this.#modelIndex++
    const next = this.#models[this.#modelIndex]
    if (next === undefined) return false
    const from = this.#models[this.#modelIndex - 1]?.label ?? ""
    this.#agent.setModel(next.model)
    this.#onDebug?.("agent_fallback", { from, to: next.label, reason: reason ?? "" })
    this.#onModelChange?.()
    return true
  }

  #fatalError(base: number): Error | null {
    const assistants = appendedAssistantOutcomes(this.#agent.state.messages, base)
    if (!exclusivelyFailed(assistants)) return null
    const failed = assistants.find(
      (message) => message.stopReason === "error" && message.errorMessage !== undefined,
    )
    return failed === undefined ? null : new Error(failed.errorMessage)
  }

  #composePrompt(): string[] {
    return [...SYSTEM_PROMPT, ...this.#promptExtras(), ...this.#extensionSupplement]
  }

  #saveSession(): void {
    try {
      this.#sessionStore?.save(this.#agent.state.messages)
    } catch {
      // 会话持久化失败不影响对话
    }
  }

  clear(): void {
    this.#agent.clearMessages()
    this.#saveSession()
  }

  abort(): void {
    this.#agent.abort()
  }

  #handleEvent(event: AgentEvent): void {
    const emit = this.#emit
    if (emit === null) return
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      emit({ type: "text_delta", delta: event.assistantMessageEvent.delta })
      return
    }
    if (event.type === "tool_execution_start") {
      emit({
        type: "tool_start",
        id: event.toolCallId,
        name: event.toolName,
        label: this.#labels.get(event.toolName) ?? event.toolName,
      })
      return
    }
    if (event.type === "tool_execution_end") {
      emit({
        type: "tool_end",
        id: event.toolCallId,
        name: event.toolName,
        label: this.#labels.get(event.toolName) ?? event.toolName,
        summary: summarizeToolResult(event.result),
        isError: event.isError === true,
      })
    }
  }
}

function summarizeToolResult(result: unknown): string {
  if (typeof result !== "object" || result === null) return "工具调用完成"
  const content = Reflect.get(result, "content")
  if (!Array.isArray(content)) return "工具调用完成"
  for (const item of content) {
    if (typeof item !== "object" || item === null || Reflect.get(item, "type") !== "text") continue
    const text = Reflect.get(item, "text")
    if (typeof text !== "string") continue
    const compact = text.replace(/\s+/gu, " ").trim()
    if (compact.length > 0) return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact
  }
  return "工具调用完成"
}
