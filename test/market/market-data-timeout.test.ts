import { expect, test } from "bun:test"
import { StockApiMarketDataSource } from "../../src/market/data"
import type { StockApiClient, StockApiQuote } from "../../src/market/stock-api-types"

const QUOTE: StockApiQuote = {
  code: "SH600519",
  name: "贵州茅台",
  percent: 0.0121,
  now: 1488.88,
  low: 1460,
  high: 1499,
  yesterday: 1471.08,
  source: "tencent",
}

function sourceWith(client: StockApiClient, timeoutMs: number): StockApiMarketDataSource {
  return new StockApiMarketDataSource(
    client,
    Date.now,
    async () => new Map(),
    async () => new Map(),
    timeoutMs,
  )
}

test("实时行情请求超时后按失败拒绝而不是永久挂起", async () => {
  const client: StockApiClient = {
    getStocks: () => new Promise<readonly StockApiQuote[]>(() => {}),
    getKlines: async () => [],
  }

  await expect(sourceWith(client, 20).loadSnapshot(["SH600519"])).rejects.toThrow("超时")
})

test("K 线请求超时后回退为空 K 线，仍返回实时行情", async () => {
  const client: StockApiClient = {
    getStocks: async () => [QUOTE],
    getKlines: () => new Promise(() => {}),
  }

  const snapshot = await sourceWith(client, 20).loadSnapshot(["SH600519"])

  expect(snapshot.quotes).toHaveLength(1)
  expect(snapshot.trend).toEqual([])
  expect(snapshot.klinesByCode?.["SH600519"]).toEqual([])
})
