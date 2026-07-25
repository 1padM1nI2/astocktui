import type { Component } from "@oh-my-pi/pi-tui"
import { ANSI } from "../colors"
import type { MarketQuote, MarketSnapshot } from "../market-data"
import { DEFAULT_WATCHLIST, DEFAULT_WATCHLIST_CODES } from "../market-data"
import { alignCell, fitLine } from "../width"
import { ListScrollState } from "../workspace-scroll"
import { renderFocusStats, renderMiniSparkline, renderSparkline, trendColor } from "./market-trend"

const DEFAULT_NAMES = new Map(DEFAULT_WATCHLIST.map((item) => [item.code, item.name]))

const CODE_WIDTH = 6
const NAME_WIDTH = 10
const PRICE_WIDTH = 10
const CHANGE_WIDTH = 9
const TABLE_GAP = "  "
const FULL_CODE_WIDTH = 9
const MARKET_WIDTH = 8
const STATE_WIDTH = 6
const MINI_SPARK_WIDTH = 12

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
  return "--"
}

function renderFullTableRow(cells: readonly string[], width: number): string {
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
  readonly #scroll = new ListScrollState()

  constructor(codes: readonly string[] = DEFAULT_WATCHLIST_CODES) {
    this.#watchlistCodes = [...codes]
  }

  get scroll(): ListScrollState {
    return this.#scroll
  }

  handleInput(data: string): boolean {
    return this.#scroll.handleInput(data)
  }

  setWatchlist(codes: readonly string[]): void {
    this.#watchlistCodes = [...codes]
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
    lines.push(fitLine(`行情 / ${hasGlobal ? "全球股票" : "沪深A股"} 实时 ${status}`, safeWidth))
    lines.push("─".repeat(safeWidth))
    lines.push(renderSparkline(this.#snapshot?.trend ?? [], safeWidth))
    const focusStats = renderFocusStats(
      this.#quotesByCode[this.#watchlistCodes[0] ?? ""],
      safeWidth,
    )
    if (focusStats !== null) lines.push(focusStats)
    lines.push(
      expanded
        ? renderFullTableRow(
            ["代码", "市场/币种", "名称", "现价", "涨跌幅", "走势", "状态"],
            safeWidth,
          )
        : renderTableRow("代码", "名称", "现价", "涨跌幅", safeWidth),
    )
    for (const code of this.#watchlistCodes) {
      const quote = this.#quotesByCode[code]
      if (quote === undefined) {
        lines.push(
          expanded
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
              ),
        )
        continue
      }
      const sign = quote.changePercent > 0 ? "+" : ""
      const color = trendColor(quote.changePercent)
      const reset = color.length > 0 ? ANSI.reset : ""
      const change = `${color}${sign}${quote.changePercent.toFixed(2)}%${reset}`
      lines.push(
        expanded
          ? renderFullTableRow(
              [
                quote.code,
                marketLabel(quote, quote.code),
                quote.name,
                quote.price.toFixed(2),
                change,
                renderMiniSparkline(quote.trend),
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
            ),
      )
    }
    return lines
  }
}
