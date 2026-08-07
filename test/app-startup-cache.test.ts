import { expect, test } from "bun:test"
import { rmSync } from "node:fs"
import { MarketIntelligenceApp } from "../src/app/app"
import { writeCache } from "../src/infra/disk-cache"
import { defaultAppDataPath } from "../src/infra/json-file"
import type { MarketDataSource, MarketSnapshot } from "../src/market/market-data"
import type { FinancialNewsSnapshot, NewsDataSource } from "../src/news/news-data"

const MARKET_SNAPSHOT: MarketSnapshot = {
  quotes: [
    { code: "SH600519", name: "贵州茅台", price: 1488.88, changePercent: 1.21, source: "tencent" },
  ],
  trend: [1470, 1488.88],
  source: "tencent",
}

const NEWS_SNAPSHOT: FinancialNewsSnapshot = {
  items: [{ id: "cls:1", title: "缓存启动快讯", publishedAt: 1_752_634_800_000, source: "财联社" }],
  source: "NewsNow 1源",
}

test("冷启动时磁盘缓存命中则预渲染，不触发网络请求", async () => {
  const marketPath = defaultAppDataPath("cache/market.json")
  const newsPath = defaultAppDataPath("cache/news.json")
  writeCache(marketPath, MARKET_SNAPSHOT, () => 1_752_634_800_000)
  writeCache(newsPath, NEWS_SNAPSHOT, () => 1_752_634_800_000)
  let marketCalls = 0
  let newsCalls = 0
  const marketSource: MarketDataSource = {
    async loadSnapshot(): Promise<MarketSnapshot> {
      marketCalls++
      throw new Error("离线")
    },
  }
  const newsSource: NewsDataSource = {
    async loadNews(): Promise<FinancialNewsSnapshot> {
      newsCalls++
      throw new Error("离线")
    },
  }

  try {
    const app = new MarketIntelligenceApp(marketSource, newsSource)
    const frame = app.render(79).join("\n")

    expect(frame).toContain("贵州茅台")
    expect(frame).toContain("1488.88")
    expect(frame).toContain("缓存")
    expect(marketCalls).toBe(0)
    expect(newsCalls).toBe(0)
    await app.dispose()
  } finally {
    rmSync(marketPath, { force: true })
    rmSync(newsPath, { force: true })
  }
})
