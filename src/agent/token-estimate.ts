import type { AgentMessage } from "@oh-my-pi/pi-agent-core"

/**
 * 字符→token 估算系数（安全方向：宁略高勿低估，高估只让压缩早一点，低估会 400）。
 *
 * 校准（2026-09-03，本地 llama.cpp Qwen3.8-27B 分词器实测）：
 * - 真实 400 请求体 147,348 字符 ↔ 85,779 tokens → 0.582/字符
 * - 会话上下文内容抽样 → 0.60~0.65/字符
 * 旧系数 chars/2（0.5/字符）对 CJK 密集内容低估 15%+，
 * 导致主动压缩漏判窗口、模型调用 400（09-03 10:45 与 11:15 两次事故）。
 */
export const TEXT_TOKENS_PER_CHAR = 0.6

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length * TEXT_TOKENS_PER_CHAR)
}

/**
 * 按字符估算给定消息（含系统提示）的 prompt 大小。
 * 与校准口径一致：真实请求体即消息与系统提示的序列化。
 */
export function estimateMessagesTokens(
  messages: readonly AgentMessage[],
  systemPrompt?: readonly string[],
): number {
  let chars = 0
  for (const part of systemPrompt ?? []) chars += part.length
  for (const message of messages) chars += JSON.stringify(message).length
  return Math.ceil(chars * TEXT_TOKENS_PER_CHAR)
}
