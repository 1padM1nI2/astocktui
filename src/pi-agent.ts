import { Agent, type AgentEvent, type AgentMessage, type AgentTool } from "@oh-my-pi/pi-agent-core"
import { getEnvApiKey, getEnvApiKeyName } from "@oh-my-pi/pi-ai"
import { type GeneratedProvider, getBundledModel } from "@oh-my-pi/pi-catalog"
import { AgentController, type AgentDriver, type AgentDriverEvent } from "./agent-controller"
import type { AgentExtensionRuntime } from "./agent-extensions"
import { messagesToExchanges } from "./agent-history"
import { AgentSessionStore } from "./agent-session-store"
import { createAStockAgentTools } from "./agent-tools"
import type { CommandContext } from "./commands"
import { ToolCallLogger } from "./tool-call-log"

const SYSTEM_PROMPT = [
  "你是 AStockTUI 内置的中文 A 股分析与模拟交易 Agent。所有资金、持仓和成交都属于本地模拟账户，绝不是真实券商订单。",
  "个股分析使用自选行情；大盘、市场情绪、风格或板块分析必须调用 get_market_overview；事件分析调用 get_financial_news，并按需先刷新。必须检查 availability 和 errors，禁止把缺失数据当成零值或编造价格、新闻、仓位及工具结果。",
  "你可以操作行情刷新、自选股、工作区、交易预览、模拟买卖和模拟账户重置。所有操作必须复用工具，不得声称执行了未调用工具的动作。",
  "你可在分析中基于已读取的行情、新闻和持仓数据自主执行本地模拟买卖，不需要请求或等待用户二次确认。执行前可按需调用 preview_trade 检查费用、资金、整手和 T+1 风险；用户指定成交价时，必须将 price 传给 preview_trade 和 execute_trade，按该历史或假设价模拟。",
  "reset_paper_account 只有在用户明确要求重置全部模拟资产时才能调用。不得操作 shell、真实券商或任何项目外接口；读取或编辑用户明确指定的本地复盘文件时，必须调用 read 或 edit 工具，不得声称未调用工具的文件操作。",
  "你可以用 remember_memory 把有价值的规律与操作评估写入长期记忆；记忆会自动注入你的上下文，闲暇时系统会触发做梦整理，整理后通过 replace_memories 写回。",
  "用户要求创建、查看、修改、暂停、恢复、删除或立即运行定时任务时，必须调用 manage_scheduled_task 并以工具实际结果回复，不得只用自然语言声称已设置。",
  "回答应给出依据、风险和已执行动作；区分事实、推断与模拟操作，不承诺收益。A 股界面约定红涨绿跌。",
]

export interface PiAgentConfig {
  readonly provider?: string
  readonly model?: string
  readonly apiKey?: string
  readonly baseUrl?: string
}

class PiAgentDriver implements AgentDriver {
  readonly #agent: Agent
  readonly #labels = new Map<string, string>()
  readonly #promptExtras: () => readonly string[]
  readonly #sessionStore: AgentSessionStore | undefined
  #extensionSupplement: readonly string[] = []
  #emit: ((event: AgentDriverEvent) => void) | null = null
  #currentInput = ""

