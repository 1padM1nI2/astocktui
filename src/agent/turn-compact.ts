import type { Agent, AgentMessage } from "@oh-my-pi/pi-agent-core"
import { PROACTIVE_COMPACT_RATIO } from "./context-compaction"
import type { ConversationSummarizer } from "./context-recovery"
import { isTransientContinuationMessage } from "./context-recovery"
import type { AgentDriverEvent } from "./controller"
import { TOOL_RESULT_TEXT_MAX } from "./tool-result"
import { estimateMessagesTokens } from "./token-estimate"

/**
 * 回合边界（onTurnEnd）的上下文估算。
 * usage 估算（estimatePromptTokens）滞后一个回合：最后一条 assistant 的 usage
 * 是上一轮请求的 prompt 量，不含刚追加的本轮工具结果，长工具回合里必然漏判。
 * 这里对系统提示加全部消息按字符数估算（本地分词器校准 0.6/字符，见 token-estimate），
 * 与真实请求量同量级且无滞后，达到触发阈值时提前释放本轮工具原文。
 */
export function estimateTurnBoundaryTokens(
  messages: readonly AgentMessage[],
  systemPrompt: readonly string[] | undefined,
): number {
  return estimateMessagesTokens(messages, systemPrompt)
}

/** 当前回合边界是否应压缩：估算达到窗口 85% 触发（与主动压缩同阈值） */
export function shouldCompactAtTurnBoundary(
  messages: readonly AgentMessage[],
  systemPrompt: readonly string[] | undefined,
  contextWindow: number | null | undefined,
): boolean {
  if (contextWindow === null || contextWindow === undefined || contextWindow <= 0) return false
  return (
    estimateTurnBoundaryTokens(messages, systemPrompt) >=
    Math.floor(contextWindow * PROACTIVE_COMPACT_RATIO)
  )
}

/**
 * 当前回合压缩：把待处理用户消息之后的 assistant/工具消息（连同更早回合）
 * 整体摘要，释放原工具结果，把循环的实时消息数组原地替换为 [摘要, 用户消息]，
 * 让模型基于摘要继续任务而不必重复已完成的工具调用。
 *
 * 只 mutate 循环传入的实时数组：Agent 状态与会话持久化不受影响
 * （完整历史仍由 message_end 事件回放落盘）。
 */
export async function compactCurrentTurn(options: {
  readonly messages: AgentMessage[]
  readonly summarize: ConversationSummarizer
  readonly contextWindow?: number | null | undefined
  readonly onEvent?: ((event: AgentDriverEvent) => void) | undefined
  readonly onDebug?: ((kind: string, fields: Record<string, unknown>) => void) | undefined
}): Promise<boolean> {
  const { messages, summarize, contextWindow, onEvent, onDebug } = options
  let pendingUser: AgentMessage | undefined
  let pendingIndex = -1
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role === "user" && !isTransientContinuationMessage(message)) {
      pendingUser = message
      pendingIndex = index
      break
    }
  }
  if (pendingUser === undefined || pendingIndex < 0) return false
  const older = messages.slice(0, pendingIndex)
  const currentTurn = messages.slice(pendingIndex + 1)
  if (currentTurn.length === 0) return false
  const target = older.length > 0 ? [...older, ...currentTurn] : currentTurn
  const summaryTarget = shrinkTargetToFit(target, contextWindow)
  onEvent?.({
    type: "tool_start",
    id: "context-compact",
    name: "context_compact",
    label: "上下文整理",
  })
  let summary: string
  try {
    summary = (await summarize(summaryTarget)).trim()
  } catch {
    onEvent?.({
      type: "tool_end",
      id: "context-compact",
      name: "context_compact",
      label: "上下文整理",
      summary: "压缩摘要失败，保留原文继续",
      isError: true,
    })
    return false
  }
  if (summary.length === 0) {
    onEvent?.({
      type: "tool_end",
      id: "context-compact",
      name: "context_compact",
      label: "上下文整理",
      summary: "压缩摘要为空，保留原文继续",
      isError: true,
    })
    return false
  }
  const summaryMessage = {
    role: "user",
    content: [
      {
        type: "text",
        text: `[系统] 以下是当前任务截至本回合的对话与工具结果摘要（原文已释放以控制上下文）：\n${summary}\n请基于该摘要继续完成任务，不要重复已完成且摘要中已记录结果的工具调用。`,
      },
    ],
    timestamp: Date.now(),
  } as AgentMessage
  const releasedChars = target.reduce((sum, message) => sum + JSON.stringify(message).length, 0)
  messages.splice(0, messages.length, summaryMessage, pendingUser)
  onDebug?.("agent_context_compact_mid_turn", {
    summarizedMessages: target.length,
    releasedChars,
    summaryChars: summary.length,
  })
  onEvent?.({
    type: "tool_end",
    id: "context-compact",
    name: "context_compact",
    label: "上下文整理",
    summary: `上下文接近窗口上限，已把 ${target.length} 条消息压缩为摘要后继续`,
    isError: false,
  })
  return true
}

