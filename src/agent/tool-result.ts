import type { AgentToolResult } from "@oh-my-pi/pi-agent-core"

/**
 * 工具结果进入上下文的可见文本上限（对齐 Reasonix 的 32KB 入口约束）。
 * 超大结果只在首次进入模型时截断一次，历史消息之后绝不改写，保住前缀缓存。
 */
export const TOOL_RESULT_TEXT_MAX = 32 * 1024

/** 统一的 JSON 工具结果：content 为模型可见文本（超限截断），details 始终保留完整数据供界面与日志使用 */
export function jsonToolResult(value: unknown): AgentToolResult<unknown> {
  const text = JSON.stringify(value)
  const visible =
    text.length <= TOOL_RESULT_TEXT_MAX
      ? text
      : `${text.slice(0, TOOL_RESULT_TEXT_MAX)}…[结果过大已截断，完整 ${text.length} 字符]`
  return { content: [{ type: "text", text: visible }], details: value }
}
