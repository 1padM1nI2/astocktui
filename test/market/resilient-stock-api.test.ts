import { describe, expect, test } from "bun:test"
import {
  orderProviders,
  type ProviderHealth,
  ResilientStockApiClient,
  type StockApiProvider,
} from "../../src/market/resilient-stock-api"
import type { StockApiKline, StockApiQuote } from "../../src/market/stock-api-types"

function quote(code: string, source: string): StockApiQuote {
  return {
    code,
    name: `测试${code}`,
    percent: 0.01,
    now: 100,
    low: 99,
    high: 101,
    yesterday: 99,
    source,
  }
}

interface FakeHandlers {
  readonly getStocks?: (codes: string[]) => Promise<readonly StockApiQuote[]>
  readonly getKlines?: (code: string) => Promise<readonly StockApiKline[]>
}

function provider(name: string, handlers: FakeHandlers, calls: string[]): StockApiProvider {
  return {
    name,
    api: {
      async getStocks(codes) {
        calls.push(`stocks:${name}:${codes.join(",")}`)
        return (await handlers.getStocks?.(codes)) ?? []
      },
      async getKlines(code) {
        calls.push(`klines:${name}`)
        return (await handlers.getKlines?.(code)) ?? []
      },
    },
  }
}

const failing = {
  getStocks: async (): Promise<readonly StockApiQuote[]> => {
    throw new Error("上游不可用")
  },
  getKlines: async (): Promise<readonly StockApiKline[]> => {
    throw new Error("上游不可用")
  },
} satisfies FakeHandlers

const CODES = ["SH600519", "SZ000001"]

describe("弹性行情客户端 failover", () => {
  test("首选抛错时自动切换次选", async () => {
    const calls: string[] = []
    const client = new ResilientStockApiClient([
      provider("p1", failing, calls),
      provider("p2", { getStocks: async (codes) => codes.map((code) => quote(code, "p2")) }, calls),
    ])

    const quotes = await client.getStocks(CODES)

    expect(quotes.map((item) => item.code)).toEqual(CODES)
    expect(quotes[0]?.source).toBe("p2")
    expect(calls).toEqual(["stocks:p1:SH600519,SZ000001", "stocks:p2:SH600519,SZ000001"])
  })

  test("首选只返回部分代码时由次选补全并按 code 去重", async () => {
    const calls: string[] = []
    const client = new ResilientStockApiClient([
      provider("p1", { getStocks: async () => [quote("SH600519", "p1")] }, calls),
      provider("p2", { getStocks: async (codes) => codes.map((code) => quote(code, "p2")) }, calls),
    ])

    const quotes = await client.getStocks(CODES)

    expect(quotes.map((item) => [item.code, item.source])).toEqual([
      ["SH600519", "p1"],
      ["SZ000001", "p2"],
    ])
    expect(calls).toEqual(["stocks:p1:SH600519,SZ000001", "stocks:p2:SZ000001"])
  })

  test("首选永不返回时按超时切换次选", async () => {
    const calls: string[] = []
    const hanging = {
      getStocks: (): Promise<readonly StockApiQuote[]> => new Promise(() => {}),
    } satisfies FakeHandlers
    const client = new ResilientStockApiClient(
      [
        provider("p1", hanging, calls),
        provider(
          "p2",
          { getStocks: async (codes) => codes.map((code) => quote(code, "p2")) },
          calls,
        ),
      ],
      Date.now,
      20,
    )

    const quotes = await client.getStocks(CODES)

    expect(quotes.map((item) => item.code)).toEqual(CODES)
    expect(quotes[0]?.source).toBe("p2")
  })

  test("全部源落空时返回空数组", async () => {
    const calls: string[] = []
    const client = new ResilientStockApiClient([
      provider("p1", failing, calls),
      provider("p2", failing, calls),
    ])

    await expect(client.getStocks(CODES)).resolves.toEqual([])
    await expect(client.getKlines("SH600519")).resolves.toEqual([])
  })

  test("getKlines 首选失败时返回次选的首个非空结果", async () => {
    const calls: string[] = []
    const kline: StockApiKline = { date: "2026-07-22", open: 99, close: 100, high: 101, low: 98 }
    const client = new ResilientStockApiClient([
      provider("p1", failing, calls),
      provider("p2", { getKlines: async () => [kline] }, calls),
    ])

    const klines = await client.getKlines("SH600519", { period: "day", count: 60 })

    expect(klines).toEqual([kline])
    expect(calls).toEqual(["klines:p1", "klines:p2"])
  })
})

describe("弹性行情客户端健康度", () => {
  test("连续两次失败后被降权，后续调用先试次选", async () => {
    const calls: string[] = []
    const client = new ResilientStockApiClient([
      provider("p1", failing, calls),
      provider("p2", { getStocks: async (codes) => codes.map((code) => quote(code, "p2")) }, calls),
    ])

    await client.getStocks(CODES)
    await client.getStocks(CODES)
    calls.length = 0
    await client.getStocks(CODES)

    expect(calls[0]).toBe("stocks:p2:SH600519,SZ000001")
  })

  test("冷却期过后首选恢复优先，一次成功即复位", async () => {
    const calls: string[] = []
    let tick = 0
    let p1Down = true
    const p1 = provider(
      "p1",
      {
        getStocks: async (codes) => {
          if (p1Down) throw new Error("上游不可用")
          return codes.map((code) => quote(code, "p1"))
        },
      },
      calls,
    )
    const client = new ResilientStockApiClient(
      [
        p1,
        provider(
          "p2",
          { getStocks: async (codes) => codes.map((code) => quote(code, "p2")) },
          calls,
        ),
      ],
      () => tick,
      8_000,
      5 * 60_000,
    )

    await client.getStocks(CODES)
    await client.getStocks(CODES)
    calls.length = 0
    tick = 5 * 60_000 + 1
    p1Down = false
    await client.getStocks(CODES)
    expect(calls).toEqual(["stocks:p1:SH600519,SZ000001"])

    calls.length = 0
    await client.getStocks(CODES)
    expect(calls).toEqual(["stocks:p1:SH600519,SZ000001"])
  })
})

test("orderProviders 把冷却中的源排到最后并保持其余顺序稳定", () => {
  const providers = [{ name: "a" }, { name: "b" }, { name: "c" }]
  const health: ReadonlyMap<string, ProviderHealth> = new Map([
    ["b", { consecutiveFailures: 2, cooldownUntil: 1_000 }],
    ["c", { consecutiveFailures: 2, cooldownUntil: 500 }],
  ])

  expect(orderProviders(providers, health, 600).map((item) => item.name)).toEqual(["a", "c", "b"])
  expect(orderProviders(providers, health, 2_000).map((item) => item.name)).toEqual(["a", "b", "c"])
})
