import { describe, expect, test } from "bun:test"
import { visibleWidth } from "@oh-my-pi/pi-tui"
import { MarketIntelligenceApp } from "../../src/app/app"
import type { MarketDataSource, MarketSnapshot } from "../../src/market/data"
import type { FinancialNewsSnapshot, NewsDataSource } from "../../src/news/data"

const NEWS_SNAPSHOT: FinancialNewsSnapshot = {
  source: "NewsNow 2源",
  items: [
    {
      id: "cls-telegraph:1",
      title: "央行开展逆回购操作",
      publishedAt: Date.UTC(2026, 6, 14, 1, 30),
      source: "财联社",
    },
    {
      id: "wallstreetcn-quick:2",
      title: "A股三大指数集体高开",
      publishedAt: Date.UTC(2026, 6, 14, 1, 25),
      source: "华尔街见闻",
    },
  ],
}

class DeferredNewsSource implements NewsDataSource {
  calls = 0
  readonly #promise: Promise<FinancialNewsSnapshot>
  readonly resolve: (snapshot: FinancialNewsSnapshot) => void

  constructor() {
    const { promise, resolve } = Promise.withResolvers<FinancialNewsSnapshot>()
    this.#promise = promise
    this.resolve = resolve
  }

  loadNews(): Promise<FinancialNewsSnapshot> {
    this.calls++
    return this.#promise
  }
}

describe("财经新闻刷新", () => {
  test("初始界面不展示伪造新闻", () => {
    const app = new MarketIntelligenceApp()
    app.handleInput("\t")
    app.handleInput("\t")
    const frame = app.render(79).join("\n")

    expect(frame).toContain("实时新闻 / 财经")
    expect(frame).toContain("未加载 · R刷新")
    expect(frame).toContain("等待财经新闻")
    expect(frame).not.toContain("央行公开市场操作净投放")
  })

  test("合并并发刷新并在成功后通知重绘", async () => {
    const source = new DeferredNewsSource()
    const app = new MarketIntelligenceApp(undefined, source)
    let updates = 0
    app.onUpdate = () => {
      updates++
    }
    app.handleInput("\t")
    app.handleInput("\t")

    const first = app.refreshNews()
    const second = app.refreshNews()

    expect(source.calls).toBe(1)
    expect(app.render(79).join("\n")).toContain("更新中")
    source.resolve(NEWS_SNAPSHOT)
    await Promise.all([first, second])

    const frame = app.render(79).join("\n")
    expect(frame).toContain("NewsNow 2源 · R刷新")
    expect(frame).toContain("09:30")
    expect(frame).toContain("[财联社] 央行开展逆回购操作")
    expect(updates).toBe(2)
  })

  test("刷新失败时显示错误并保留最后一次成功新闻", async () => {
    let fail = false
    const source: NewsDataSource = {
      async loadNews(): Promise<FinancialNewsSnapshot> {
        if (fail) throw new Error("NewsNow 不可用")
        return NEWS_SNAPSHOT
      },
    }
    const app = new MarketIntelligenceApp(undefined, source)

    await app.refreshNews()
    fail = true
    await app.refreshNews()
    app.handleInput("\t")
    app.handleInput("\t")

    const frame = app.render(79).join("\n")
    expect(frame).toContain("获取失败 · R重试")
    expect(frame).toContain("央行开展逆回购操作")
  })

  test("R 键只刷新当前的数据工作区", async () => {
    let marketCalls = 0
    let newsCalls = 0
    const marketPending = Promise.withResolvers<MarketSnapshot>().promise
    const marketSource: MarketDataSource = {
      loadSnapshot(): Promise<MarketSnapshot> {
        marketCalls++
        return marketPending
      },
    }
    const newsSource: NewsDataSource = {
      async loadNews(): Promise<FinancialNewsSnapshot> {
        newsCalls++
        return NEWS_SNAPSHOT
      },
    }
    const app = new MarketIntelligenceApp(marketSource, newsSource)

    app.handleInput("R")
    expect(marketCalls).toBe(1)
    expect(newsCalls).toBe(0)

    app.handleInput("\t")
    app.handleInput("\t")
    app.handleInput("r")
    await Promise.resolve()
    expect(marketCalls).toBe(1)
    expect(newsCalls).toBe(1)
  })

  test("真实新闻状态在所有布局宽度中都不溢出", async () => {
    const app = new MarketIntelligenceApp(undefined, {
      async loadNews(): Promise<FinancialNewsSnapshot> {
        return NEWS_SNAPSHOT
      },
    })
    await app.refreshNews()

    for (const width of [20, 40, 79, 120, 160]) {
      for (const line of app.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width)
    }
  })
})
