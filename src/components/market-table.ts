import { alignCell, fitLine } from "../app/width"
import type { MarketQuote } from "../market/market-data"
import { isContinuousAuction } from "../trading/trading-calendar"

const CODE_WIDTH = 6
const NAME_WIDTH = 10
const PRICE_WIDTH = 10
const CHANGE_WIDTH = 9
const TABLE_GAP = "  "
const FULL_CODE_WIDTH = 9
const MARKET_WIDTH = 8
const STATE_WIDTH = 6
const MINI_SPARK_WIDTH = 12

export function displayCode(code: string): string {
  return /^(?:SH|SZ)\d{6}$/u.test(code)
    ? code.slice(2)
    : code.startsWith("US:") || code.startsWith("JP:") || code.startsWith("KR:")
      ? code.slice(3)
      : code
}

export function marketLabel(quote: MarketQuote | undefined, code: string): string {
  const market =
    quote?.market ??
    (code.startsWith("US:")
      ? "US"
      : code.startsWith("JP:")
        ? "JP"
        : code.startsWith("KR:")
          ? "KR"
          : "CN")
  const currency =
    quote?.currency ??
    (market === "US" ? "USD" : market === "JP" ? "JPY" : market === "KR" ? "KRW" : "CNY")
  return `${market} ${currency}`
}

export function stateLabel(quote: MarketQuote | undefined): string {
  if (quote?.marketState === "open") return "交易中"
  if (quote?.marketState === "closed") return "已收盘"
  if (quote?.marketState === "delayed") return "延迟"
  if (quote !== undefined && (quote.market ?? "CN") === "CN") {
    return isContinuousAuction(new Date()) ? "交易中" : "已收盘"
  }
  return "--"
}

export function renderFullTableRow(cells: readonly string[], width: number): string {
  const columns = [
    FULL_CODE_WIDTH,
    MARKET_WIDTH,
    NAME_WIDTH,
    PRICE_WIDTH,
    CHANGE_WIDTH,
    MINI_SPARK_WIDTH,
    STATE_WIDTH,
  ]
  return fitLine(
    cells
      .map((cell, index) =>
        alignCell(cell, columns[index] ?? NAME_WIDTH, index < 3 || index === 5 ? "left" : "right"),
      )
      .join(TABLE_GAP),
    width,
  )
}

export function renderTableRow(
  code: string,
  name: string,
  price: string,
  change: string,
  width: number,
): string {
  const row =
    `${alignCell(code, CODE_WIDTH, "left")}${TABLE_GAP}` +
    `${alignCell(name, NAME_WIDTH, "left")}${TABLE_GAP}` +
    `${alignCell(price, PRICE_WIDTH, "right")}${TABLE_GAP}` +
    alignCell(change, CHANGE_WIDTH, "right")
  return fitLine(row, width)
}
