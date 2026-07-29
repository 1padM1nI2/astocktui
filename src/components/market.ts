import type { Component } from "@oh-my-pi/pi-tui"
import { ANSI, highlightReverse } from "../colors"
import type { MarketQuote, MarketSnapshot } from "../market-data"
import { DEFAULT_WATCHLIST, DEFAULT_WATCHLIST_CODES } from "../market-data"
import { MarketSelectionController } from "../market-selection"
import { fitLine } from "../width"
import type { ListScrollState } from "../workspace-scroll"
import { renderMarketDetail } from "./market-detail"
import {
  displayCode,
  marketLabel,
  renderFullTableRow,
  renderTableRow,
  stateLabel,
} from "./market-table"
import { renderFocusStats, renderMiniSparkline, renderSparkline, trendColor } from "./market-trend"

const DEFAULT_NAMES = new Map(DEFAULT_WATCHLIST.map((item) => [item.code, item.name]))

export class MarketWorkspace implements Component {
  #snapshot: MarketSnapshot | null = null
  #status: "idle" | "loading" | "ready" | "error" = "idle"
  #quotesByCode: Readonly<Record<string, MarketQuote>> = {}
  #watchlistCodes: readonly string[]
  readonly #selection = new MarketSelectionController()

  constructor(codes: readonly string[] = DEFAULT_WATCHLIST_CODES) {
    this.#watchlistCodes = [...codes]
  }

  get scroll(): ListScrollState {
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
    this.#selection.recordItemCount(this.#watchlistCodes.length)
    this.#selection.markReady()
    this.#status = "ready"
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

    const lines: string[] = []
    const hasGlobal = this.#watchlistCodes.some((code) => code.includes(":"))
    const expanded = safeWidth >= 64

    if (this.#selection.isInDetailMode) {
      const code = this.#watchlistCodes[this.#selection.selectedIndex]
      if (code !== undefined) {
        const quote = this.#quotesByCode[code]
        return renderMarketDetail({
          code,
          name: quote?.name ?? DEFAULT_NAMES.get(code) ?? code,
          quote,
          klines: this.#snapshot?.klinesByCode?.[code],
          width: safeWidth,
          header: fitLine(`行情 / ${hasGlobal ? "全球股票" : "沪深A股"} 实时 ${status}`, safeWidth),
          marketLabel: marketLabel(quote, code),
          stateLabel: stateLabel(quote),
        })
      }
    }

    const header = fitLine(`行情 / ${hasGlobal ? "全球股票" : "沪深A股"} 实时 ${status}`, safeWidth)
    lines.push(header)
    lines.push("─".repeat(safeWidth))

    lines.push(renderSparkline(this.#snapshot?.trend ?? [], safeWidth))
    lines.push(...renderFocusStats(this.#quotesByCode[this.#watchlistCodes[0] ?? ""], safeWidth))
    lines.push(
      expanded
        ? renderFullTableRow(
            ["代码", "市场/币种", "名称", "现价", "涨跌幅", "走势", "状态"],
            safeWidth,
          )
        : renderTableRow("代码", "名称", "现价", "涨跌幅", safeWidth),
    )
    this.#selection.setHeaderRows(lines.length - 2)
    for (const [rowIndex, code] of this.#watchlistCodes.entries()) {
      const selected =
        this.#selection.isInSelectionMode && rowIndex === this.#selection.selectedIndex
      const quote = this.#quotesByCode[code]
      if (quote === undefined) {
        const row = expanded
          ? renderFullTableRow(
              [
                code,
                marketLabel(undefined, code),
                DEFAULT_NAMES.get(code) ?? "等待行情",
                "--",
                "--",
                "--",
                "--",
              ],
              safeWidth,
            )
          : renderTableRow(
              displayCode(code),
              DEFAULT_NAMES.get(code) ?? "等待行情",
              "--",
              "--",
              safeWidth,
            )
        lines.push(selected ? highlightReverse(row) : row)
        continue
      }
      const sign = quote.changePercent > 0 ? "+" : ""
      const color = trendColor(quote.changePercent)
      const reset = color.length > 0 ? ANSI.reset : ""
      const change = `${color}${sign}${quote.changePercent.toFixed(2)}%${reset}`
      const row = expanded
        ? renderFullTableRow(
            [
              quote.code,
              marketLabel(quote, quote.code),
              quote.name,
              quote.price.toFixed(2),
              change,
              renderMiniSparkline(quote.trend, quote.changePercent),
              stateLabel(quote),
            ],
            safeWidth,
          )
        : renderTableRow(
            displayCode(quote.code),
            quote.name,
            quote.price.toFixed(2),
            change,
            safeWidth,
          )
      lines.push(selected ? highlightReverse(row) : row)
    }
    return lines
  }
}
