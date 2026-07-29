import type { Agent, AgentMessage } from "@oh-my-pi/pi-agent-core"
import type { AgentDriverEvent } from "./agent-controller"
import { isContextOverflowError } from "./agent-models"

export interface AssistantOutcome {
  readonly stopReason?: string
  readonly errorMessage?: string
}

export function appendedAssistantOutcomes(
  messages: readonly AgentMessage[],
  base: number,
): readonly AssistantOutcome[] {
  return messages
    .slice(base)
    .filter((message) => message.role === "assistant") as readonly AssistantOutcome[]
}

export function exclusivelyFailed(outcomes: readonly AssistantOutcome[]): boolean {
  return (
    outcomes.length > 0 &&
    outcomes.every((message) => message.stopReason === "error" || message.stopReason === "aborted")
  )
}

export function isContextOverflowFailure(messages: readonly AgentMessage[], base: number): boolean {
  const outcomes = appendedAssistantOutcomes(messages, base)
  return (
    exclusivelyFailed(outcomes) &&
    outcomes.some(
      (message) =>
        message.stopReason === "error" && isContextOverflowError(message.errorMessage ?? ""),
    )
  )
}

export type ConversationSummarizer = (messages: readonly AgentMessage[]) => Promise<string>

/** 本轮最后一条 assistant 消息是否因 max tokens 被截断（stopReason = length） */
export function endedOnLengthTruncation(messages: readonly AgentMessage[], base: number): boolean {
  return appendedAssistantOutcomes(messages, base).at(-1)?.stopReason === "length"
}

/** 截断续写次数上限：最多续写 3 次，避免模型失控无限生成 */
export const MAX_LENGTH_CONTINUATIONS = 3

export interface TurnRecoveryOptions {
  readonly agent: Agent
  readonly base: number
  readonly summarizer: ConversationSummarizer | undefined
  readonly emit: ((event: AgentDriverEvent) => void) | null
  readonly advanceAfterQuotaFailure: (base: number) => boolean
  readonly onDebug: ((kind: string, fields: Record<string, unknown>) => void) | undefined
}

/**
 * 一轮对话结束后的恢复编排：上下文超限先压缩/清空重试；
 * 输出被 max tokens 截断则自动续写。返回新的 base 供致命错误判定。
 */
export async function recoverInterruptedTurn(options: TurnRecoveryOptions): Promise<number> {
  const { agent, summarizer, emit, advanceAfterQuotaFailure, onDebug } = options
  let base = options.base
  if (
    isContextOverflowFailure(agent.state.messages, base) &&
    (await compactConversationForRetry(agent, summarizer, emit))
  ) {
    base = 0
    onDebug?.("agent_context_trim", {})
    await agent.continue()
    while (advanceAfterQuotaFailure(base)) await agent.continue()
  }
  let attempts = 0
  while (
    endedOnLengthTruncation(agent.state.messages, base) &&
    attempts < MAX_LENGTH_CONTINUATIONS
  ) {
    attempts++
    onDebug?.("agent_length_continue", { attempt: attempts })
    await agent.continue()
    while (advanceAfterQuotaFailure(base)) await agent.continue()
  }
  return base
}

function summaryContextMessage(summary: string): AgentMessage {
  return {
    role: "user",
    content: [
      {
        type: "text",
        text: `[系统] 以下是较早对话的摘要，仅供上下文参考，无需回复：\n${summary}`,
      },
    ],
    timestamp: Date.now(),
  } as AgentMessage
}

/**
 * 上下文超限时的恢复：优先把较早对话压缩为摘要保留，摘要不可用时才清空历史。
 * 始终保留最新用户消息以便重试；通过工具事件告知用户发生了什么。
 */
export async function compactConversationForRetry(
  agent: Agent,
  summarize: ConversationSummarizer | undefined,
  emit: ((event: AgentDriverEvent) => void) | null,
): Promise<boolean> {
  const messages = agent.state.messages
  let pendingUser: AgentMessage | undefined
  let pendingIndex = -1
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === "user") {
      pendingUser = messages[index]
      pendingIndex = index
      break
    }
  }
  if (pendingUser === undefined) return false
  const older = messages.slice(0, pendingIndex)
  let summary: string | undefined
  if (older.length > 0 && summarize !== undefined) {
    try {
      const trimmed = (await summarize(older)).trim()
      if (trimmed.length > 0) summary = trimmed
    } catch {
      summary = undefined
    }
  }
  agent.replaceMessages(
    summary === undefined ? [pendingUser] : [summaryContextMessage(summary), pendingUser],
  )
  emit?.({
    type: "tool_start",
    id: "context-trim",
    name: "context_trim",
    label: "上下文整理",
  })
  emit?.({
    type: "tool_end",
    id: "context-trim",
    name: "context_trim",
    label: "上下文整理",
    summary:
      summary === undefined
        ? "对话超出模型上下文窗口，已清空较早记录后重试"
        : "对话超出模型上下文窗口，已压缩较早对话为摘要后重试",
    isError: false,
  })
  return true
}
