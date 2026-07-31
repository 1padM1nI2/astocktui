import type { Component } from "@oh-my-pi/pi-tui"
import { ANSI } from "../colors"
import type { HotRankEntry, HotRankSnapshot } from "../eastmoney-hot-rank"
import { alignCell, fitLine } from "../width"
import { ListScrollState } from "../workspace-scroll"
import { displayCode } from "./market-table"
import { trendColor } from "./market-trend"

const TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Shanghai",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

const RANK_WIDTH = 4
const CODE_WIDTH = 6
const NAME_WIDTH = 10
const PRICE_WIDTH = 10
const CHANGE_WIDTH = 9
const SHIFT_WIDTH = 8
const TABLE_GAP = "  "

function changeLabel(changePercent: number | null): string {
  if (changePercent === null) return "--"
  const color = trendColor(changePercent)
  const reset = color.length > 0 ? ANSI.reset : ""
  const sign = changePercent > 0 ? "+" : ""
  return `${color}${sign}${changePercent.toFixed(2)}%${reset}`
}

/** 排名变动：上升红色 ↑N，下降绿色 ↓N，不变灰 -- */
function shiftLabel(rankChange: number): string {
  if (rankChange > 0) return `${ANSI.red}↑${rankChange}${ANSI.reset}`
  if (rankChange < 0) return `${ANSI.green}↓${Math.abs(rankChange)}${ANSI.reset}`
  return `${ANSI.brightBlack}--${ANSI.reset}`
}

function renderRow(cells: readonly string[], width: number): string {
  const columns = [RANK_WIDTH, CODE_WIDTH, NAME_WIDTH, PRICE_WIDTH, CHANGE_WIDTH, SHIFT_WIDTH]
  return fitLine(
    cells
      .map((cell, index) =>
        alignCell(cell, columns[index] ?? NAME_WIDTH, index >= 3 || index === 0 ? "right" : "left"),
      )
      .join(TABLE_GAP),
    width,
  )
}

/** 股吧人气榜：行情面板的切换视图，仅滚动，无选中/详情 */
export class HotRankWorkspace implements Component {
  #snapshot: HotRankSnapshot | null = null
  #status: "idle" | "loading" | "ready" | "error" = "idle"
  readonly #scroll = new ListScrollState()

  get scroll(): ListScrollState {
    return this.#scroll
  }

  get status(): "idle" | "loading" | "ready" | "error" {
    return this.#status
  }

  get snapshot(): HotRankSnapshot | null {
    return this.#snapshot
  }

  beginRefresh(): void {
    this.#status = "loading"
  }

  applySnapshot(snapshot: HotRankSnapshot): void {
    this.#snapshot = snapshot
    this.#status = "ready"
  }

  failRefresh(): void {
    this.#status = "error"
  }

  handleInput(data: string): boolean {
    return this.#scroll.handleInput(data)
  }

  render(width: number): readonly string[] {
    const safeWidth = Math.max(0, width | 0)
    let status = `${ANSI.brightBlack}[未加载 · R刷新]${ANSI.reset}`
    if (this.#status === "loading") status = `${ANSI.yellow}[更新中]${ANSI.reset}`
    else if (this.#status === "ready") {
      const updatedAt = this.#snapshot?.updatedAt
      const updated = updatedAt === undefined ? "" : ` · 更新 ${TIME_FORMATTER.format(updatedAt)}`
      status = `${ANSI.brightBlack}[${this.#snapshot?.source ?? "东财股吧人气"}${updated} · R刷新 · H返回]${ANSI.reset}`
    } else if (this.#status === "error") {
      status = `${ANSI.brightRed}[获取失败 · R重试]${ANSI.reset}`
    }

    const lines: string[] = [
      fitLine(`舆情 / 股吧人气榜 ${status}`, safeWidth),
      "─".repeat(safeWidth),
    ]

    const items = this.#snapshot?.items ?? []
    if (items.length === 0) {
      let message = "等待人气榜数据…"
      if (this.#status === "loading") message = "正在获取人气榜…"
      else if (this.#status === "error") message = "人气榜获取失败，按 R 重试"
      lines.push(fitLine(`${ANSI.brightBlack}${message}${ANSI.reset}`, safeWidth))
      return lines
    }

    lines.push(renderRow(["排名", "代码", "名称", "现价", "涨跌幅", "排名变动"], safeWidth))
    for (const item of items) lines.push(this.#renderItem(item, safeWidth))
    return lines
  }

  #renderItem(item: HotRankEntry, width: number): string {
    return renderRow(
      [
        String(item.rank),
        displayCode(item.code),
        item.name,
        item.price === null ? "--" : item.price.toFixed(2),
        changeLabel(item.changePercent),
        shiftLabel(item.rankChange),
      ],
      width,
    )
  }
}
