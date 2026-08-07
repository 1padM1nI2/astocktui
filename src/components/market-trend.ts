import { ANSI } from "../app/colors"
import { fitLine } from "../app/width"
import type { MarketQuote } from "../market/data"

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
  // 等距取样且始终包含首尾点，确保最新收盘价出现在末端
  const barCount = Math.max(2, Math.min(slots, prices.length))
  let spark = ""
  for (let bar = 0; bar < barCount; bar++) {
    const index = Math.round((bar * (prices.length - 1)) / (barCount - 1))
    const price = prices[index] ?? min
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

export function renderMiniSparkline(
  prices: readonly number[] | undefined,
  changePercent?: number,
): string {
  if (prices === undefined || prices.length < 2) return "--"
  const spark = sparklineBlocks(prices, MINI_SPARK_WIDTH)
  // 优先按当日涨跌幅着色，避免长期趋势掩盖当日方向
  const change = changePercent ?? (prices[prices.length - 1] ?? 0) - (prices[0] ?? 0)
  const color = trendColor(change)
  const reset = color.length > 0 ? ANSI.reset : ""
  return `${color}${spark}${reset}`
}

export function renderFocusStats(quote: MarketQuote | undefined, width: number): readonly string[] {
  if (quote === undefined) return []
  const parts: string[] = []
  if (quote.open !== undefined) parts.push(`今开 ${quote.open.toFixed(2)}`)
  if (quote.high !== undefined) parts.push(`最高 ${quote.high.toFixed(2)}`)
  if (quote.low !== undefined) parts.push(`最低 ${quote.low.toFixed(2)}`)
  if (quote.previousClose !== undefined) parts.push(`昨收 ${quote.previousClose.toFixed(2)}`)
  if (quote.volume !== undefined)
    parts.push(
      `量 ${quote.volume >= 10_000 ? `${(quote.volume / 10_000).toFixed(1)}万手` : `${Math.round(quote.volume)}手`}`,
    )
  const lines: string[] = []
  if (parts.length > 0) lines.push(fitLine(parts.join(" · "), width))
  const detail = quote.detail
  if (detail !== undefined) {
    const extra: string[] = []
    if (detail.turnover !== undefined)
      extra.push(
        `成交额 ${detail.turnover >= 10_000 ? `${(detail.turnover / 10_000).toFixed(1)}亿` : `${Math.round(detail.turnover)}万`}`,
      )
    if (detail.turnoverRate !== undefined) extra.push(`换手 ${detail.turnoverRate.toFixed(2)}%`)
    if (detail.amplitude !== undefined) extra.push(`振幅 ${detail.amplitude.toFixed(2)}%`)
    if (detail.peTtm !== undefined) extra.push(`PE ${detail.peTtm.toFixed(1)}`)
    if (detail.totalMarketCap !== undefined)
      extra.push(
        `总市值 ${detail.totalMarketCap >= 10_000 ? `${(detail.totalMarketCap / 10_000).toFixed(2)}万亿` : `${detail.totalMarketCap.toFixed(0)}亿`}`,
      )
    if (detail.limitUp !== undefined && detail.limitDown !== undefined)
      extra.push(`涨停 ${detail.limitUp.toFixed(2)} / 跌停 ${detail.limitDown.toFixed(2)}`)
    if (extra.length > 0) lines.push(fitLine(extra.join(" · "), width))
  }
  return lines
}
