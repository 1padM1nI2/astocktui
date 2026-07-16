import { describe, expect, test } from "bun:test"
import {
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
