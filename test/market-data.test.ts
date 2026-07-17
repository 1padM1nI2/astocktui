import { describe, expect, test } from "bun:test"
import {
  CompositeMarketDataSource,
  createDefaultMarketDataSource,
  type MarketDataSource,
  type MarketSnapshot,
  type StockApiClient,
  type StockApiKline,
  StockApiMarketDataSource,
  type StockApiQuote,
} from "../src/market-data"

function clientWith(
  quotes: readonly StockApiQuote[],
  klines: readonly StockApiKline[] | Error = [],
): StockApiClient {
  return {
    async getStocks(): Promise<readonly StockApiQuote[]> {
      return quotes
    },
    async getKlines(): Promise<readonly StockApiKline[]> {
      if (klines instanceof Error) throw klines
      return klines
    },
  }
}

describe("stock-api 行情适配", () => {
  test("映射实时价格、百分比、来源和 K 线收盘价", async () => {
    let requestedCodes: readonly string[] = []
    let requestedKline = ""
    const client: StockApiClient = {
      async getStocks(codes): Promise<readonly StockApiQuote[]> {
        requestedCodes = codes
        return [
          {
            code: "SH600519",
            name: "贵州茅台",
            now: 1488.88,
            percent: 0.0121,
            low: 1460,
            high: 1499,
            yesterday: 1471.08,
            source: "tencent",
          },
          {
            code: "SZ000858",
            name: "五粮液",
            now: 128.5,
            percent: -0.0085,
            low: 127,
            high: 130,
            yesterday: 129.6,
            source: "tencent",
          },
        ]
      },
      async getKlines(code, options): Promise<readonly StockApiKline[]> {
        requestedKline = `${code}:${options?.period}:${options?.count}`
        return [{ close: 1470 }, { close: 1488.88 }]
      },
    }

    const snapshot = await new StockApiMarketDataSource(client).loadSnapshot([
      "SH600519",
      "SZ000858",
    ])

    expect(requestedCodes).toEqual(["SH600519", "SZ000858"])
    expect(requestedKline).toBe("SH600519:day:24")
    expect(snapshot).toEqual({
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
    })
  })

  test("K 线接口失败时仍返回实时行情", async () => {
    const source = new StockApiMarketDataSource(
      clientWith(
        [
          {
            code: "SH600519",
            name: "贵州茅台",
            now: 1488.88,
            percent: 0,
            low: 1480,
            high: 1490,
            yesterday: 1488.88,
            source: "sina",
          },
        ],
        new Error("K 线暂不可用"),
      ),
    )

    const snapshot = await source.loadSnapshot(["SH600519"])

    expect(snapshot.quotes).toHaveLength(1)
    expect(snapshot.trend).toEqual([])
    expect(snapshot.source).toBe("sina")
  })

  test("拒绝上游空结果和 base 占位数据", async () => {
    const empty = new StockApiMarketDataSource(clientWith([]))
    const placeholder = new StockApiMarketDataSource(
      clientWith([
        {
          code: "SH600519",
          name: "--",
          now: 0,
          percent: 0,
          low: 0,
          high: 0,
          yesterday: 0,
          source: "base",
        },
      ]),
    )

    expect(empty.loadSnapshot(["SH600519"])).rejects.toThrow("没有可用行情")
    expect(placeholder.loadSnapshot(["SH600519"])).rejects.toThrow("没有可用行情")
  })

  test("拒绝名称或来源中的终端控制序列", async () => {
    const unsafeName = new StockApiMarketDataSource(
      clientWith([
        {
          code: "SH600519",
          name: "贵州\x1b[31m茅台",
          now: 1488.88,
          percent: 0.01,
          low: 1480,
          high: 1490,
          yesterday: 1474,
          source: "tencent",
        },
      ]),
    )
    const unsafeSource = new StockApiMarketDataSource(
      clientWith([
        {
          code: "SH600519",
          name: "贵州茅台",
          now: 1488.88,
          percent: 0.01,
          low: 1480,
          high: 1490,
          yesterday: 1474,
          source: "tencent\x1b[2J",
        },
      ]),
    )

    expect(unsafeName.loadSnapshot(["SH600519"])).rejects.toThrow("没有可用行情")
    expect(unsafeSource.loadSnapshot(["SH600519"])).rejects.toThrow("没有可用行情")
  })

  test("拒绝空自选股，避免无意义网络请求", async () => {
    let calls = 0
    const client: StockApiClient = {
      async getStocks(): Promise<readonly StockApiQuote[]> {
        calls++
        return []
      },
      async getKlines(): Promise<readonly StockApiKline[]> {
        calls++
        return []
      },
    }

    expect(new StockApiMarketDataSource(client).loadSnapshot([])).rejects.toThrow("自选股为空")
    expect(calls).toBe(0)
  })
})

