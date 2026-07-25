import { type ParsedMarketCode, parseMarketCode } from "./market-code"
import type { MarketDataDiagnostic, MarketQuote, MarketSnapshot } from "./market-data"

export interface GlobalMarketHttp {
  fetch(input: string, init?: RequestInit): Promise<Response>
}

const CHART_ENDPOINT = "https://query1.finance.yahoo.com/v8/finance/chart/"
const EXPECTED_CURRENCY: Readonly<Record<"US" | "JP" | "KR", string>> = {
  US: "USD",
  JP: "JPY",
  KR: "KRW",
}

export class YahooGlobalMarketDataSource {
  readonly #http: GlobalMarketHttp

  constructor(http: GlobalMarketHttp = { fetch }) {
    this.#http = http
  }

  async loadSnapshot(codes: readonly string[]): Promise<MarketSnapshot> {
    const results = await Promise.all(codes.map((code) => this.#load(code)))
    const quotes: MarketQuote[] = []
    const diagnostics: MarketDataDiagnostic[] = []
    let trend: readonly number[] = []
    for (const result of results) {
      if ("diagnostic" in result) {
        diagnostics.push(result.diagnostic)
        continue
      }
      quotes.push(result.quote)
      if (trend.length === 0) trend = result.trend
    }
    return { quotes, trend, source: "Yahoo Finance", diagnostics }
  }

  async #load(
    code: string,
  ): Promise<
    | { readonly quote: MarketQuote; readonly trend: readonly number[] }
    | { readonly diagnostic: MarketDataDiagnostic }
  > {
    const parsed = parseMarketCode(code)
    if (parsed === null || parsed.market === "CN")
      return { diagnostic: diagnostic(code, "US", "全球股票代码无效") }
    try {
      const response = await this.#http.fetch(chartUrl(parsed))
      if (!response.ok) throw new Error("上游请求失败")
      return parseChart(code, parsed, await response.json())
    } catch {
      return { diagnostic: diagnostic(code, parsed.market, "全球行情暂不可用") }
    }
  }
}

function chartUrl(parsed: ParsedMarketCode): string {
  const url = new URL(`${CHART_ENDPOINT}${encodeURIComponent(parsed.providerSymbol)}`)
  url.searchParams.set("range", "1mo")
  url.searchParams.set("interval", "1d")
  return url.toString()
}

function parseChart(
  code: string,
  parsed: ParsedMarketCode,
  value: unknown,
): { readonly quote: MarketQuote; readonly trend: readonly number[] } {
  const root = record(value)
  const chart = root === undefined ? undefined : record(root["chart"])
  const results = chart?.["result"]
  const result = Array.isArray(results) ? record(results[0]) : undefined
  const meta = result === undefined ? undefined : record(result["meta"])
  if (result === undefined || meta === undefined || parsed.market === "CN")
    throw new Error("上游响应无效")
  const price = number(meta["regularMarketPrice"])
  const changePercent = number(meta["regularMarketChangePercent"])
  const currency = string(meta["currency"])
  const name = string(meta["shortName"]) ?? string(meta["longName"])
  if (
    price === undefined ||
    changePercent === undefined ||
    currency !== EXPECTED_CURRENCY[parsed.market] ||
    name === undefined ||
    hasControlCharacter(name)
  ) {
    throw new Error("上游报价无效")
  }
  const rawTimestamp = number(meta["regularMarketTime"])
  const trend = closes(result)
  return {
    quote: {
      code,
      name,
      price,
      changePercent,
      source: "Yahoo Finance",
      market: parsed.market,
      currency,
      marketState: marketState(string(meta["marketState"])),
      ...(trend.length === 0 ? {} : { trend }),
      asOf: rawTimestamp === undefined ? null : Math.round(rawTimestamp * 1_000),
    },
    trend,
  }
}

function closes(result: Record<string, unknown>): readonly number[] {
  const indicators = record(result["indicators"])
  const quote = Array.isArray(indicators?.["quote"]) ? record(indicators?.["quote"][0]) : undefined
  const values = quote?.["close"]
  return Array.isArray(values)
    ? values.filter(
        (value): value is number =>
          typeof value === "number" && Number.isFinite(value) && value > 0,
      )
    : []
}

function marketState(value: string | undefined): "open" | "closed" | "delayed" | "unknown" {
  if (value === "REGULAR") return "open"
  if (value === "CLOSED") return "closed"
  if (value === "PRE" || value === "POST") return "delayed"
  return "unknown"
}

function diagnostic(
  code: string,
  market: "US" | "JP" | "KR",
  message: string,
): MarketDataDiagnostic {
  return { code, market, message }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index)
    if (unit < 0x20 || (unit >= 0x7f && unit <= 0x9f)) return true
  }
  return false
}
