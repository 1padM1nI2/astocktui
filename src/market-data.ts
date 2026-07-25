import { stocks } from "stock-api"
import { YahooGlobalMarketDataSource } from "./global-market-data"
import { isAshareCode, normalizeMarketCode, parseMarketCode, type StockMarket } from "./market-code"

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
  const normalized = normalizeMarketCode(code)
  return normalized !== null && isAshareCode(normalized) ? normalized : null
}

export interface MarketQuote {
  readonly code: string
  readonly name: string
  readonly price: number
  readonly changePercent: number
  readonly source: string
  readonly market?: StockMarket
  readonly currency?: string
  readonly marketState?: "open" | "closed" | "delayed" | "unknown"
  readonly volume?: number
  readonly asOf?: number | null
  readonly high?: number
  readonly low?: number
  readonly prevClose?: number
}

export interface MarketDataDiagnostic {
  readonly code: string
  readonly market: StockMarket
  readonly message: string
}

export interface KlineBar {
  readonly date: string
  readonly open: number
  readonly close: number
  readonly high: number
  readonly low: number
  readonly volume?: number
}

export interface MarketSnapshot {
  readonly quotes: readonly MarketQuote[]
  readonly trend: readonly number[]
  readonly klines?: readonly KlineBar[]
  readonly klinesByCode?: Readonly<Record<string, readonly KlineBar[]>>
  readonly source: string
  readonly diagnostics?: readonly MarketDataDiagnostic[]
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
  readonly volume?: number
  readonly source?: string
}

export interface StockApiKline {
  readonly date: string
  readonly open: number
  readonly close: number
  readonly high: number
  readonly low: number
  readonly volume?: number
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
    if (codes.length === 0) throw new Error("自选股为空")

    const quoteRequest = this.#client.getStocks([...codes])
    const klineRequests = codes.map((code) =>
      this.#client
        .getKlines(code, { period: "day", count: 60 })
        .catch((): readonly StockApiKline[] => []),
    )
    const [rawQuotes, ...rawKlineLists] = await Promise.all([quoteRequest, ...klineRequests])

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
        ...(typeof quote.volume === "number" && quote.volume > 0 ? { volume: quote.volume } : {}),
        ...(Number.isFinite(quote.high) ? { high: quote.high } : {}),
        ...(Number.isFinite(quote.low) ? { low: quote.low } : {}),
        ...(Number.isFinite(quote.yesterday) ? { prevClose: quote.yesterday } : {}),
      })
      if (snapshotSource.length === 0) snapshotSource = source
      else if (snapshotSource !== source) snapshotSource = "多源"
    }

    if (quotes.length === 0) throw new Error("没有可用行情")

    const klinesByCode: Record<string, readonly KlineBar[]> = {}
    const barsByCode = codes.map((code, index) => {
      const bars = toKlineBars(rawKlineLists[index] ?? [])
      if (bars.length > 0) klinesByCode[code] = bars
      return bars
    })
    const klines = barsByCode[0] ?? []
    const trend = klines.map((bar) => bar.close)

    return { quotes, trend, klines, klinesByCode, source: snapshotSource }
  }
}

export class CompositeMarketDataSource implements MarketDataSource {
  readonly #local: MarketDataSource
  readonly #global: MarketDataSource

  constructor(
    local: MarketDataSource = new StockApiMarketDataSource(),
    global: MarketDataSource = new YahooGlobalMarketDataSource(),
  ) {
    this.#local = local
    this.#global = global
  }

  async loadSnapshot(codes: readonly string[]): Promise<MarketSnapshot> {
    if (codes.length === 0) throw new Error("自选股为空")
    const localCodes = codes.filter((code) => isAshareCode(code))
    const globalCodes = codes.filter((code) => !isAshareCode(code))
    const sources = await Promise.all([
      localCodes.length === 0
        ? undefined
        : this.#local
            .loadSnapshot(localCodes)
            .catch(() => failedSnapshot(localCodes, "A股行情暂不可用")),
      globalCodes.length === 0
        ? undefined
        : this.#global
            .loadSnapshot(globalCodes)
            .catch(() => failedSnapshot(globalCodes, "全球行情暂不可用")),
    ])
    const snapshots = sources.filter(
      (snapshot): snapshot is MarketSnapshot => snapshot !== undefined,
    )
    const quotes = snapshots.flatMap((snapshot) => snapshot.quotes)
    if (quotes.length === 0) throw new Error("没有可用行情")
    const focus = codes[0]
    const trend =
      snapshots.find((snapshot) => snapshot.quotes.some((quote) => quote.code === focus))?.trend ??
      []
    const klines =
      snapshots.find((snapshot) => snapshot.quotes.some((quote) => quote.code === focus))?.klines ??
      []
    const diagnostics = snapshots.flatMap((snapshot) => snapshot.diagnostics ?? [])
    const klinesByCode: Record<string, readonly KlineBar[]> = {}
    let hasKlinesByCode = false
    for (const snapshot of snapshots) {
      if (snapshot.klinesByCode === undefined) continue
      hasKlinesByCode = true
      Object.assign(klinesByCode, snapshot.klinesByCode)
    }
    const sourceNames = [...new Set(quotes.map((quote) => quote.source))]
    return {
      quotes,
      trend,
      klines,
      source: sourceNames.length === 1 ? (sourceNames[0] ?? "多源") : "多源",
      diagnostics,
      ...(hasKlinesByCode ? { klinesByCode } : {}),
    }
  }
}

function toKlineBars(rawKlines: readonly StockApiKline[]): KlineBar[] {
  const bars: KlineBar[] = []
  for (const kline of rawKlines) {
    if (Number.isFinite(kline.close) && kline.close > 0) {
      bars.push({
        date: kline.date,
        open: kline.open,
        close: kline.close,
        high: kline.high,
        low: kline.low,
        ...(typeof kline.volume === "number" ? { volume: kline.volume } : {}),
      })
    }
  }
  return bars
}

export function createDefaultMarketDataSource(
  local: MarketDataSource = new StockApiMarketDataSource(),
  global: MarketDataSource = new YahooGlobalMarketDataSource(),
): MarketDataSource {
  return new CompositeMarketDataSource(local, global)
}

function failedSnapshot(codes: readonly string[], message: string): MarketSnapshot {
  const diagnostics = codes.flatMap((code) => {
    const parsed = parseMarketCode(code)
    return parsed === null ? [] : [{ code, market: parsed.market, message }]
  })
  return { quotes: [], trend: [], source: "", diagnostics }
}