test("复合行情源只请求配置的市场并合并 A 股与全球部分成功结果", async () => {
  let localCalls = 0
  let globalCalls = 0
  const local: MarketDataSource = {
    async loadSnapshot(codes): Promise<MarketSnapshot> {
      localCalls++
      return {
        quotes: codes.map((code) => ({
          code,
          name: "贵州茅台",
          price: 100,
          changePercent: 1,
          source: "local",
        })),
        trend: [99, 100],
        source: "local",
      }
    },
  }
  const global: MarketDataSource = {
    async loadSnapshot(codes): Promise<MarketSnapshot> {
      globalCalls++
      return {
        quotes: codes.map((code) => ({
          code,
          name: "Apple",
          price: 210,
          changePercent: 1.2,
          source: "yahoo",
          market: "US" as const,
          currency: "USD",
        })),
        trend: [209, 210],
        source: "yahoo",
        diagnostics: [{ code: "JP:7203", market: "JP", message: "全球行情暂不可用" }],
      }
    },
  }
  const source = new CompositeMarketDataSource(local, global)

  const snapshot = await source.loadSnapshot(["SH600519", "US:AAPL"])

  expect(snapshot.quotes.map((quote) => quote.code)).toEqual(["SH600519", "US:AAPL"])
  expect(snapshot.trend).toEqual([99, 100])
  expect(snapshot.diagnostics).toEqual([
    { code: "JP:7203", market: "JP", message: "全球行情暂不可用" },
  ])
  expect([localCalls, globalCalls]).toEqual([1, 1])

  await source.loadSnapshot(["US:AAPL"])
  expect(localCalls).toBe(1)
  expect(globalCalls).toBe(2)
})

test("复合行情源将失败市场保留为诊断而不阻断成功市场", async () => {
  const local: MarketDataSource = {
    async loadSnapshot(): Promise<MarketSnapshot> {
      return {
        quotes: [
          { code: "SH600519", name: "贵州茅台", price: 100, changePercent: 1, source: "local" },
        ],
        trend: [],
        source: "local",
      }
    },
  }
  const unavailable: MarketDataSource = {
    async loadSnapshot(): Promise<MarketSnapshot> {
      throw new Error("down")
    },
  }

  const snapshot = await new CompositeMarketDataSource(local, unavailable).loadSnapshot([
    "SH600519",
    "US:AAPL",
  ])

  expect(snapshot.quotes.map((quote) => quote.code)).toEqual(["SH600519"])
  expect(snapshot.diagnostics).toEqual([expect.objectContaining({ code: "US:AAPL", market: "US" })])
})

test("默认行情源通过复合源保留现有 A 股源并接入全球源", async () => {
  const local: MarketDataSource = {
    async loadSnapshot(): Promise<MarketSnapshot> {
      return { quotes: [], trend: [], source: "local" }
    },
  }
  const global: MarketDataSource = {
    async loadSnapshot(): Promise<MarketSnapshot> {
      return {
        quotes: [
          {
            code: "US:AAPL",
            name: "Apple",
            price: 210,
            changePercent: 1,
            source: "yahoo",
            market: "US",
            currency: "USD",
          },
        ],
        trend: [209, 210],
        source: "yahoo",
      }
    },
  }

  const snapshot = await createDefaultMarketDataSource(local, global).loadSnapshot(["US:AAPL"])

  expect(snapshot.quotes.map((quote) => quote.code)).toEqual(["US:AAPL"])
  expect(snapshot.source).toBe("yahoo")
})
