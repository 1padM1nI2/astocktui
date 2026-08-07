import { visibleWidth } from "@oh-my-pi/pi-tui"
import { ANSI } from "../app/colors"
import { alignCell, fitLine } from "../app/width"
import type { KlineBar, MarketQuote } from "../market/data"
import { renderKlineChart } from "../market/kline-chart"

export interface MarketDetailView {
  readonly code: string
  readonly name: string
  readonly quote: MarketQuote | undefined
  readonly klines: readonly KlineBar[] | undefined
  readonly width: number
  readonly header: string
  readonly marketLabel: string
  readonly stateLabel: string
}

function trendColor(change: number): string {
  if (change > 0) return ANSI.red
  if (change < 0) return ANSI.green
  return ""
}

function fmtPrice(value: number | undefined, color = ""): string {
  if (value === undefined) return "--"
  return color.length > 0 ? `${color}${value.toFixed(2)}${ANSI.reset}` : value.toFixed(2)
}

function formatVolume(v: number): string {
  if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(2)}亿手`
  if (v >= 10_000) return `${(v / 10_000).toFixed(1)}万手`
  return `${v}手`
}

export function renderMarketDetail(view: MarketDetailView): string[] {
  const w = Math.max(0, view.width | 0)
  const lines: string[] = [fitLine(view.header, w), "─".repeat(w)]

  if (view.quote === undefined) {
    lines.push(
      fitLine(
        ` ${ANSI.bold}${view.name}${ANSI.reset} ${ANSI.brightBlack}${view.code}${ANSI.reset}`,
        w,
      ),
      "",
      fitLine(` ${ANSI.brightBlack}等待行情加载...${ANSI.reset}`, w),
      "",
      fitLine(` ${ANSI.brightBlack}[Esc 返回]${ANSI.reset}`, w),
    )
    return lines
  }

  const quote = view.quote
  const color = trendColor(quote.changePercent)
  const rst = color.length > 0 ? ANSI.reset : ""
  const sign = quote.changePercent > 0 ? "+" : ""

  // 标题行：名称代码居左，市场与状态居右（宽度不足时省略右侧）
  const title = ` ${ANSI.bold}${view.name}${ANSI.reset} ${ANSI.brightBlack}${view.code}${ANSI.reset}`
  const tail = `${ANSI.brightBlack}${view.marketLabel} · ${view.stateLabel}${ANSI.reset}`
  const gap = w - visibleWidth(title) - visibleWidth(tail)
  lines.push(fitLine(gap >= 2 ? `${title}${" ".repeat(gap)}${tail}` : title, w))

  // 主价格行：现价 + 涨跌幅 + 涨跌额
  const chg = quote.previousClose !== undefined ? quote.price - quote.previousClose : undefined
  let hero = ` ${color}${ANSI.bold}${quote.price.toFixed(2)}${ANSI.reset}${rst} ${color}${sign}${quote.changePercent.toFixed(2)}%${rst}`
  if (chg !== undefined) hero += ` ${color}(${chg > 0 ? "+" : ""}${chg.toFixed(2)})${rst}`
  lines.push(fitLine(hero, w), "")

  // 双列信息栏
  const tk = view.klines?.[view.klines.length - 1]
  const openColor =
    tk !== undefined && quote.previousClose !== undefined
      ? tk.open > quote.previousClose
        ? ANSI.red
        : tk.open < quote.previousClose
          ? ANSI.green
          : ""
      : ""
  const amplitude =
    quote.high !== undefined && quote.low !== undefined && quote.previousClose
      ? ((quote.high - quote.low) / quote.previousClose) * 100
      : undefined
  const volume = quote.volume ?? tk?.volume
  const detail = quote.detail
  const pairs: readonly (readonly [string, string])[] = [
    [
      `今开 ${fmtPrice(tk?.open ?? quote.open, openColor)}`,
      `最高 ${fmtPrice(quote.high, ANSI.red)}`,
    ],
    [
      `最低 ${fmtPrice(quote.low, ANSI.green)}`,
      `昨收 ${fmtPrice(quote.previousClose, ANSI.brightBlack)}`,
    ],
    [
      `振幅 ${amplitude !== undefined ? `${amplitude.toFixed(2)}%` : "--"}`,
      `成交量 ${volume !== undefined ? formatVolume(volume) : "--"}`,
    ],
    ...(detail === undefined
      ? []
      : ([
          [
            `成交额 ${detail.turnover !== undefined ? `${detail.turnover >= 10_000 ? `${(detail.turnover / 10_000).toFixed(1)}亿` : `${Math.round(detail.turnover)}万`}` : "--"}`,
            `换手 ${detail.turnoverRate !== undefined ? `${detail.turnoverRate.toFixed(2)}%` : "--"}`,
          ],
          [
            `PE ${detail.peTtm !== undefined ? detail.peTtm.toFixed(1) : "--"}`,
            `总市值 ${detail.totalMarketCap !== undefined ? `${detail.totalMarketCap >= 10_000 ? `${(detail.totalMarketCap / 10_000).toFixed(2)}万亿` : `${detail.totalMarketCap.toFixed(0)}亿`}` : "--"}`,
          ],
          [
            `量比 ${detail.volumeRatio !== undefined ? detail.volumeRatio.toFixed(2) : "--"}`,
            `涨停 ${fmtPrice(detail.limitUp, ANSI.red)} / 跌停 ${fmtPrice(detail.limitDown, ANSI.green)}`,
          ],
        ] as const)),
  ]
  const pairWidth = Math.max(0, Math.floor((w - 3) / 2))
  for (const [left, right] of pairs) {
    lines.push(fitLine(` ${alignCell(left, pairWidth, "left")}  ${right}`, w))
  }

  if (view.klines !== undefined && view.klines.length >= 2) {
    lines.push(
      "",
      fitLine(` ${ANSI.brightBlack}日K线图（近${view.klines.length}日）${ANSI.reset}`, w),
    )
    for (const line of renderKlineChart(view.klines, w - 1)) lines.push(fitLine(` ${line}`, w))
  }

  lines.push("", fitLine(` ${ANSI.brightBlack}[Esc 返回]  [↑↓ 切换股票]${ANSI.reset}`, w))
  return lines
}
