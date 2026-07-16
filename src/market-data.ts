import { stocks } from "stock-api"

export interface WatchlistItem {
  readonly code: string
  readonly name: string
}

export const DEFAULT_WATCHLIST: readonly WatchlistItem[] = [
  { code: "SH600519", name: "贵州茅台" },
  { code: "SZ000858", name: "五粮液" },
  { code: "SH601318", name: "中国平安" },
  { code: "SZ000001", name: "平安银行" },
]

export const DEFAULT_WATCHLIST_CODES: readonly string[] = DEFAULT_WATCHLIST.map((item) => item.code)

export function normalizeAshareCode(code: string): string | null {
  const normalized = code.trim().toUpperCase()
  if (/^(?:SH|SZ)\d{6}$/.test(normalized)) return normalized
  if (!/^\d{6}$/.test(normalized)) return null
  return /^[569]/.test(normalized) ? `SH${normalized}` : `SZ${normalized}`
}

export interface MarketQuote {
  readonly code: string
  readonly name: string
  readonly price: number
  readonly changePercent: number
  readonly source: string
}

export interface MarketSnapshot {
  readonly quotes: readonly MarketQuote[]
  readonly trend: readonly number[]
  readonly source: string
}

export interface MarketDataSource {
  loadSnapshot(codes: readonly string[]): Promise<MarketSnapshot>
}

export interface StockApiQuote {
  readonly code: string
  readonly name: string
  readonly percent: number
  readonly now: number
  readonly low: number
  readonly high: number
  readonly yesterday: number
  readonly source?: string
}

export interface StockApiKline {
  readonly close: number
}

export interface StockApiKlineOptions {
  readonly period?: "day" | "week" | "month"
  readonly count?: number
}

export interface StockApiClient {
  getStocks(codes: string[]): Promise<readonly StockApiQuote[]>
  getKlines(code: string, options?: StockApiKlineOptions): Promise<readonly StockApiKline[]>
}

export class StockApiMarketDataSource implements MarketDataSource {
  readonly #client: StockApiClient

  constructor(client: StockApiClient = stocks.auto) {
    this.#client = client
  }

  async loadSnapshot(codes: readonly string[]): Promise<MarketSnapshot> {
    const focusCode = codes[0]
    if (focusCode === undefined) throw new Error("自选股为空")

    const quoteRequest = this.#client.getStocks([...codes])
    const trendRequest = this.#client
      .getKlines(focusCode, { period: "day", count: 24 })
      .catch((): readonly StockApiKline[] => [])
    const [rawQuotes, rawKlines] = await Promise.all([quoteRequest, trendRequest])

    const quotes: MarketQuote[] = []
    let snapshotSource = ""
    for (const quote of rawQuotes) {
      const source = quote.source ?? "stock-api"
      let hasControlCharacter = false
      for (let index = 0; index < quote.name.length; index++) {
        const codeUnit = quote.name.charCodeAt(index)
        if (codeUnit < 0x20 || (codeUnit >= 0x7f && codeUnit <= 0x9f)) {
          hasControlCharacter = true
          break
        }
      }
      const isKnownSource =
        source === "tencent" ||
        source === "sina" ||
        source === "eastmoney" ||
        source === "stock-api"
      if (
        !/^(SH|SZ)\d{6}$/.test(quote.code) ||
        quote.name.trim().length === 0 ||
        quote.name === "--" ||
        !Number.isFinite(quote.now) ||
        quote.now <= 0 ||
        !Number.isFinite(quote.percent) ||
        hasControlCharacter ||
        !isKnownSource
      ) {
        continue
      }

      quotes.push({
        code: quote.code,
        name: quote.name,
        price: quote.now,
        changePercent: Math.round(quote.percent * 1_000_000) / 10_000,
        source,
      })
      if (snapshotSource.length === 0) snapshotSource = source
      else if (snapshotSource !== source) snapshotSource = "多源"
    }

    if (quotes.length === 0) throw new Error("没有可用行情")

    const trend: number[] = []
    for (const kline of rawKlines) {
      if (Number.isFinite(kline.close) && kline.close > 0) trend.push(kline.close)
    }

    return { quotes, trend, source: snapshotSource }
  }
}
