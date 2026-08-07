import { describe, expect, test } from "bun:test"
import { visibleWidth } from "@oh-my-pi/pi-tui"
import { MarketIntelligenceApp } from "../../src/app/app"
import { MarketWorkspace } from "../../src/components/market"
import type { MarketDataSource, MarketSnapshot } from "../../src/market/data"

const SNAPSHOT: MarketSnapshot = {
  quotes: [
    {
      code: "SH600519",
      name: "贵州茅台",
      price: 1488.88,
      changePercent: 1.21,
      source: "tencent",
    },
    {
      code: "SZ000858",
      name: "五粮液",
      price: 128.5,
      changePercent: -0.85,
      source: "tencent",
    },
  ],
  trend: [1470, 1488.88],
  source: "tencent",
}

function deferredSnapshot(): {
  readonly source: MarketDataSource
  readonly resolve: (snapshot: MarketSnapshot) => void
  readonly calls: () => number
} {
  const { promise, resolve } = Promise.withResolvers<MarketSnapshot>()
  let callCount = 0
  return {
    source: {
      loadSnapshot(): Promise<MarketSnapshot> {
        callCount++
        return promise
      },
    },
    resolve,
    calls: () => callCount,
  }
}

describe("实时行情刷新", () => {
  test("初始界面只显示自选股占位，不伪造价格", () => {
    const source: MarketDataSource = {
      async loadSnapshot(): Promise<MarketSnapshot> {
        return SNAPSHOT
      },
    }
    const frame = new MarketIntelligenceApp(source).render(79).join("\n")

    expect(frame).toContain("未加载 · R刷新")
    expect(frame).toContain("600519")
    expect(frame).toContain("--")
    expect(frame).not.toContain("1528.60")
  })

  test("刷新期间合并并发请求并在成功后通知重绘", async () => {
    const pending = deferredSnapshot()
    const app = new MarketIntelligenceApp(pending.source)
    let updates = 0
    app.onUpdate = () => {
      updates++
    }

    const first = app.refreshMarket()
    const second = app.refreshMarket()

    expect(pending.calls()).toBe(1)
    expect(app.render(79).join("\n")).toContain("更新中")
    pending.resolve(SNAPSHOT)
    await Promise.all([first, second])

    const frame = app.render(79).join("\n")
    expect(frame).toContain("数据源 tencent · R刷新")
    expect(frame).toContain("1488.88")
    expect(frame).toContain("+1.21%")
    expect(frame).toContain("-0.85%")
    expect(updates).toBe(2)
  })

  test("刷新失败时显示错误并保留最后一次成功数据", async () => {
    let fail = false
    const source: MarketDataSource = {
      async loadSnapshot(): Promise<MarketSnapshot> {
        if (fail) throw new Error("网络不可用")
        return SNAPSHOT
      },
    }
    const app = new MarketIntelligenceApp(source)

    await app.refreshMarket()
    fail = true
    await app.refreshMarket()

    const frame = app.render(79).join("\n")
    expect(frame).toContain("获取失败 · R重试")
    expect(frame).toContain("1488.88")
  })

  test("行情页按 R 刷新，其他标签页不拦截字母输入", async () => {
    let calls = 0
    const source: MarketDataSource = {
      async loadSnapshot(): Promise<MarketSnapshot> {
        calls++
        return SNAPSHOT
      },
    }
    const app = new MarketIntelligenceApp(source)

    app.handleInput("R")
    await Promise.resolve()
    expect(calls).toBe(1)

    app.handleInput("\t")
    app.handleInput("r")
    await Promise.resolve()
    expect(calls).toBe(1)
  })

  test("加载状态和真实行情在所有布局中都不溢出", async () => {
    const app = new MarketIntelligenceApp({
      async loadSnapshot(): Promise<MarketSnapshot> {
        return SNAPSHOT
      },
    })
    await app.refreshMarket()

    for (const width of [20, 40, 79, 120, 160]) {
      for (const line of app.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width)
    }
  })

  test("行情窗口按当前自选股列表渲染并即时响应替换", () => {
    const market = new MarketWorkspace(["SZ000938"])
    let frame = market.render(50).join("\n")
    expect(frame).toContain("000938")
    expect(frame).not.toContain("600519")

    market.applySnapshot({
      quotes: [
        {
          code: "SZ000938",
          name: "紫光股份",
          price: 20,
          changePercent: 0.5,
          source: "test-market",
        },
      ],
      trend: [19, 20],
      source: "test-market",
    })
    expect(market.render(50).join("\n")).toContain("紫光股份")

    market.setWatchlist(["SH600036"])
    frame = market.render(50).join("\n")
    expect(frame).toContain("600036")
    expect(frame).toContain("等待行情")
    expect(frame).not.toContain("000938")
  })
})
