import { expect, test } from "bun:test"
import { WatchlistCoordinator } from "../src/app/watchlist-coordinator"
import type { MarketQuote, MarketSnapshot } from "../src/market/market-data"
import { WatchlistService } from "../src/trading/watchlist"

function quote(code: string): MarketQuote {
  return { code, name: code, price: 1, changePercent: 0, source: "fake" }
}

function fakeMarket(options: {
  readonly quotes: readonly MarketQuote[]
  readonly snapshotAvailable: boolean
}) {
  const state = {
    watchlist: [] as readonly string[],
    snapshot: (options.snapshotAvailable
      ? { quotes: options.quotes, trend: [], source: "fake" }
      : null) as MarketSnapshot | null,
  }
  return {
    state,
    setWatchlist(codes: readonly string[]): void {
      state.watchlist = codes
    },
    findQuote(code: string): MarketQuote | undefined {
      return options.quotes.find((item) => item.code === code)
    },
    get snapshot(): MarketSnapshot | null {
      return state.snapshot
    },
  }
}

function fakeTrading() {
  return { snapshot: { positions: [] } }
}

test("添加有行情的代码成功并保留", async () => {
  const service = new WatchlistService({ codes: ["SH600519"] })
  const market = fakeMarket({
    quotes: [quote("SH600519"), quote("US:AAPL")],
    snapshotAvailable: true,
  })
  const coordinator = new WatchlistCoordinator(
    service,
    market as never,
    fakeTrading() as never,
    async () => {},
    () => false,
  )
  const change = await coordinator.change("add", "US:AAPL")
  expect(change.ok).toBe(true)
  expect(service.codes).toEqual(["SH600519", "US:AAPL"])
})

test("添加无行情的代码时回滚并明确报错", async () => {
  const service = new WatchlistService({ codes: ["SH600519"] })
  const market = fakeMarket({ quotes: [quote("SH600519")], snapshotAvailable: true })
  const coordinator = new WatchlistCoordinator(
    service,
    market as never,
    fakeTrading() as never,
    async () => {},
    () => false,
  )
  const change = await coordinator.change("add", "US:^TWSE")
  expect(change.ok).toBe(false)
  expect(change.message).toContain("未加入自选股")
  expect(service.codes).toEqual(["SH600519"])
  expect(market.state.watchlist).toEqual(["SH600519"])
})

test("数据源整体不可用时保留代码并提示行情暂未加载", async () => {
  const service = new WatchlistService({ codes: ["SH600519"] })
  const market = fakeMarket({ quotes: [], snapshotAvailable: false })
  const coordinator = new WatchlistCoordinator(
    service,
    market as never,
    fakeTrading() as never,
    async () => {},
    () => false,
  )
  const change = await coordinator.change("add", "US:AAPL")
  expect(change.ok).toBe(true)
  expect(change.message).toContain("行情暂未加载")
  expect(service.codes).toEqual(["SH600519", "US:AAPL"])
})
