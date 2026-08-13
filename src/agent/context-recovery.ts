import type { Agent, AgentMessage } from "@oh-my-pi/pi-agent-core"
import { summaryContextMessage } from "./context-compaction"
import type { AgentDriverEvent } from "./controller"
import { isContextOverflowError } from "./models"

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

/**
 * 本轮是否以上下文超限错误收尾。只需最后一条 assistant 消息是超限错误：
 * 多步回合（工具调用中途）前面可能有成功步骤，若要求全部失败会漏判，
 * 导致超限后静默断掉、要等用户手动发消息才触发压缩。
 */
export function isContextOverflowFailure(messages: readonly AgentMessage[], base: number): boolean {
  const last = appendedAssistantOutcomes(messages, base).at(-1)
  return last?.stopReason === "error" && isContextOverflowError(last.errorMessage ?? "")
}

export type ConversationSummarizer = (messages: readonly AgentMessage[]) => Promise<string>

/** 本轮最后一条 assistant 消息是否因 max tokens 被截断（stopReason = length） */
export function endedOnLengthTruncation(messages: readonly AgentMessage[], base: number): boolean {
  return appendedAssistantOutcomes(messages, base).at(-1)?.stopReason === "length"
}

/** 截断续写次数上限：最多续写 3 次，避免模型失控无限生成 */
export const MAX_LENGTH_CONTINUATIONS = 3

/** 正文伪工具调用的纠正重试上限：防止模型持续输出 XML 标记导致死循环 */
export const MAX_TEXT_TOOLCALL_RETRIES = 2

const TEXT_TOOL_CALL_PATTERN = /<\s*(?:function_calls|invoke\s+name=)/

/**
 * 本轮最后一条 assistant 消息是否把工具调用退化成了正文 XML 标记。
 * 部分 provider/备用模型原生 function calling 不稳时会输出 <function_calls> 文本，
 * 这种"假调用"不会真正执行，会让对话在工具调用处中断。
 */
export function endedOnTextToolCall(messages: readonly AgentMessage[], base: number): boolean {
  const last = messages
    .slice(base)
    .filter((message) => message.role === "assistant")
    .at(-1)
  if (last === undefined) return false
  const stopReason = (last as AssistantOutcome).stopReason
  if (stopReason === "error" || stopReason === "aborted") return false
  return TEXT_TOOL_CALL_PATTERN.test(messageText(last))
}

function messageText(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content
  if (!Array.isArray(content)) return ""
  return content
    .map((part) => {
      const text = (part as { text?: unknown }).text
      return typeof text === "string" ? text : ""
    })
    .join("\n")
}

function textToolCallCorrectionMessage(): AgentMessage {
  return {
    role: "user",
    content: [
      {
        type: "text",
        text: "[系统] 你刚才把工具调用写成了正文里的 XML 标记（如 <function_calls>），这不会真正执行。请改用原生工具调用接口重新发起刚才的调用。",
      },
    ],
    timestamp: Date.now(),
  } as AgentMessage
}

/**
 * 正文伪工具调用的恢复：移除伪调用消息、追加纠正指令后让模型重试。
 * 达到上限仍输出标记则放弃，把原文留给用户可见。
 */
export async function recoverTextToolCallTurn(options: {
  readonly agent: Agent
  readonly base: number
  readonly advanceAfterQuotaFailure: (base: number) => boolean
  readonly onDebug: ((kind: string, fields: Record<string, unknown>) => void) | undefined
}): Promise<void> {
  const { agent, base, advanceAfterQuotaFailure, onDebug } = options
  let attempts = 0
  while (endedOnTextToolCall(agent.state.messages, base) && attempts < MAX_TEXT_TOOLCALL_RETRIES) {
    if (agent.state.messages.at(-1)?.role !== "assistant") return
    attempts++
    onDebug?.("agent_text_toolcall_retry", { attempt: attempts })
    agent.replaceMessages([...agent.state.messages.slice(0, -1), textToolCallCorrectionMessage()])
    await agent.continue()
    while (advanceAfterQuotaFailure(base)) await agent.continue()
  }
}

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
