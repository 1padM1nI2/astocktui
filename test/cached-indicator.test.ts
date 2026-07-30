import { expect, test } from "bun:test"
import { MarketWorkspace } from "../src/components/market"
import { NewsWorkspace } from "../src/components/news"
import type { MarketSnapshot } from "../src/market-data"
import type { FinancialNewsSnapshot } from "../src/news-data"

const MARKET_SNAPSHOT: MarketSnapshot = {
  quotes: [
    { code: "SH600519", name: "贵州茅台", price: 1488.88, changePercent: 1.21, source: "tencent" },
  ],
  trend: [1470, 1488.88],
  source: "tencent",
}

const NEWS_SNAPSHOT: FinancialNewsSnapshot = {
  items: [{ id: "cls:1", title: "测试快讯", publishedAt: 1_752_634_800_000, source: "财联社" }],
  source: "NewsNow 1源",
}

test("行情状态行在缓存快照上显示缓存时间", () => {
  const cached = new MarketWorkspace(["SH600519"])
  cached.applySnapshot({ ...MARKET_SNAPSHOT, cachedAt: 1_752_634_800_000 })
  const fresh = new MarketWorkspace(["SH600519"])
  fresh.applySnapshot(MARKET_SNAPSHOT)

  expect(cached.render(79)[0]).toContain("· 缓存 ")
  expect(fresh.render(79)[0]).not.toContain("缓存")
})

test("新闻状态行在缓存快照上显示缓存时间", () => {
  const cached = new NewsWorkspace()
  cached.applySnapshot({ ...NEWS_SNAPSHOT, cachedAt: 1_752_634_800_000 })
  const fresh = new NewsWorkspace()
  fresh.applySnapshot(NEWS_SNAPSHOT)

  expect(cached.render(79)[0]).toContain("· 缓存 ")
  expect(fresh.render(79)[0]).not.toContain("缓存")
})
