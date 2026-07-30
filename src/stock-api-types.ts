import type { KlineBar } from "./market-data"

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
