import type { Agent, AgentEvent, AgentTool } from "@oh-my-pi/pi-agent-core"
import { compactConversation, shouldProactiveCompact } from "./context-compaction"
import {
  appendedAssistantOutcomes,
  type ConversationSummarizer,
  isTransientContinuationMessage,
  recoverInterruptedTurn,
  recoverTextToolCallTurn,
} from "./context-recovery"
import type { AgentDriver, AgentDriverEvent } from "./controller"
import type { AgentExtensionRuntime } from "./extensions"
import { type AgentModelOption, isQuotaExhaustedError, ModelChainCursor } from "./models"
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
import { installTurnBoundaryCompaction } from "./turn-compact"
import { AgentUsageTracker } from "./usage-stats"

export { authorizeAgentTool, SYSTEM_PROMPT }

export class PiAgentDriver implements AgentDriver {
  readonly #agent: Agent
  readonly #chain: ModelChainCursor
  readonly #labels = new Map<string, string>()
  readonly #promptExtras: () => readonly string[]
  readonly #sessionStore: AgentSessionStore | undefined
  readonly #onDebug: ((kind: string, fields: Record<string, unknown>) => void) | undefined
  readonly #contextSummarizer: ConversationSummarizer | undefined
  readonly #usage = new AgentUsageTracker()
  #extensionSupplement: readonly string[] = []
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
    this.#promptExtras = promptExtras
    this.#sessionStore = sessionStore
    this.#onDebug = onDebug
    this.#contextSummarizer = contextSummarizer
    this.#chain = new ModelChainCursor(models, { onDebug, onModelChange })
    for (const [name, label] of labels) this.#labels.set(name, label)
    this.#agent.subscribe((event) => this.#handleEvent(event))
    this.#agent.beforeToolCall = ({ toolCall }) =>
      authorizeAgentTool(toolCall.name, this.#currentInput)
        ? undefined
        : { block: true, reason: "用户未明确授权当前请求执行该模拟账户操作" }
    this.#agent.setSystemPrompt(this.#composePrompt())
    // 长工具回合中途释放工具原文，避免单轮内累积超过模型窗口（400 超限）
    installTurnBoundaryCompaction({
      agent,
      getModel: () => this.#chain.current?.model,
      getSystemPrompt: () => this.#agent.state.systemPrompt,
      getSummarizer: () => this.#contextSummarizer,
      onDebug: this.#onDebug,
      onEvent: (event) => this.#emit?.(event),
    })
  }

  get modelLabel(): string {
    return this.#chain.currentLabel
  }

  /** 当前生效的模型对象，供上下文压缩等旁路调用使用 */
  get activeModel(): AgentModelOption["model"] | undefined {
    return this.#chain.current?.model
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
    return this.#chain.labels()
  }

  selectModel(target: string): string {
    return this.#chain.select(this.#agent, target)
  }

  usageSummary(): string {
    return this.#usage.summary()
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
    this.#chain.revertToPrimaryIfDue(this.#agent)
    this.#agent.setSystemPrompt(this.#composePrompt())
    // 临时续写指令只在当轮有效：新一轮开始前清除残留
    this.#agent.replaceMessages(
      this.#agent.state.messages.filter((message) => !isTransientContinuationMessage(message)),
    )
    await this.#compactProactively(emit)
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

  /**
   * 上下文接近窗口上限时主动压缩，避免一次注定超限失败的全价请求
   * （DeepSeek 按 prompt 未命中部分全价计费，超限重试等于浪费一整轮输入）。
   */
  async #compactProactively(emit: (event: AgentDriverEvent) => void): Promise<void> {
    const contextWindow = this.#chain.current?.model.contextWindow
    const systemPrompt = this.#agent.state.systemPrompt
    if (!shouldProactiveCompact(this.#agent.state.messages, contextWindow, systemPrompt)) return
    if (await compactConversation(this.#agent, this.#contextSummarizer, emit)) {
      this.#onDebug?.("agent_context_compact", { contextWindow })
    }
  }

  #advanceAfterQuotaFailure(base: number): boolean {
    // 与上下文超限同理：多步回合前面可能有成功步骤，只看末条是否额度耗尽
    const last = appendedAssistantOutcomes(this.#agent.state.messages, base).at(-1)
    if (last?.stopReason !== "error" || !isQuotaExhaustedError(last.errorMessage ?? "")) {
      return false
    }
    if (!this.#chain.hasNext) return false
    this.#agent.replaceMessages(this.#agent.state.messages.slice(0, base + 1))
    return this.#chain.advanceToFallback(this.#agent, last.errorMessage ?? "") !== undefined
  }

  #fatalError(base: number): Error | null {
    // 回合以错误收尾即视为失败（多步回合前面可能有成功步骤）；aborted 不算
    const last = appendedAssistantOutcomes(this.#agent.state.messages, base).at(-1)
    if (last?.stopReason !== "error" || last.errorMessage === undefined) return null
    return new Error(last.errorMessage)
  }

  // 稳定内容在前、易变内容在后：记忆每次变化只使尾部失效，保住 SYSTEM_PROMPT 与扩展前缀的缓存
  #composePrompt(): string[] {
    return [...SYSTEM_PROMPT, ...this.#extensionSupplement, ...this.#promptExtras()]
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
    this.#usage.reset()
    this.#saveSession()
  }

  abort(): void {
    this.#agent.abort()
  }

  #handleEvent(event: AgentEvent): void {
    if (event.type === "message_end") {
      const usage = this.#usage.track(event.message)
      if (usage !== undefined) this.#onDebug?.("agent_usage", usage)
    }
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
