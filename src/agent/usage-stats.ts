import type { AgentMessage } from "@oh-my-pi/pi-agent-core"
import type { Usage } from "@oh-my-pi/pi-ai"

/** Agent 会话累计 token 用量与缓存命中统计（DeepSeek prompt_cache_hit_tokens 映射为 cacheRead） */
export interface UsageStats {
  readonly steps: number
  /** 累计 prompt token（input + cacheRead + cacheWrite），即计费输入总量 */
  readonly promptTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  /** 缓存命中率 cacheRead / prompt；尚无 prompt 时为 null */
  readonly cacheHitRate: number | null
}

export function createUsageStats(): UsageStats {
  return {
    steps: 0,
    promptTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheHitRate: null,
  }
}

export function recordStepUsage(stats: UsageStats, usage: Usage): UsageStats {
  const promptTokens = stats.promptTokens + usage.input + usage.cacheRead + usage.cacheWrite
  const cacheReadTokens = stats.cacheReadTokens + usage.cacheRead
  return {
    steps: stats.steps + 1,
    promptTokens,
    outputTokens: stats.outputTokens + usage.output,
    cacheReadTokens,
    cacheWriteTokens: stats.cacheWriteTokens + usage.cacheWrite,
    cacheHitRate: promptTokens > 0 ? cacheReadTokens / promptTokens : null,
  }
}

function formatTokens(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value)
}

/** 一行摘要，如「缓存命中 75% · 输入 16.0k · 输出 1.0k · 2 步」；无数据返回空串 */
export function formatUsageSummary(stats: UsageStats): string {
  if (stats.steps === 0) return ""
  const hit =
    stats.cacheHitRate === null ? "缓存命中 —" : `缓存命中 ${Math.round(stats.cacheHitRate * 100)}%`
  return `${hit} · 输入 ${formatTokens(stats.promptTokens)} · 输出 ${formatTokens(stats.outputTokens)} · ${stats.steps} 步`
}

/** 从消息提取有效 usage；错误或中止的 assistant 消息 usage 不可信，返回 undefined */
export function usageFromMessage(message: AgentMessage): Usage | undefined {
  if (message.role !== "assistant") return undefined
  if (message.stopReason === "error" || message.stopReason === "aborted") return undefined
  return message.usage
}

/** 会话级 usage 跟踪器：逐条消息累计，供 debug 事件与界面摘要共用 */
export class AgentUsageTracker {
  #stats: UsageStats = createUsageStats()

  get stats(): UsageStats {
    return this.#stats
  }

  summary(): string {
    return formatUsageSummary(this.#stats)
  }

  reset(): void {
    this.#stats = createUsageStats()
  }

  /** 记录一条消息；有效时返回本步 debug 字段（含累计命中率），无效返回 undefined */
  track(
    message: AgentMessage,
  ): { input: number; output: number; cacheRead: number; hitRate: number | null } | undefined {
    const usage = usageFromMessage(message)
    if (usage === undefined) return undefined
    this.#stats = recordStepUsage(this.#stats, usage)
    return {
      input: usage.input,
      output: usage.output,
      cacheRead: usage.cacheRead,
      hitRate: this.#stats.cacheHitRate,
    }
  }
}
