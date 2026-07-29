import type { Component } from "@oh-my-pi/pi-tui"
import { visibleWidth } from "@oh-my-pi/pi-tui"
import { ANSI } from "../colors"
import type { PortfolioSnapshot } from "../portfolio"
import { calculatePortfolio, EMPTY_PORTFOLIO } from "../portfolio"
import { alignCell, fitLine } from "../width"
import { ListScrollState } from "../workspace-scroll"

const MONEY_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function profitColor(value: number): string {
  if (value > 0) return ANSI.red
  if (value < 0) return ANSI.green
  return ANSI.brightWhite
}

function formatMoney(value: number, signed = false): string {
  const amount = MONEY_FORMATTER.format(Math.abs(value))
  if (!signed || value === 0) return `¥${amount}`
  return value > 0 ? `+¥${amount}` : `-¥${amount}`
}

function formatPercent(value: number): string {
  const sign = value > 0 ? "+" : ""
  return `${sign}${value.toFixed(2)}%`
}

function metricRow(label: string, value: string, width: number): string {
  const labelWidth = Math.min(12, Math.max(0, width))
  const valueWidth = Math.max(0, width - labelWidth)
  return fitLine(
    `${alignCell(label, labelWidth, "left")}${alignCell(value, valueWidth, "right")}`,
    width,
  )
}

function alignSides(left: string, right: string, width: number): string {
  const gap = width - visibleWidth(left) - visibleWidth(right)
  if (gap < 1) return fitLine(left, width)
  return `${left}${" ".repeat(gap)}${right}`
}

export class PortfolioWorkspace implements Component {
  #snapshot: PortfolioSnapshot
  readonly #scroll = new ListScrollState()

  constructor(snapshot: PortfolioSnapshot = EMPTY_PORTFOLIO) {
    this.#snapshot = snapshot
  }

  get scroll(): ListScrollState {
    return this.#scroll
  }

  handleInput(data: string): boolean {
    return this.#scroll.handleInput(data)
  }

  get snapshot(): PortfolioSnapshot {
    return this.#snapshot
  }

  applySnapshot(snapshot: PortfolioSnapshot): void {
    this.#snapshot = snapshot
  }

  render(width: number): readonly string[] {
    const safeWidth = Math.max(0, width | 0)
    const summary = calculatePortfolio(this.#snapshot)
    const profitColorCode = profitColor(summary.totalProfit)
    const unrealizedColorCode = profitColor(summary.unrealizedProfit)
    const realizedColorCode = profitColor(summary.realizedProfit)
    const unrealizedPercent =
      summary.costBasis === 0 ? 0 : (summary.unrealizedProfit / summary.costBasis) * 100
    const lines: string[] = [
      fitLine(`持仓 / 模拟账户 ${ANSI.brightBlack}[模拟]${ANSI.reset}`, safeWidth),
      "─".repeat(safeWidth),
      metricRow("总资产", formatMoney(summary.totalAssets), safeWidth),
      metricRow("可用资金", formatMoney(this.#snapshot.cash), safeWidth),
      metricRow("持仓市值", formatMoney(summary.marketValue), safeWidth),
      metricRow(
        "浮动盈亏",
        `${unrealizedColorCode}${formatPercent(unrealizedPercent)} ${formatMoney(summary.unrealizedProfit, true)}${ANSI.reset}`,
        safeWidth,
      ),
      metricRow(
        "已实现盈亏",
        `${realizedColorCode}${formatMoney(summary.realizedProfit, true)}${ANSI.reset}`,
        safeWidth,
      ),
      metricRow(
        "累计收益",
        `${profitColorCode}${formatPercent(summary.totalReturnPercent)}${ANSI.reset}`,
        safeWidth,
      ),
      "─".repeat(safeWidth),
    ]

    if (this.#snapshot.positions.length === 0) {
      lines.push(fitLine(`${ANSI.brightBlack}暂无持仓${ANSI.reset}`, safeWidth))
      lines.push(fitLine(`${ANSI.brightBlack}等待 Agent 发出模拟交易指令${ANSI.reset}`, safeWidth))
      return lines
    }

    for (const position of this.#snapshot.positions) {
      const positionProfit = position.quantity * (position.currentPrice - position.averageCost)
      const positionPercent =
        position.averageCost === 0
          ? 0
          : ((position.currentPrice - position.averageCost) / position.averageCost) * 100
      const color = profitColor(positionProfit)
      const left = `${position.code} ${position.name} ${position.quantity}股 ${color}${formatPercent(positionPercent)}${ANSI.reset}`
      const right = `${color}${formatMoney(positionProfit, true)}${ANSI.reset}`
      lines.push(fitLine(alignSides(left, right, safeWidth), safeWidth))
      const details = `可卖${position.sellableQuantity}股 · 成本 ${formatMoney(position.averageCost)} · 现价 ${formatMoney(position.currentPrice)}`
      lines.push(fitLine(`${ANSI.brightBlack}${details}${ANSI.reset}`, safeWidth))
    }
    return lines
  }
}
