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
import {
  DEFAULT_THINKING_LEVEL,
  parseThinkingLevel,
  resolveThinkingEffort,
  THINKING_LEVELS,
  type ThinkingLevelName,
} from "./agent-thinking"
import { authorizeAgentTool, SYSTEM_PROMPT } from "./pi-agent-prompt"
import { summarizeToolResult } from "./tool-result-summary"

export { authorizeAgentTool, SYSTEM_PROMPT }

/** 额度回退后重新尝试主模型的间隔（额度通常按数小时窗口重置） */
export const FALLBACK_RETRY_MS = 60 * 60 * 1000

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
  /** 额度耗尽触发回退的时间戳；手动切换模型会清除 */
  #quotaFellBackAt: number | null = null
  #thinkingLevel: ThinkingLevelName = DEFAULT_THINKING_LEVEL
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

  get thinkingLevel(): string {
    return this.#thinkingLevel
  }

  thinkingLevels(): readonly string[] {
    return THINKING_LEVELS
  }

  setThinkingLevel(target: string): string {
    const level = parseThinkingLevel(target)
    this.#thinkingLevel = level
    this.#agent.setThinkingLevel(resolveThinkingEffort(level))
    this.#onDebug?.("agent_thinking_level", { level })
    this.#saveSession()
    return level
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
    // 手动选择生效即视为用户接管，取消额度回退的自动回切
    this.#quotaFellBackAt = null
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
    this.#maybeRevertToPrimary()
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

  /** 回退满一个重试间隔后，在下一次运行时切回主模型；若仍限流会再次自动回退 */
  #maybeRevertToPrimary(): void {
    if (this.#quotaFellBackAt === null) return
    if (this.#modelIndex === 0) {
      this.#quotaFellBackAt = null
      return
    }
    if (Date.now() - this.#quotaFellBackAt < FALLBACK_RETRY_MS) return
    this.#quotaFellBackAt = null
    this.#modelIndex = 0
    const primary = this.#models[0]
    if (primary === undefined) return
    this.#agent.setModel(primary.model)
    this.#onDebug?.("agent_fallback_retry", { to: primary.label })
    this.#onModelChange?.()
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
    this.#quotaFellBackAt = Date.now()
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
      this.#sessionStore?.save(this.#agent.state.messages, {
        thinkingLevel: this.#thinkingLevel,
      })
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
