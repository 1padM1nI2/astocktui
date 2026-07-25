import { stocks } from "stock-api"
import { YahooGlobalMarketDataSource } from "./global-market-data"
import { isAshareCode, normalizeMarketCode, parseMarketCode, type StockMarket } from "./market-code"
import { fetchTencentStockDetails, type StockDetail, type StockDetailFetcher } from "./stock-detail"

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
  readonly open?: number
  readonly high?: number
  readonly low?: number
  readonly previousClose?: number
  readonly volume?: number
  readonly trend?: readonly number[]
  readonly detail?: StockDetail
  readonly asOf?: number | null
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
  readonly close: number
  readonly date?: string
  readonly open?: number
  readonly high?: number
  readonly low?: number
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

export function toKlineBars(klines: readonly StockApiKline[]): readonly KlineBar[] {
  return klines
    .filter((kline) => Number.isFinite(kline.close) && kline.close > 0)
    .map((kline) => ({
      date: kline.date ?? "",
      open: typeof kline.open === "number" && kline.open > 0 ? kline.open : kline.close,
      close: kline.close,
      high: typeof kline.high === "number" && kline.high > 0 ? kline.high : kline.close,
      low: typeof kline.low === "number" && kline.low > 0 ? kline.low : kline.close,
      ...(typeof kline.volume === "number" && kline.volume > 0 ? { volume: kline.volume } : {}),
    }))
}

const KLINE_CACHE_TTL_MS = 5 * 60_000

export class StockApiMarketDataSource implements MarketDataSource {
  readonly #client: StockApiClient
  readonly #now: () => number
  readonly #detailFetcher: StockDetailFetcher | undefined
  readonly #klineCache = new Map<
    string,
    { readonly at: number; readonly klines: readonly StockApiKline[] }
  >()

  constructor(
    client: StockApiClient = stocks.auto,
    now: () => number = Date.now,
    detailFetcher: StockDetailFetcher | undefined = fetchTencentStockDetails,
  ) {
    this.#client = client
    this.#now = now
    this.#detailFetcher = detailFetcher
  }

  async loadSnapshot(codes: readonly string[]): Promise<MarketSnapshot> {
    const focusCode = codes[0]
    if (focusCode === undefined) throw new Error("自选股为空")

    const [rawQuotes, klines, details] = await Promise.all([
      this.#client.getStocks([...codes]),
      Promise.all(codes.map((code) => this.#loadKlines(code))),
      this.#detailFetcher?.(codes).catch((): ReadonlyMap<string, StockDetail> => new Map()) ??
        Promise.resolve(new Map<string, StockDetail>()),
    ])
    const klinesByCode = new Map(codes.map((code, index) => [code, klines[index] ?? []]))

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

      const rows = klinesByCode.get(quote.code) ?? []
      const quoteTrend = rows
        .filter((kline) => Number.isFinite(kline.close) && kline.close > 0)
        .map((kline) => kline.close)
      const lastKline = rows.at(-1)
      const open = lastKline?.open ?? details.get(quote.code)?.open
      const klineVolume = lastKline?.volume
      const volume =
        typeof quote.volume === "number" && quote.volume > 0
          ? quote.volume
          : typeof klineVolume === "number" && klineVolume > 0
            ? klineVolume
            : details.get(quote.code)?.volume
      const detail = details.get(quote.code)
      quotes.push({
        code: quote.code,
        name: quote.name,
        price: quote.now,
        changePercent: Math.round(quote.percent * 1_000_000) / 10_000,
        source,
        ...(typeof open === "number" && open > 0 ? { open } : {}),
        ...(quote.high > 0 ? { high: quote.high } : {}),
        ...(quote.low > 0 ? { low: quote.low } : {}),
        ...(quote.yesterday > 0 ? { previousClose: quote.yesterday } : {}),
        ...(volume === undefined ? {} : { volume }),
        ...(quoteTrend.length > 0 ? { trend: quoteTrend } : {}),
        ...(detail === undefined ? {} : { detail }),
      })
      if (snapshotSource.length === 0) snapshotSource = source
      else if (snapshotSource !== source) snapshotSource = "多源"
    }

    if (quotes.length === 0) throw new Error("没有可用行情")

    const focusTrend = (klinesByCode.get(focusCode) ?? [])
      .filter((kline) => Number.isFinite(kline.close) && kline.close > 0)
      .map((kline) => kline.close)
    return {
      quotes,
      trend: focusTrend,
      klinesByCode: Object.fromEntries(
        codes.map((code) => [code, toKlineBars(klinesByCode.get(code) ?? [])]),
      ),
      source: snapshotSource,
    }
  }

  async #loadKlines(code: string): Promise<readonly StockApiKline[]> {
    const cached = this.#klineCache.get(code)
    if (cached !== undefined && this.#now() - cached.at < KLINE_CACHE_TTL_MS) return cached.klines
    const klines = await this.#client
      .getKlines(code, { period: "day", count: 60 })
      .catch((): readonly StockApiKline[] => [])
    this.#klineCache.set(code, { at: this.#now(), klines })
    return klines
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
    const diagnostics = snapshots.flatMap((snapshot) => snapshot.diagnostics ?? [])
    const klinesByCode: Record<string, readonly KlineBar[]> = {}
    for (const snapshot of snapshots) Object.assign(klinesByCode, snapshot.klinesByCode)
    const sourceNames = [...new Set(quotes.map((quote) => quote.source))]
    return {
      quotes,
      trend,
      klinesByCode,
      source: sourceNames.length === 1 ? (sourceNames[0] ?? "多源") : "多源",
      diagnostics,
    }
  }
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
