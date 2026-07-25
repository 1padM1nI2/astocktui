import type { Component } from "@oh-my-pi/pi-tui"
import { ANSI } from "../colors"
import type { MarketQuote, MarketSnapshot } from "../market-data"
import { DEFAULT_WATCHLIST, DEFAULT_WATCHLIST_CODES } from "../market-data"
import { MarketSelectionController } from "../market-selection"
import { isContinuousAuction } from "../trading-calendar"
import { alignCell, fitLine } from "../width"
import { renderMarketDetail } from "./market-detail"
import { renderSparkline } from "../kline-chart"

const DEFAULT_NAMES = new Map(DEFAULT_WATCHLIST.map((item) => [item.code, item.name]))

function trendColor(change: number): string {
  if (change > 0) return ANSI.red
  if (change < 0) return ANSI.green
  return ""
}

const CODE_WIDTH = 6
const NAME_WIDTH = 10
const PRICE_WIDTH = 10
const CHANGE_WIDTH = 9
const TABLE_GAP = "  "
const FULL_CODE_WIDTH = 9
const MARKET_WIDTH = 8
const STATE_WIDTH = 6

function displayCode(code: string): string {
  return /^(?:SH|SZ)\d{6}$/u.test(code)
    ? code.slice(2)
    : code.startsWith("US:") || code.startsWith("JP:") || code.startsWith("KR:")
      ? code.slice(3)
      : code
}

