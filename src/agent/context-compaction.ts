import type { Agent, AgentMessage } from "@oh-my-pi/pi-agent-core"
import type { ConversationSummarizer } from "./context-recovery"
import type { AgentDriverEvent } from "./controller"
import { usageFromMessage } from "./usage-stats"

/** 主动压缩阈值：prompt token 达到窗口 × 0.85 即在下轮前压缩（对齐 Reasonix compact_ratio 默认） */
export const PROACTIVE_COMPACT_RATIO = 0.85

/**
 * 估算当前对话的 prompt token：优先最后一条 assistant 的真实 usage
 * （DeepSeek 返回 prompt_cache_hit/miss_tokens，input + cacheRead + cacheWrite 即上一轮 prompt 总量）；
 * 会话刚恢复等无 usage 场景按内容字符数粗估兜底。
 */
export function estimatePromptTokens(messages: readonly AgentMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message === undefined) continue
    const usage = usageFromMessage(message)
    if (usage !== undefined) return usage.input + usage.cacheRead + usage.cacheWrite
  }
  let chars = 0
  for (const message of messages) chars += JSON.stringify(message).length
  return Math.ceil(chars / 2)
}

/** 是否应在下一轮前主动压缩；窗口未知时不触发，保留超限重试兜底 */
export function shouldProactiveCompact(
  messages: readonly AgentMessage[],
  contextWindow: number | null | undefined,
): boolean {
  if (contextWindow === null || contextWindow === undefined || contextWindow <= 0) return false
  return estimatePromptTokens(messages) >= Math.floor(contextWindow * PROACTIVE_COMPACT_RATIO)
}

/** 较早对话摘要包装为一条 user 消息；role 取 user 是为了让模型把它当背景资料而不是自己的话 */
export function summaryContextMessage(summary: string): AgentMessage {
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
 * 主动压缩：下一轮前把最近一个完整回合之前的对话压缩为摘要，最近回合原文保留。
 * 与超限重试不同，此时没有待重试的用户消息，回合内 assistant/tool 消息不丢；
 * 摘要不可用时不改动历史，保留超限重试作为兜底。
 */
export async function compactConversation(
  agent: Agent,
  summarize: ConversationSummarizer | undefined,
  emit: ((event: AgentDriverEvent) => void) | null,
): Promise<boolean> {
  const messages = agent.state.messages
  let tailIndex = -1
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === "user") {
      tailIndex = index
      break
    }
  }
  // tailIndex <= 0：没有更早内容可压缩（0 说明最早的消息就是最近回合起点）
  if (tailIndex <= 0 || summarize === undefined) return false
  const older = messages.slice(0, tailIndex)
  let summary: string
  try {
    summary = (await summarize(older)).trim()
  } catch {
    return false
  }
  if (summary.length === 0) return false
  agent.replaceMessages([summaryContextMessage(summary), ...messages.slice(tailIndex)])
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
    summary: "上下文接近窗口上限，已压缩较早对话为摘要",
    isError: false,
  })
  return true
}
