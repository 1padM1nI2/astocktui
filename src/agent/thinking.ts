import type { Effort } from "@oh-my-pi/pi-ai"

export const DEFAULT_THINKING_LEVEL = "default"

export const THINKING_LEVELS = [
  DEFAULT_THINKING_LEVEL,
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const

export type ThinkingLevelName = (typeof THINKING_LEVELS)[number]

export function parseThinkingLevel(target: string): ThinkingLevelName {
  const normalized = target.trim().toLowerCase()
  const match = THINKING_LEVELS.find((level) => level === normalized)
  if (match === undefined) {
    throw new Error(`无效思考等级：${target}（可选 ${THINKING_LEVELS.join("、")}）`)
  }
  return match
}

/** default 表示不设置、跟随模型/提供商默认行为 */
export function resolveThinkingEffort(name: ThinkingLevelName): Effort | undefined {
  return name === DEFAULT_THINKING_LEVEL ? undefined : (name as Effort)
}
