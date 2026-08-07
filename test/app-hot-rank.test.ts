import { describe, expect, test } from "bun:test"
import {
  AgentController,
  type AgentDriver,
  type AgentDriverEvent,
} from "../src/agent/agent-controller"
import { MarketIntelligenceApp } from "../src/app/app"
import type { CommandContext } from "../src/commands/commands"
import type { HotRankSnapshot } from "../src/market/eastmoney-hot-rank"
import type { MarketDataSource, MarketSnapshot } from "../src/market/market-data"

const MARKET_SNAPSHOT: MarketSnapshot = {
  quotes: [
    {
      code: "SH600519",
      name: "贵州茅台",
      price: 1488.88,
      changePercent: 1.21,
      source: "tencent",
    },
  ],
  trend: [1470, 1488.88],
  source: "tencent",
}

const HOT_RANK_SNAPSHOT: HotRankSnapshot = {
  items: [
    {
      code: "SH603986",
      rank: 1,
      rankChange: 2,
      name: "兆易创新",
      price: 371.1,
      changePercent: 1.94,
    },
    {
      code: "SZ001309",
      rank: 2,
      rankChange: -1,
      name: "德明利",
      price: 390.04,
      changePercent: -5.5,
    },
  ],
  source: "东财股吧人气",
  updatedAt: 1_753_900_000_000,
}

function fixture(): {
  readonly app: MarketIntelligenceApp
  readonly marketCalls: () => number
  readonly hotRankCalls: () => number
} {
  let marketCalls = 0
  let hotRankCalls = 0
  const marketSource: MarketDataSource = {
    async loadSnapshot(): Promise<MarketSnapshot> {
      marketCalls++
      return MARKET_SNAPSHOT
    },
  }
  const app = new MarketIntelligenceApp(
    marketSource,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    async (): Promise<HotRankSnapshot> => {
      hotRankCalls++
      return HOT_RANK_SNAPSHOT
    },
  )
  return { app, marketCalls: () => marketCalls, hotRankCalls: () => hotRankCalls }
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index++) await Promise.resolve()
}

describe("股吧人气榜视图切换", () => {
  test("默认显示行情视图，按 h 切换到人气榜并懒加载", async () => {
    const { app, hotRankCalls } = fixture()

    const initial = app.render(79).join("\n")
    expect(initial).toContain("行情 /")
    expect(initial).not.toContain("股吧人气榜")
    expect(hotRankCalls()).toBe(0)

    app.handleInput("h")
    await flushMicrotasks()

    const frame = app.render(79).join("\n")
    expect(frame).toContain("股吧人气榜")
    expect(frame).toContain("兆易创新")
    expect(frame).not.toContain("行情 / 沪深A股")
    expect(hotRankCalls()).toBe(1)
  })

  test("再次按 h 返回行情视图且行情数据保留", async () => {
    const { app } = fixture()
    await app.refreshMarket()

    app.handleInput("h")
    await flushMicrotasks()
    app.handleInput("H")

    const frame = app.render(79).join("\n")
    expect(frame).toContain("行情 / 沪深A股")
    expect(frame).toContain("1488.88")
    expect(frame).not.toContain("股吧人气榜")
  })

  test("人气榜视图按 R 只刷新人气榜，不触发行情刷新", async () => {
    const { app, marketCalls, hotRankCalls } = fixture()
    app.handleInput("h")
    await flushMicrotasks()

    app.handleInput("R")
    await flushMicrotasks()

    expect(hotRankCalls()).toBe(2)
    expect(marketCalls()).toBe(0)
  })

  test("其他标签页按 h 不切换人气榜", async () => {
    const { app, hotRankCalls } = fixture()

    app.handleInput("\t")
    app.handleInput("\t")
    app.handleInput("h")
    await flushMicrotasks()

    expect(app.render(79).join("\n")).not.toContain("股吧人气榜")
    expect(hotRankCalls()).toBe(0)
  })
})

class StubDriver implements AgentDriver {
  async run(_input: string, _emit: (event: AgentDriverEvent) => void): Promise<void> {}
  clear(): void {}
  abort(): void {}
}

describe("Agent 上下文人气榜", () => {
  test("hotRank 懒加载并支持显式刷新", async () => {
    const captured: { current: CommandContext | null } = { current: null }
    let hotRankCalls = 0
    const app = new MarketIntelligenceApp(
      undefined,
      undefined,
      () => 16,
      undefined,
      undefined,
      undefined,
      (context) => {
        captured.current = context
        return new AgentController(new StubDriver(), "test/model")
      },
      undefined,
      undefined,
      undefined,
      async (): Promise<HotRankSnapshot> => {
        hotRankCalls++
        return HOT_RANK_SNAPSHOT
      },
    )

    const hotRank = captured.current?.hotRank
    if (hotRank === undefined) throw new Error("上下文缺少 hotRank")
    const loaded = await hotRank()
    expect(hotRankCalls).toBe(1)
    expect(loaded?.items[0]?.name).toBe("兆易创新")

    await hotRank(true)
    expect(hotRankCalls).toBe(2)
    await app.dispose()
  })
})
