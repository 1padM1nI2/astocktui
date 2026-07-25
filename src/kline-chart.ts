import { ANSI } from "./colors"
import type { KlineBar } from "./market-data"
import { alignCell, fitLine } from "./width"

const CHART_ROWS = 8
const VOLUME_ROWS = 3

export function renderSparkline(prices: readonly number[], width: number): string {
  if (width < 20 || prices.length < 2) return fitLine("走势 无数据", width)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const barSlots = Math.max(4, width - 20)
  const step = Math.max(1, Math.floor((prices.length - 1) / barSlots))
  let bars = ""
  for (let i = step; i < prices.length; i += step) {
    const prev = prices[i - step] ?? prices[i - 1] ?? 0
    const curr = prices[i] ?? prev
    bars += curr > prev ? `${ANSI.red}|` : curr < prev ? `${ANSI.green}|` : "|"
  }
  return fitLine(`走势 ${min.toFixed(2)} ${bars}${ANSI.reset} ${max.toFixed(2)}`, width)
}

export function computeMA(klines: readonly KlineBar[], period: number): number[] {
  const r: number[] = []
  for (let i = 0; i < klines.length; i++) {
    if (i < period - 1) { r.push(NaN); continue }
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += klines[j]!.close
    r.push(sum / period)
  }
  return r
}

// 宽度放不下全部交易日时靠右取最近的一段，最新一天始终贴右边缘
function recentWindow(klines: readonly KlineBar[], cols: number): KlineBar[] {
  return klines.length > cols ? [...klines.slice(klines.length - cols)] : [...klines]
}

function renderCandles(
  klines: readonly KlineBar[],
  width: number,
  gutter: number,
  cols: number,
): string[] {
  const minLow = Math.min(...klines.map((k) => k.low))
  const maxHigh = Math.max(...klines.map((k) => k.high))
  const range = maxHigh - minLow || 1
  const bars = recentWindow(klines, cols)
  const offset = Math.max(0, cols - bars.length)

  const ma5 = computeMA(bars, 5)
  const ma10 = computeMA(bars, 10)
  const ma20 = computeMA(bars, 20)

  const labelRows = new Map<number, string>([
    [CHART_ROWS - 1, maxHigh.toFixed(2)],
    [Math.floor((CHART_ROWS - 1) / 2), ((maxHigh + minLow) / 2).toFixed(2)],
    [0, minLow.toFixed(2)],
  ])
  const halfRange = range / CHART_ROWS

  const result: string[] = []
  for (let row = CHART_ROWS - 1; row >= 0; row--) {
    const price = minLow + (range * (row + 0.5)) / CHART_ROWS
    let cells = " ".repeat(offset)
    for (let col = 0; col < bars.length; col++) {
      const k = bars[col]!
      const bodyTop = Math.max(k.open, k.close)
      const bodyBot = Math.min(k.open, k.close)
      const c = k.close >= k.open ? ANSI.red : ANSI.green

      const nearMa = (v: number, sym: string) =>
        isFinite(v) && Math.abs(price - v) < halfRange ? sym : ""

      if (price <= bodyTop && price >= bodyBot) cells += `${c}█${ANSI.reset}`
      else if (price <= k.high && price >= k.low) cells += `${c}│${ANSI.reset}`
      else {
        const dot = nearMa(ma5[col]!, `${ANSI.brightWhite}·${ANSI.reset}`)
          || nearMa(ma10[col]!, `${ANSI.yellow}·${ANSI.reset}`)
          || nearMa(ma20[col]!, `${ANSI.cyan}·${ANSI.reset}`)
        cells += dot || " "
      }
    }
    result.push(fitLine(`${alignCell(labelRows.get(row) ?? "", gutter, "right")}┤${cells}`, width))
  }

  result.push(fitLine(`${" ".repeat(gutter)}└${"─".repeat(cols)}`, width))
  const firstDate = bars[0]?.date.slice(5) ?? ""
  const lastDate = bars[bars.length - 1]?.date.slice(5) ?? ""
  const gap = Math.max(1, cols - firstDate.length - lastDate.length)
  result.push(fitLine(`${" ".repeat(gutter + 1)}${firstDate}${" ".repeat(gap)}${lastDate}`, width))

  const last = bars.length - 1
  const fmt = (v: number | undefined): string =>
    v !== undefined && isFinite(v) ? v.toFixed(2) : "--"
  const maText = [
    `${ANSI.brightWhite}MA5 ${fmt(ma5[last])}${ANSI.reset}`,
    `${ANSI.yellow}MA10 ${fmt(ma10[last])}${ANSI.reset}`,
    `${ANSI.cyan}MA20 ${fmt(ma20[last])}${ANSI.reset}`,
  ].join("  ")
  result.push(fitLine(`${" ".repeat(gutter + 1)}${maText}`, width))
  return result
}

function renderVolume(
  klines: readonly KlineBar[],
  width: number,
  gutter: number,
  cols: number,
): string[] {
  const bars = recentWindow(klines, cols)
  const maxVol = Math.max(...bars.map((k) => k.volume ?? 0))
  if (maxVol === 0) return []
  const offset = Math.max(0, cols - bars.length)

  const result: string[] = []
  for (let row = VOLUME_ROWS - 1; row >= 0; row--) {
    let cells = " ".repeat(offset)
    for (const k of bars) {
      const vol = k.volume ?? 0
      const threshold = (maxVol * (row + 0.5)) / VOLUME_ROWS
      const c = k.close >= k.open ? ANSI.red : ANSI.green
      cells += vol >= threshold ? `${c}▌${ANSI.reset}` : " "
    }
    result.push(fitLine(`${" ".repeat(gutter + 1)}${cells}`, width))
  }
  const t = maxVol >= 100_000_000 ? `${(maxVol / 100_000_000).toFixed(1)}亿`
    : maxVol >= 10_000 ? `${(maxVol / 10_000).toFixed(0)}万` : `${maxVol}`
  result.push(fitLine(`${" ".repeat(gutter + 1)}${ANSI.brightBlack}成交量 最大 ${t}${ANSI.reset}`, width))
  return result
}

export function renderKlineChart(klines: readonly KlineBar[], width: number): string[] {
  if (klines.length < 2) return [fitLine("K线数据不足", width)]
  const minLow = Math.min(...klines.map((k) => k.low))
  const maxHigh = Math.max(...klines.map((k) => k.high))
  const gutter = Math.max(minLow.toFixed(2).length, maxHigh.toFixed(2).length)
  const cols = Math.max(4, width - gutter - 2)
  return [
    ...renderCandles(klines, width, gutter, cols),
    ...renderVolume(klines, width, gutter, cols),
  ]
}
