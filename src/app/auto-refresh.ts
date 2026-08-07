export const MARKET_REFRESH_INTERVAL_MS = 15_000
export const NEWS_REFRESH_INTERVAL_MS = 60_000

export interface RefreshScheduler {
  setInterval(callback: () => void, intervalMs: number): unknown
  clearInterval(handle: unknown): void
}

export interface AutoRefreshOptions {
  readonly refreshMarket: () => void | Promise<void>
  readonly refreshNews: () => void | Promise<void>
  readonly scheduler?: RefreshScheduler | undefined
}

export const DEFAULT_SCHEDULER: RefreshScheduler = {
  setInterval(callback, intervalMs): unknown {
    const handle = setInterval(callback, intervalMs)
    handle.unref?.()
    return handle
  },
  clearInterval(handle): void {
    clearInterval(handle as ReturnType<typeof setInterval>)
  },
}

export class AutoRefreshController {
  readonly #refreshMarket: () => void | Promise<void>
  readonly #refreshNews: () => void | Promise<void>
  readonly #scheduler: RefreshScheduler
  #marketTimer: unknown
  #newsTimer: unknown

  constructor(options: AutoRefreshOptions) {
    this.#refreshMarket = options.refreshMarket
    this.#refreshNews = options.refreshNews
    this.#scheduler = options.scheduler ?? DEFAULT_SCHEDULER
  }

  get running(): boolean {
    return this.#marketTimer !== undefined
  }

  start(): void {
    if (this.running) return
    this.#run(this.#refreshMarket)
    this.#run(this.#refreshNews)
    this.#marketTimer = this.#scheduler.setInterval(
      () => this.#run(this.#refreshMarket),
      MARKET_REFRESH_INTERVAL_MS,
    )
    this.#newsTimer = this.#scheduler.setInterval(
      () => this.#run(this.#refreshNews),
      NEWS_REFRESH_INTERVAL_MS,
    )
  }

  stop(): void {
    if (this.#marketTimer !== undefined) this.#scheduler.clearInterval(this.#marketTimer)
    if (this.#newsTimer !== undefined) this.#scheduler.clearInterval(this.#newsTimer)
    this.#marketTimer = undefined
    this.#newsTimer = undefined
  }

  #run(refresh: () => void | Promise<void>): void {
    try {
      const result = refresh()
      if (result instanceof Promise) void result.catch(() => {})
    } catch {
      // Refresh implementations expose failure state; the scheduler must remain alive.
    }
  }
}
