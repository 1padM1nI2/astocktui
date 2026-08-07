import { expect, test } from "bun:test"
import { TencentGlobalMarketDataSource } from "../../src/market/global-market-data"

function quoteLine(
  market: number,
  name: string,
  code: string,
  price: string,
  percent: string,
  time = "2026-07-31 09:20:44",
): string {
  const fields = new Array(36).fill("")
  fields[0] = String(market)
  fields[1] = name
  fields[2] = code
  fields[3] = price
  fields[4] = "1000"
  fields[5] = "990"
  fields[6] = "10000"
  fields[30] = time
  fields[32] = percent
  return `${fields.join("~")}`
}

function quoteResponse(lines: Record<string, string>): Response {
  const body = Object.entries(lines)
    .map(([symbol, value]) => `v_${symbol}="${value}";`)
    .join("\n")
  return new Response(body, { status: 200 })
}

function klineResponse(closes: readonly number[]): Response {
  const rows = closes.map((close) => `2026-07-30,${close.toFixed(2)}`)
  return new Response(JSON.stringify({ rc: 0, data: { klines: rows } }), { status: 200 })
}

function indexResponse(entries: readonly Record<string, unknown>[]): Response {
  return new Response(JSON.stringify({ rc: 0, data: { total: entries.length, diff: entries } }), {
    status: 200,
  })
}

function http(overrides: {
  quotes?: Record<string, string>
  klines?: Record<string, readonly number[]>
  indices?: readonly Record<string, unknown>[]
}): { fetch(input: string): Promise<Response>; requested: string[] } {
  const requested: string[] = []
  return {
    requested,
    async fetch(input) {
      requested.push(input)
      if (input.includes("qt.gtimg.cn")) return quoteResponse(overrides.quotes ?? {})
      if (input.includes("push2his.eastmoney.com")) {
        const secid = new URL(input).searchParams.get("secid") ?? ""
        return klineResponse(overrides.klines?.[secid] ?? [])
      }
      return indexResponse(overrides.indices ?? [])
    },
  }
}

test("腾讯全球行情适配器映射美国、日本和韩国股票报价与趋势", async () => {
  const source = new TencentGlobalMarketDataSource(
    http({
      quotes: {
        usAAPL: quoteLine(200, "Apple Inc.", "AAPL.OQ", "333.43", "-1.41", "2026-07-30 16:00:01"),
        jp7203: quoteLine(351, "Toyota Motor Corp.", "7203.T", "3105", "-0.67"),
        kr005930: quoteLine(352, "Samsung Electronics Co., Ltd.", "005930.KS", "257000", "0.75"),
      },
      klines: { "105.AAPL": [330, 333.43] },
    }),
  )

  const snapshot = await source.loadSnapshot(["US:AAPL", "JP:7203", "KR:005930"])

  expect(snapshot.source).toBe("腾讯行情")
  expect(snapshot.quotes).toMatchObject([
    { code: "US:AAPL", market: "US", currency: "USD", price: 333.43, changePercent: -1.41 },
    { code: "JP:7203", market: "JP", currency: "JPY", price: 3105, changePercent: -0.67 },
    { code: "KR:005930", market: "KR", currency: "KRW", price: 257000, changePercent: 0.75 },
  ])
  expect(snapshot.trend).toEqual([330, 333.43])
  expect(snapshot.quotes[0]?.trend).toEqual([330, 333.43])
})

test("腾讯未覆盖的指数代码回退东方财富全球指数", async () => {
  const source = new TencentGlobalMarketDataSource(
    http({
      indices: [
        { f12: "N225", f14: "日经225", f2: 3900000, f3: 125, f152: 2, f124: 1_785_000_000 },
      ],
      klines: { "100.N225": [38000, 39000] },
    }),
  )

  const snapshot = await source.loadSnapshot(["US:^N225"])

  expect(snapshot.quotes).toMatchObject([
    { code: "US:^N225", market: "US", name: "日经225", price: 39000, changePercent: 1.25 },
  ])
  expect(snapshot.quotes[0]?.trend).toEqual([38000, 39000])
  expect(snapshot.diagnostics).toEqual([])
})

test("腾讯未覆盖的美股指数代码按东财特殊别名回退（如费城半导体 SOX）", async () => {
  const source = new TencentGlobalMarketDataSource(
    http({
      indices: [
        { f12: "SOX", f14: "费城半导体指数", f2: 1_130_299, f3: 819, f152: 2, f124: 1_785_441_600 },
      ],
      klines: { "251.SOX": [10447.49, 11302.99] },
    }),
  )

  const snapshot = await source.loadSnapshot(["US:SOX"])

  expect(snapshot.quotes).toMatchObject([
    { code: "US:SOX", market: "US", name: "费城半导体指数", price: 11302.99, changePercent: 8.19 },
  ])
  expect(snapshot.quotes[0]?.trend).toEqual([10447.49, 11302.99])
  expect(snapshot.diagnostics).toEqual([])
})

test("单标的缺失或报价无效时隔离为诊断", async () => {
  const source = new TencentGlobalMarketDataSource(
    http({
      quotes: {
        usAAPL: quoteLine(200, "Apple Inc.", "AAPL.OQ", "333.43", "-1.41"),
        kr005930: quoteLine(352, "Samsung", "005930.KS", "0", ""),
      },
    }),
  )

  const snapshot = await source.loadSnapshot(["US:AAPL", "JP:7203", "KR:005930"])

  expect(snapshot.quotes.map((quote) => quote.code)).toEqual(["US:AAPL"])
  expect(snapshot.diagnostics).toEqual([
    { code: "JP:7203", market: "JP", message: "全球行情暂不可用" },
    { code: "KR:005930", market: "KR", message: "全球行情暂不可用" },
  ])
})

test("请求超时后返回诊断而不是永久挂起", async () => {
  const source = new TencentGlobalMarketDataSource(
    { fetch: () => new Promise<Response>(() => {}) },
    20,
  )

  const snapshot = await source.loadSnapshot(["US:AAPL"])

  expect(snapshot.quotes).toEqual([])
  expect(snapshot.diagnostics).toEqual([
    { code: "US:AAPL", market: "US", message: "全球行情暂不可用" },
  ])
})
