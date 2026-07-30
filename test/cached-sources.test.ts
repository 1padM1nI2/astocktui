import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  applyStartupCaches,
  CachedMarketDataSource,
  CachedNewsDataSource,
  readCachedMarketSnapshot,
  readCachedNewsSnapshot,
} from "../src/cached-sources"
import { readCache, writeCache } from "../src/disk-cache"
import type { MarketDataSource, MarketSnapshot } from "../src/market-data"
import type { FinancialNewsSnapshot, NewsDataSource } from "../src/news-data"

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

function tempPath(name: string): string {
  return join(mkdtempSync(join(tmpdir(), "astocktui-cached-sources-")), name)
}

function marketSource(snapshot: MarketSnapshot | Error): MarketDataSource {
  return {
    async loadSnapshot(): Promise<MarketSnapshot> {
      if (snapshot instanceof Error) throw snapshot
      return snapshot
    },
  }
}

function newsSource(snapshot: FinancialNewsSnapshot | Error): NewsDataSource {
  return {
    async loadNews(): Promise<FinancialNewsSnapshot> {
      if (snapshot instanceof Error) throw snapshot
      return snapshot
    },
  }
}

describe("行情磁盘缓存包装", () => {
  test("内层成功时原样返回并写盘", async () => {
    const path = tempPath("market.json")
    const source = new CachedMarketDataSource(marketSource(MARKET_SNAPSHOT), path, () => 42)

    const snapshot = await source.loadSnapshot(["SH600519"])

    expect(snapshot).toEqual(MARKET_SNAPSHOT)
    expect(readCache(path)).toEqual({ cachedAt: 42, value: MARKET_SNAPSHOT })
  })

  test("内层失败且缓存命中时回退到缓存并带 cachedAt", async () => {
    const path = tempPath("market.json")
    await new CachedMarketDataSource(marketSource(MARKET_SNAPSHOT), path, () => 42).loadSnapshot([
      "SH600519",
    ])

    const failing = new CachedMarketDataSource(marketSource(new Error("没有可用行情")), path)
    const snapshot = await failing.loadSnapshot(["SH600519"])

    expect(snapshot).toEqual({ ...MARKET_SNAPSHOT, cachedAt: 42 })
    expect(readCachedMarketSnapshot(path)?.cachedAt).toBe(42)
  })

  test("内层失败且无缓存时抛原错", async () => {
    const source = new CachedMarketDataSource(
      marketSource(new Error("没有可用行情")),
      tempPath("market.json"),
    )

    await expect(source.loadSnapshot(["SH600519"])).rejects.toThrow("没有可用行情")
  })
})

describe("新闻磁盘缓存包装", () => {
  test("内层成功时原样返回并写盘", async () => {
    const path = tempPath("news.json")
    const source = new CachedNewsDataSource(newsSource(NEWS_SNAPSHOT), path, () => 43)

    const snapshot = await source.loadNews()

    expect(snapshot).toEqual(NEWS_SNAPSHOT)
    expect(readCachedNewsSnapshot(path)).toEqual({ cachedAt: 43, value: NEWS_SNAPSHOT })
  })

  test("内层失败且缓存命中时回退到缓存并带 cachedAt", async () => {
    const path = tempPath("news.json")
    await new CachedNewsDataSource(newsSource(NEWS_SNAPSHOT), path, () => 43).loadNews()

    const failing = new CachedNewsDataSource(newsSource(new Error("没有可用财经新闻")), path)

    await expect(failing.loadNews()).resolves.toEqual({ ...NEWS_SNAPSHOT, cachedAt: 43 })
  })

  test("内层失败且无缓存时抛原错", async () => {
    const source = new CachedNewsDataSource(
      newsSource(new Error("没有可用财经新闻")),
      tempPath("news.json"),
    )

    await expect(source.loadNews()).rejects.toThrow("没有可用财经新闻")
  })
})

describe("启动预渲染缓存", () => {
  test("缓存命中时直接套用快照且不触发网络", () => {
    const marketPath = tempPath("market.json")
    const newsPath = tempPath("news.json")
    writeCache(marketPath, MARKET_SNAPSHOT, () => 42)
    writeCache(newsPath, NEWS_SNAPSHOT, () => 43)
    const applied: { market?: MarketSnapshot; news?: FinancialNewsSnapshot } = {}

    applyStartupCaches(
      {
        applySnapshot(snapshot: MarketSnapshot): void {
          applied.market = snapshot
        },
      },
      {
        applySnapshot(snapshot: FinancialNewsSnapshot): void {
          applied.news = snapshot
        },
      },
      marketPath,
      newsPath,
    )

    expect(applied.market).toEqual({ ...MARKET_SNAPSHOT, cachedAt: 42 })
    expect(applied.news).toEqual({ ...NEWS_SNAPSHOT, cachedAt: 43 })
  })

  test("缓存缺失时不套用任何快照", () => {
    const applied: string[] = []
    applyStartupCaches(
      { applySnapshot: () => applied.push("market") },
      { applySnapshot: () => applied.push("news") },
      tempPath("market.json"),
      tempPath("news.json"),
    )

    expect(applied).toEqual([])
  })
})
