import type { Agent, AgentEvent, AgentTool } from "@oh-my-pi/pi-agent-core"
import {
  appendedAssistantOutcomes,
  type ConversationSummarizer,
  recoverInterruptedTurn,
  recoverTextToolCallTurn,
} from "./context-recovery"
import type { AgentDriver, AgentDriverEvent } from "./controller"
import type { AgentExtensionRuntime } from "./extensions"
import {
  type AgentModelOption,
  decidePrimaryRevert,
  isQuotaExhaustedError,
  resolveModelTarget,
} from "./models"
import { authorizeAgentTool, SYSTEM_PROMPT } from "./pi-agent-prompt"
import type { AgentSessionStore } from "./session-store"
import {
  DEFAULT_THINKING_LEVEL,
  parseThinkingLevel,
  resolveThinkingEffort,
  THINKING_LEVELS,
  type ThinkingLevelName,
} from "./thinking"
import { summarizeToolResult } from "./tool-result-summary"

export { authorizeAgentTool, SYSTEM_PROMPT }

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
    const resolution = resolveModelTarget(this.#models, target)
    if ("error" in resolution) throw new Error(resolution.error)
    this.#models = resolution.models
    // 手动选择生效即视为用户接管，取消额度回退的自动回切
    this.#quotaFellBackAt = null
    if (resolution.index === this.#modelIndex) return this.modelLabel
    this.#modelIndex = resolution.index
    const option = this.#models[resolution.index]
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
    const revert = decidePrimaryRevert(this.#modelIndex, this.#quotaFellBackAt, this.#models)
    if (revert.clear) this.#quotaFellBackAt = null
    if (revert.primary !== undefined) {
      this.#modelIndex = 0
      this.#agent.setModel(revert.primary.model)
      this.#onDebug?.("agent_fallback_retry", { to: revert.primary.label })
      this.#onModelChange?.()
    }
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
      await recoverTextToolCallTurn({
        agent: this.#agent,
        base,
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
    // 与上下文超限同理：多步回合前面可能有成功步骤，只看末条是否额度耗尽
    const last = appendedAssistantOutcomes(this.#agent.state.messages, base).at(-1)
    if (last?.stopReason !== "error" || !isQuotaExhaustedError(last.errorMessage ?? "")) {
      return false
    }
    if (this.#modelIndex + 1 >= this.#models.length) return false
    this.#agent.replaceMessages(this.#agent.state.messages.slice(0, base + 1))
    this.#modelIndex++
    this.#quotaFellBackAt = Date.now()
    const next = this.#models[this.#modelIndex]
    if (next === undefined) return false
    const from = this.#models[this.#modelIndex - 1]?.label ?? ""
    this.#agent.setModel(next.model)
    this.#onDebug?.("agent_fallback", { from, to: next.label, reason: last.errorMessage ?? "" })
    this.#onModelChange?.()
    return true
  }

  #fatalError(base: number): Error | null {
    // 回合以错误收尾即视为失败（多步回合前面可能有成功步骤）；aborted 不算
    const last = appendedAssistantOutcomes(this.#agent.state.messages, base).at(-1)
    if (last?.stopReason !== "error" || last.errorMessage === undefined) return null
    return new Error(last.errorMessage)
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
