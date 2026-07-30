import { expect, test } from "bun:test"
import { YahooGlobalMarketDataSource } from "../src/global-market-data"

function response(result: unknown, status = 200): Response {
  return new Response(JSON.stringify({ chart: { result: [result], error: null } }), { status })
}

function chart(
  symbol: string,
  currency: string,
  price: number,
  percent: number,
  state = "REGULAR",
): unknown {
  return {
    meta: {
      symbol,
      shortName: `${symbol} Corp`,
      currency,
      regularMarketPrice: price,
      regularMarketChangePercent: percent,
      regularMarketTime: 1_752_634_800,
      marketState: state,
    },
    timestamp: [1_752_634_700, 1_752_634_800],
    indicators: { quote: [{ close: [price - 1, price] }] },
  }
}

test("Yahoo 全球行情适配器映射美国、日本和韩国的报价、状态与趋势", async () => {
  const requested: string[] = []
  const source = new YahooGlobalMarketDataSource({
    async fetch(input) {
      const url = new URL(input)
      requested.push(url.pathname)
      if (url.pathname.endsWith("AAPL")) return response(chart("AAPL", "USD", 210, 1.25))
      if (url.pathname.endsWith("7203.T"))
        return response(chart("7203.T", "JPY", 2_500, -0.5, "CLOSED"))
      return response(chart("005930.KS", "KRW", 70_000, 0.75, "PRE"))
    },
  })

  const snapshot = await source.loadSnapshot(["US:AAPL", "JP:7203", "KR:005930"])

  expect(requested).toEqual([
    "/v8/finance/chart/AAPL",
    "/v8/finance/chart/7203.T",
    "/v8/finance/chart/005930.KS",
  ])
  expect(snapshot.quotes).toMatchObject([
    { code: "US:AAPL", market: "US", currency: "USD", price: 210, marketState: "open" },
    { code: "JP:7203", market: "JP", currency: "JPY", price: 2_500, marketState: "closed" },
    { code: "KR:005930", market: "KR", currency: "KRW", price: 70_000, marketState: "delayed" },
  ])
  expect(snapshot.trend).toEqual([209, 210])
})

test("Yahoo 全球行情适配器隔离单标的失败和错误币种", async () => {
  const source = new YahooGlobalMarketDataSource({
    async fetch(input) {
      const symbol = new URL(input).pathname.split("/").at(-1)
      if (symbol === "7203.T") return new Response("unavailable", { status: 503 })
      if (symbol === "005930.KS") return response(chart("005930.KS", "USD", 70_000, 0.75))
      return response(chart("AAPL", "USD", 210, 1.25))
    },
  })

  const snapshot = await source.loadSnapshot(["US:AAPL", "JP:7203", "KR:005930"])

  expect(snapshot.quotes.map((quote) => quote.code)).toEqual(["US:AAPL"])
  expect(snapshot.diagnostics).toEqual([
    expect.objectContaining({ code: "JP:7203", market: "JP" }),
    expect.objectContaining({ code: "KR:005930", market: "KR" }),
  ])
})

test("Yahoo 请求超时后返回诊断而不是永久挂起", async () => {
  const source = new YahooGlobalMarketDataSource(
    { fetch: () => new Promise<Response>(() => {}) },
    20,
  )

  const snapshot = await source.loadSnapshot(["US:AAPL"])

  expect(snapshot.quotes).toEqual([])
  expect(snapshot.diagnostics).toEqual([
    { code: "US:AAPL", market: "US", message: "全球行情暂不可用" },
  ])
})
