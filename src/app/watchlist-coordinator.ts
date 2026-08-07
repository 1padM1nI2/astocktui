import type { MarketWorkspace } from "../components/market"
import { normalizeAshareCode } from "../market/market-data"
import type { PaperTradingService, TradeQuote } from "../trading/trading"
import type { WatchlistChange, WatchlistService } from "../trading/watchlist"

export class WatchlistCoordinator {
  readonly #service: WatchlistService
  readonly #market: MarketWorkspace
  readonly #trading: PaperTradingService
  readonly #refresh: () => Promise<void>
  readonly #isRefreshRunning: () => boolean
  readonly #marketCodes = new Set<string>()

  constructor(
    service: WatchlistService,
    market: MarketWorkspace,
    trading: PaperTradingService,
    refresh: () => Promise<void>,
    isRefreshRunning: () => boolean,
  ) {
    this.#service = service
    this.#market = market
    this.#trading = trading
    this.#refresh = refresh
    this.#isRefreshRunning = isRefreshRunning
    this.syncMarketCodes()
  }

  get codes(): readonly string[] {
    return [...this.#marketCodes]
  }

  get watchlist(): readonly string[] {
    return this.#service.codes
  }

  async change(action: "add" | "remove", code: string): Promise<WatchlistChange> {
    const refreshWasRunning = this.#isRefreshRunning()
    let change: WatchlistChange
    try {
      change = action === "add" ? this.#service.add(code) : this.#service.remove(code)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return { ok: false, message: `自选股保存失败：${reason}` }
    }
    if (!change.ok) return change

    this.#market.setWatchlist(this.#service.codes)
    this.syncMarketCodes()
    await this.#refresh()
    const addedCode = action === "add" ? change.code : undefined
    const quoteMissing = addedCode !== undefined && this.#market.findQuote(addedCode) === undefined
    if (refreshWasRunning || quoteMissing) await this.#refresh()
    if (addedCode === undefined || this.#market.findQuote(addedCode) !== undefined) return change
    // 其他代码都有行情、唯独新代码无数据：视为无效代码回滚，避免幽灵条目永远"等待行情"
    if ((this.#market.snapshot?.quotes.length ?? 0) > 0) {
      const rollback = this.#service.remove(addedCode)
      if (rollback.ok) {
        this.#market.setWatchlist(this.#service.codes)
        this.syncMarketCodes()
      }
      return {
        ok: false,
        code: addedCode,
        message: `无法获取 ${addedCode} 的行情（数据源无此代码），未加入自选股`,
      }
    }
    return { ...change, message: `${change.message}，行情暂未加载` }
  }

  syncMarketCodes(): void {
    this.#marketCodes.clear()
    for (const code of this.#service.codes) this.#marketCodes.add(code)
    for (const position of this.#trading.snapshot.positions) this.#marketCodes.add(position.code)
  }

  async resolveQuote(code: string): Promise<TradeQuote | undefined> {
    const normalized = normalizeAshareCode(code)
    if (normalized === null) return undefined
    const cached = this.#market.findQuote(normalized)
    if (cached !== undefined) return cached
    const wasTracked = this.#marketCodes.has(normalized)
    this.#marketCodes.add(normalized)
    await this.#refresh()
    const refreshed = this.#market.findQuote(normalized)
    if (refreshed !== undefined) return refreshed
    await this.#refresh()
    const retried = this.#market.findQuote(normalized)
    if (retried === undefined && !wasTracked) this.syncMarketCodes()
    return retried
  }
}
