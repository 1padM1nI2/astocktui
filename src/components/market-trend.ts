import { ANSI } from "../colors"
import type { MarketQuote } from "../market-data"
import { fitLine } from "../width"

const SPARK_LEVELS = "▁▂▃▄▅▆▇█"
const MINI_SPARK_WIDTH = 12

export function trendColor(change: number): string {
  if (change > 0) return ANSI.red
  if (change < 0) return ANSI.green
  return ""
}

function sparklineBlocks(prices: readonly number[], slots: number): string {
  if (prices.length < 2) return ""
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min
  const step = Math.max(1, Math.ceil(prices.length / slots))
  let spark = ""
  for (let i = 0; i < prices.length; i += step) {
    const price = prices[i] ?? min
    const level = range === 0 ? 3 : Math.round(((price - min) / range) * 7)
    spark += SPARK_LEVELS[level]
  }
  return spark
}

export function renderSparkline(prices: readonly number[], width: number): string {
  if (width < 20 || prices.length < 2) return fitLine("走势 无数据", width)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const labelWidth = 20
  const barSlots = Math.max(4, width - labelWidth)
  const spark = sparklineBlocks(prices, barSlots)
  const change = (prices[prices.length - 1] ?? 0) - (prices[0] ?? 0)
  const color = trendColor(change)
  const reset = color.length > 0 ? ANSI.reset : ""
  return fitLine(`走势 ${min.toFixed(2)} ${color}${spark}${reset} ${max.toFixed(2)}`, width)
}

export function renderMiniSparkline(prices: readonly number[] | undefined): string {
  if (prices === undefined || prices.length < 2) return "--"
  const spark = sparklineBlocks(prices, MINI_SPARK_WIDTH)
  const change = (prices[prices.length - 1] ?? 0) - (prices[0] ?? 0)
  const color = trendColor(change)
  const reset = color.length > 0 ? ANSI.reset : ""
  return `${color}${spark}${reset}`
}

export function renderFocusStats(quote: MarketQuote | undefined, width: number): string | null {
  if (quote === undefined) return null
  const parts: string[] = []
  if (quote.open !== undefined) parts.push(`今开 ${quote.open.toFixed(2)}`)
  if (quote.high !== undefined) parts.push(`最高 ${quote.high.toFixed(2)}`)
  if (quote.low !== undefined) parts.push(`最低 ${quote.low.toFixed(2)}`)
  if (quote.previousClose !== undefined) parts.push(`昨收 ${quote.previousClose.toFixed(2)}`)
  if (quote.volume !== undefined)
    parts.push(
      `量 ${quote.volume >= 10_000 ? `${(quote.volume / 10_000).toFixed(1)}万手` : `${Math.round(quote.volume)}手`}`,
    )
  return parts.length === 0 ? null : fitLine(parts.join(" · "), width)
}
