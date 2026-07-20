import {
  isAshareWeekday,
  isContinuousAuction,
  parseShanghaiTimeMinutes,
  shanghaiDateTime,
} from "./trading-calendar"

export interface ScheduledTaskTicker {
  tick(now: Date): void
}

export type AgentTaskKind = "preopen" | "intraday" | "condition" | "dream" | "custom"

export interface AgentSystemEvent {
  readonly kind: AgentTaskKind
  readonly dedupeKey: string
  readonly title: string
  readonly prompt: string
  readonly createdAt: string
  readonly taskId?: string
  readonly taskName?: string
  readonly source?: "user" | "agent"
}

export interface AgentEventSink {
  enqueue(event: AgentSystemEvent): "queued" | "deduped"
}

export interface AutomationTimer {
  setInterval(callback: () => void, intervalMs: number): unknown
  clearInterval(handle: unknown): void
}

export interface AgentAutomationSettings {
  readonly enabled: boolean
  readonly preopenTime: string
  readonly intradayIntervalMinutes: number
  readonly dreamIdleMinutes: number
}

const DEFAULT_SETTINGS: AgentAutomationSettings = {
  enabled: true,
  preopenTime: "08:45",
  intradayIntervalMinutes: 5,
  dreamIdleMinutes: 30,
}

const DREAM_PROMPT =
  "[记忆整理·做梦] 现在是闲暇时段。请整理你的长期记忆：" +
  "1. 调用 list_memories 读取全部记忆（系统成交评估与你记录的规律）。" +
  "2. 梳理：合并重复或相似的规律；把多条同类操作评估归纳为更通用的规律（保留关键数据）；删除已被证伪、过时或空泛的条目。" +
  "3. 调用 replace_memories 一次性写回整理后的完整列表（仍有效条目保留 id，新归纳条目不带 id）。" +
  "4. 用不超过三句话总结本次整理。不要执行交易或修改自选股。"

const DEFAULT_TIMER: AutomationTimer = {
  setInterval(callback, intervalMs) {
    const handle = setInterval(callback, intervalMs)
    handle.unref?.()
    return handle
  },
  clearInterval(handle) {
    clearInterval(handle as ReturnType<typeof setInterval>)
  },
}

export interface AgentTaskSchedulerOptions {
  readonly sink: AgentEventSink
  readonly now?: () => Date
  readonly timer?: AutomationTimer | undefined
  readonly settings?: Partial<AgentAutomationSettings>
  readonly lastActivityAt?: () => number
  readonly tasks?: ScheduledTaskTicker
}

export class AgentTaskScheduler {
  readonly #sink: AgentEventSink
  readonly #now: () => Date
  readonly #timer: AutomationTimer
  readonly #lastActivityAt: () => number
  readonly #tasks: ScheduledTaskTicker | undefined
  #settings: AgentAutomationSettings
  #handle: unknown
  #preopenDate: string | null = null
  #intradayAt = 0
  #dreamDate: string | null = null

  constructor(options: AgentTaskSchedulerOptions) {
    this.#sink = options.sink
    this.#now = options.now ?? (() => new Date())
    this.#timer = options.timer ?? DEFAULT_TIMER
    this.#lastActivityAt = options.lastActivityAt ?? (() => Number.POSITIVE_INFINITY)
    this.#tasks = options.tasks
    this.#settings = { ...DEFAULT_SETTINGS, ...options.settings }
  }

  get running(): boolean {
    return this.#handle !== undefined
  }
  get settings(): AgentAutomationSettings {
    return this.#settings
  }
  start(): void {
    if (this.running) return
    this.#tick()
    this.#handle = this.#timer.setInterval(() => this.#tick(), 60_000)
  }

  setEnabled(enabled: boolean): void {
    this.#settings = { ...this.#settings, enabled }
  }
  stop(): void {
    if (this.#handle !== undefined) this.#timer.clearInterval(this.#handle)
    this.#handle = undefined
  }
  runNow(kind: "preopen" | "intraday" | "dream"): "queued" | "deduped" {
    return this.#emit(kind, this.#now())
  }
  #tick(): void {
    try {
      if (!this.#settings.enabled) return
      const now = this.#now()
      const time = shanghaiDateTime(now)
      const preopen = parseShanghaiTimeMinutes(this.#settings.preopenTime)
      if (
        isAshareWeekday(now) &&
        preopen !== null &&
        time.minutes >= preopen &&
        this.#preopenDate !== time.date
      ) {
        this.#preopenDate = time.date
        this.#emit("preopen", now)
      }
      const interval = this.#settings.intradayIntervalMinutes * 60_000
      if (isContinuousAuction(now) && now.getTime() - this.#intradayAt >= interval) {
        this.#intradayAt = now.getTime()
        this.#emit("intraday", now)
      }
      const idleMs = this.#settings.dreamIdleMinutes * 60_000
      if (
        !isContinuousAuction(now) &&
        now.getTime() - this.#lastActivityAt() >= idleMs &&
        this.#dreamDate !== time.date
      ) {
        this.#dreamDate = time.date
        this.#emit("dream", now)
      }
      this.#tasks?.tick(now)
    } catch {}
  }
  #emit(kind: "preopen" | "intraday" | "dream", now: Date): "queued" | "deduped" {
    if (kind === "dream") {
      return this.#sink.enqueue({
        kind,
        dedupeKey: `dream:${shanghaiDateTime(now).date}`,
        title: "记忆整理",
        createdAt: now.toISOString(),
        prompt: DREAM_PROMPT,
      })
    }
    const label = kind === "preopen" ? "盘前计划" : "盘中检查"
    return this.#sink.enqueue({
      kind,
      dedupeKey: `${kind}:${shanghaiDateTime(now).date}`,
      title: label,
      createdAt: now.toISOString(),
      prompt: `[${label}] 请使用行情、全球市场、财经新闻和模拟持仓完成分析；数据不足时说明限制。`,
    })
  }
}