function marketLabel(quote: MarketQuote | undefined, code: string): string {
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

function stateLabel(quote: MarketQuote | undefined): string {
  if (quote?.marketState === "open") return "交易中"
  if (quote?.marketState === "closed") return "已收盘"
  if (quote?.marketState === "delayed") return "延迟"
  if (quote !== undefined && (quote.market ?? "CN") === "CN") {
    return isContinuousAuction(new Date()) ? "交易中" : "已收盘"
  }
  return "--"
}

function renderFullTableRow(cells: readonly string[], width: number): string {
  const columns = [
    FULL_CODE_WIDTH,
    MARKET_WIDTH,
    NAME_WIDTH,
    PRICE_WIDTH,
    CHANGE_WIDTH,
    STATE_WIDTH,
  ]
  return fitLine(
    cells
      .map((cell, index) =>
        alignCell(cell, columns[index] ?? NAME_WIDTH, index < 3 ? "left" : "right"),
      )
      .join(TABLE_GAP),
    width,
  )
}

function renderTableRow(
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

export class MarketWorkspace implements Component {
  #snapshot: MarketSnapshot | null = null
  #status: "idle" | "loading" | "ready" | "error" = "idle"
  #quotesByCode: Readonly<Record<string, MarketQuote>> = {}
  #watchlistCodes: readonly string[]
  readonly #selection = new MarketSelectionController()

  constructor(codes: readonly string[] = DEFAULT_WATCHLIST_CODES) {
    this.#watchlistCodes = [...codes]
    this.#selection.recordItemCount(this.#watchlistCodes.length)
  }

  get scroll() {
    return this.#selection.scroll
  }

  get isInDetailMode(): boolean {
    return this.#selection.isInDetailMode
  }

  handleInput(data: string): boolean {
    return this.#selection.handleInput(data)
  }

  setWatchlist(codes: readonly string[]): void {
    this.#watchlistCodes = [...codes]
    this.#selection.recordItemCount(codes.length)
  }

  get status(): "idle" | "loading" | "ready" | "error" {
    return this.#status
  }

  get source(): string | null {
    return this.#snapshot?.source ?? null
  }

  get snapshot(): MarketSnapshot | null {
    return this.#snapshot
  }

  findQuote(code: string): MarketQuote | undefined {
    const normalized = code.trim().toUpperCase()
    const direct = this.#quotesByCode[normalized]
    if (direct !== undefined) return direct
    for (const quote of Object.values(this.#quotesByCode)) {
      if (quote.code.toUpperCase().endsWith(normalized)) return quote
    }
    return undefined
  }

  beginRefresh(): void {
    this.#status = "loading"
  }

  applySnapshot(snapshot: MarketSnapshot): void {
    this.#snapshot = snapshot
    const quotesByCode: Record<string, MarketQuote> = {}
    for (const quote of snapshot.quotes) quotesByCode[quote.code] = quote
    this.#quotesByCode = quotesByCode
    this.#status = "ready"
    this.#selection.markReady()
  }

  failRefresh(): void {
    this.#status = "error"
  }

  render(width: number): readonly string[] {
    const safeWidth = Math.max(0, width | 0)
    let status = `${ANSI.brightBlack}[未加载 · R刷新]${ANSI.reset}`
    if (this.#status === "loading") status = `${ANSI.yellow}[更新中]${ANSI.reset}`
    else if (this.#status === "ready") {
      status = `${ANSI.brightBlack}[数据源 ${this.#snapshot?.source ?? "stock-api"} · R刷新]${ANSI.reset}`
    } else if (this.#status === "error") {
      status = `${ANSI.brightRed}[获取失败 · R重试]${ANSI.reset}`
    }
    const hasGlobal = this.#watchlistCodes.some((code) => code.includes(":"))
    const expanded = safeWidth >= 64

    if (this.#selection.isInDetailMode) {
      const code = this.#watchlistCodes[this.#selection.selectedIndex]
      if (code !== undefined) {
        return this.#renderDetail(code, safeWidth, status, hasGlobal)
      }
    }

    const lines: string[] = []
    lines.push(fitLine(`行情 / ${hasGlobal ? "全球股票" : "沪深A股"} 实时 ${status}`, safeWidth))
    lines.push("─".repeat(safeWidth))
    lines.push(renderSparkline(this.#snapshot?.trend ?? [], safeWidth))
    lines.push(
      expanded
        ? renderFullTableRow(["代码", "市场/币种", "名称", "现价", "涨跌幅", "状态"], safeWidth)
        : renderTableRow("代码", "名称", "现价", "涨跌幅", safeWidth),
    )
    for (let rowIndex = 0; rowIndex < this.#watchlistCodes.length; rowIndex++) {
      const code = this.#watchlistCodes[rowIndex] ?? ""
      const quote = this.#quotesByCode[code]
      const isSelected = rowIndex === this.#selection.selectedIndex
      let row: string
      if (quote === undefined) {
        row = expanded
          ? renderFullTableRow(
              [code, marketLabel(undefined, code), DEFAULT_NAMES.get(code) ?? "等待行情", "--", "--", "--"],
              safeWidth,
            )
          : renderTableRow(displayCode(code), DEFAULT_NAMES.get(code) ?? "等待行情", "--", "--", safeWidth)
      } else {
        const sign = quote.changePercent > 0 ? "+" : ""
        const color = trendColor(quote.changePercent)
        const reset = color.length > 0 ? ANSI.reset : ""
        const change = `${color}${sign}${quote.changePercent.toFixed(2)}%${reset}`
        row = expanded
          ? renderFullTableRow(
              [quote.code, marketLabel(quote, quote.code), quote.name, quote.price.toFixed(2), change, stateLabel(quote)],
              safeWidth,
            )
          : renderTableRow(displayCode(quote.code), quote.name, quote.price.toFixed(2), change, safeWidth)
      }
      lines.push(isSelected ? `${ANSI.cyan}${ANSI.reverse}${row}${ANSI.reset}` : row)
    }
    return lines
  }

  #renderDetail(code: string, safeWidth: number, status: string, hasGlobal: boolean): string[] {
    const quote = this.#quotesByCode[code]
    const name = quote?.name ?? (DEFAULT_NAMES.get(code) ?? "等待行情")
    return renderMarketDetail({
      code,
      name,
      quote,
      klines: this.#snapshot?.klinesByCode?.[code],
      width: safeWidth,
      header: fitLine(`行情 / ${hasGlobal ? "全球股票" : "沪深A股"} 实时 ${status}`, safeWidth),
      marketLabel: marketLabel(quote, code),
      stateLabel: stateLabel(quote),
    })
  }
}