/** 摘要请求自身也要装进窗口：目标估算超限时，对副本里的可见文本逐档截断（原数组不改写） */
function shrinkTargetToFit(
  target: readonly AgentMessage[],
  contextWindow: number | null | undefined,
): readonly AgentMessage[] {
  if (contextWindow === null || contextWindow === undefined || contextWindow <= 0) return target
  const limit = Math.floor(contextWindow * PROACTIVE_COMPACT_RATIO)
  let result = target
  let cap = TOOL_RESULT_TEXT_MAX
  while (estimateTurnBoundaryTokens(result, []) >= limit && cap > 2048) {
    cap = Math.max(2048, Math.floor(cap / 2))
    result = shrinkVisibleText(result, cap)
  }
  return result
}

/** 把消息里超过 cap 的文本部件截断（返回新消息对象，输入数组与消息不被改写） */
function shrinkVisibleText(
  messages: readonly AgentMessage[],
  cap: number,
): readonly AgentMessage[] {
  let changed = false
  const next = messages.map((message) => {
    const content = (message as { content?: unknown }).content
    if (!Array.isArray(content)) return message
    let messageChanged = false
    const parts = content.map((part: unknown) => {
      const record = part as { type?: unknown; text?: unknown }
      if (record.type === "text" && typeof record.text === "string" && record.text.length > cap) {
        messageChanged = true
        return { ...record, text: `${record.text.slice(0, cap)}…[摘要前截断]` }
      }
      return part
    })
    if (messageChanged) {
      changed = true
      return { ...(message as object), content: parts } as AgentMessage
    }
    return message
  })
  return changed ? next : messages
}

export interface TurnBoundaryCompactionOptions {
  readonly agent: Agent
  readonly getModel: () => { readonly contextWindow?: number | null } | undefined
  readonly getSystemPrompt: () => readonly string[] | undefined
  readonly getSummarizer: () => ConversationSummarizer | undefined
  readonly onDebug?: ((kind: string, fields: Record<string, unknown>) => void) | undefined
  readonly onEvent?: ((event: AgentDriverEvent) => void) | undefined
}

/**
 * 订阅 agent 的 onTurnEnd 钩子实现回合内压缩：
 * 只在循环继续的回合边界（willContinue，即工具执行完、下一轮模型调用前）
 * 且估算达到窗口 85% 时释放本轮工具原文。
 * 任何异常都不抛出，兜底交给既有的上下文超限重试路径。
 */
export function installTurnBoundaryCompaction(options: TurnBoundaryCompactionOptions): void {
  options.agent.setOnTurnEnd(async (messages, signal, context) => {
    if (context?.willContinue !== true || signal?.aborted === true) return
    const summarize = options.getSummarizer()
    if (summarize === undefined) return
    if (
      !shouldCompactAtTurnBoundary(
        messages,
        options.getSystemPrompt(),
        options.getModel()?.contextWindow,
      )
    )
      return
    try {
      await compactCurrentTurn({
        messages,
        summarize,
        contextWindow: options.getModel()?.contextWindow,
        onEvent: options.onEvent,
        onDebug: options.onDebug,
      })
    } catch {
      // 压缩失败不影响主循环；下一轮请求若超限由既有重试路径兜底
    }
  })
}
