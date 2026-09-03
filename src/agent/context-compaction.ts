import type { Agent, AgentMessage } from "@oh-my-pi/pi-agent-core"
import type { ConversationSummarizer } from "./context-recovery"
import type { AgentDriverEvent } from "./controller"
import { usageFromMessage } from "./usage-stats"
import { estimateMessagesTokens } from "./token-estimate"

/** 主动压缩阈值：prompt token 达到窗口 × 0.70 即在下轮前压缩（预留 30% 缓冲吸收估算误差，宁早勿顶穿窗口） */
export const PROACTIVE_COMPACT_RATIO = 0.7

/**
 * 估算当前对话的 prompt token：取"最后一条 assistant 的真实 usage"与
 * "当前内容字符估算"（token-estimate，本地分词器校准 0.6/字符）的较大者。
 * - usage 最准，但只反映上一次模型调用，比当前上下文滞后一个回合
 *   （09-03 10:45 400：usage 51,656 < 阈值 55,705，实际上下文 85,779）；
 * - 零 usage（如纯思考 stop 响应）按缺失处理并继续向前找，
 *   否则估算被钉死在 0（09-03 11:15 400）。
 */
export function estimatePromptTokens(
  messages: readonly AgentMessage[],
  systemPrompt?: readonly string[],
): number {
  let usageEstimate = 0
  let hasUsage = false
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message === undefined) continue
    const usage = usageFromMessage(message)
    if (usage === undefined) continue
    const total = usage.input + usage.cacheRead + usage.cacheWrite
    if (total <= 0) continue
    usageEstimate = total
    hasUsage = true
    break
  }
  return Math.max(hasUsage ? usageEstimate : 0, estimateMessagesTokens(messages, systemPrompt))
}

/** 是否应在下一轮前主动压缩；窗口未知时不触发，保留超限重试兜底 */
export function shouldProactiveCompact(
  messages: readonly AgentMessage[],
  contextWindow: number | null | undefined,
  systemPrompt?: readonly string[],
): boolean {
  if (contextWindow === null || contextWindow === undefined || contextWindow <= 0) return false
  return (
    estimatePromptTokens(messages, systemPrompt) >=
    Math.floor(contextWindow * PROACTIVE_COMPACT_RATIO)
  )
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