  constructor(
    agent: Agent,
    labels: ReadonlyMap<string, string>,
    promptExtras: () => readonly string[],
    sessionStore?: AgentSessionStore,
  ) {
    this.#agent = agent
    this.#promptExtras = promptExtras
    this.#sessionStore = sessionStore
    for (const [name, label] of labels) this.#labels.set(name, label)
    this.#agent.subscribe((event) => this.#handleEvent(event))
    this.#agent.beforeToolCall = ({ toolCall }) =>
      authorizeAgentTool(toolCall.name, this.#currentInput)
        ? undefined
        : { block: true, reason: "用户未明确授权当前请求执行该模拟账户操作" }
    this.#agent.setSystemPrompt(this.#composePrompt())
  }

  setExtensions(baseTools: readonly AgentTool[], runtime: AgentExtensionRuntime): void {
    const tools = [...baseTools, ...runtime.getTools()]
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
      await this.#agent.prompt(input)
    } finally {
      this.#emit = null
      this.#currentInput = ""
      this.#saveSession()
    }
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

class UnavailableAgentDriver implements AgentDriver {
  async run(): Promise<void> {}
  clear(): void {}
  abort(): void {}
}

export function createPiAgentController(
  context: CommandContext,
  config: PiAgentConfig = {},
  extensions?: AgentExtensionRuntime,
): AgentController {
  const provider = config.provider ?? configuredValue("ASTOCK_AGENT_PROVIDER") ?? "openai"
  const modelId = config.model ?? configuredValue("ASTOCK_AGENT_MODEL") ?? "gpt-4o-mini"
  const modelLabel = `${provider}/${modelId}`
  const bundledModel = getBundledModel(provider as GeneratedProvider, modelId)
  if (bundledModel === undefined) {
    return new AgentController(
      new UnavailableAgentDriver(),
      modelLabel,
      `Pi 模型不存在：${modelLabel}`,
    )
  }
  const configuredBaseUrl =
    config.baseUrl ??
    configuredValue("ASTOCK_AGENT_BASE_URL") ??
    (provider === "openai" ? configuredValue("OPENAI_BASE_URL") : undefined)
  let model: typeof bundledModel
  try {
    model = withAgentBaseUrl(bundledModel, configuredBaseUrl)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return new AgentController(new UnavailableAgentDriver(), modelLabel, reason)
  }

  const apiKey = config.apiKey ?? getEnvApiKey(provider)
  const apiKeyName = getEnvApiKeyName(provider)
  const configurationError =
    apiKeyName !== undefined && apiKey === undefined ? `未配置 ${apiKeyName}` : undefined
  const configuredApiKey = config.apiKey
  const tools = createAStockAgentTools(context)
  const sessionStore = new AgentSessionStore()
  const restoredMessages = sessionStore.load().state.messages
  const agent = new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model,
      tools: [...tools],
      ...(restoredMessages.length === 0
        ? {}
        : { messages: [...restoredMessages] as AgentMessage[] }),
    },
    ...(configuredApiKey === undefined ? {} : { getApiKey: () => configuredApiKey }),
    hideThinkingSummary: true,
  })
  const toolCallLog = new ToolCallLogger()
  agent.subscribe((event) => {
    if (event.type === "tool_execution_start") {
      toolCallLog.recordStart({ id: event.toolCallId, name: event.toolName, args: event.args })
      return
    }
    if (event.type === "tool_execution_end") {
      toolCallLog.recordEnd({
        id: event.toolCallId,
        name: event.toolName,
        isError: event.isError === true,
        result: event.result,
      })
    }
  })
  const driver = new PiAgentDriver(
    agent,
    new Map(tools.map((tool) => [tool.name, tool.label])),
    () => context.memory?.().promptSupplement() ?? [],
    sessionStore,
  )
  const restoredHistory = messagesToExchanges(restoredMessages as AgentMessage[], (name) =>
    driver.toolLabel(name),
  )
  if (extensions !== undefined) {
    const sync = () => driver.setExtensions(tools, extensions)
    extensions.subscribe(sync)
    sync()
  }
  return new AgentController(driver, modelLabel, configurationError, restoredHistory)
}

export function withAgentBaseUrl<TModel extends { readonly baseUrl: string }>(
  model: TModel,
  baseUrl: string | undefined,
): TModel {
  if (baseUrl === undefined) return model
  let parsed: URL
  try {
    parsed = new URL(baseUrl.trim())
  } catch {
    throw new Error(`Agent Base URL 无效：${baseUrl}`)
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Agent Base URL 仅支持 HTTP 或 HTTPS：${baseUrl}`)
  }
  const normalized = parsed.toString().replace(/\/+$/u, "")
  return { ...model, baseUrl: normalized }
}

export function authorizeAgentTool(toolName: string, input: string): boolean {
  if (toolName !== "reset_paper_account") return true
  return /(重置.*账户|账户.*重置|清空.*账户|reset.*account)/iu.test(input)
}

function configuredValue(name: string): string | undefined {
  const value = Reflect.get(Bun.env, name)
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
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
