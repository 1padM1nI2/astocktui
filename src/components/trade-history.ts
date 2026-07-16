import type { Component } from "@oh-my-pi/pi-tui"
import { visibleWidth } from "@oh-my-pi/pi-tui"
import { ANSI } from "../colors"
import type { PaperTradingService } from "../trading"
import type { SimulatedTrade } from "../trading-types"
import { fitLine } from "../width"

const MONEY_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function formatMoney(value: number, signed = false): string {
  const amount = `¥${MONEY_FORMATTER.format(Math.abs(value))}`
  if (!signed || value === 0) return amount
  return value > 0 ? `+${amount}` : `-${amount}`
}

function profitColor(value: number): string {
  if (value > 0) return ANSI.red
  if (value < 0) return ANSI.green
  return ANSI.brightWhite
}

function alignSides(left: string, right: string, width: number): string {
  const gap = width - visibleWidth(left) - visibleWidth(right)
  if (gap < 1) return fitLine(left, width)
  return `${left}${" ".repeat(gap)}${right}`
}

function tradeSummary(trade: SimulatedTrade, width: number): string {
  const side = trade.side === "buy" ? "买入" : "卖出"
  const left = `${trade.id} ${side} ${trade.code} ${trade.quantity}股`
  const right =
    trade.side === "sell"
      ? `${profitColor(trade.realizedProfit)}${formatMoney(trade.realizedProfit, true)}${ANSI.reset}`
      : `@ ${formatMoney(trade.price)}`
  return fitLine(alignSides(left, right, width), width)
}

function tradeDetails(trade: SimulatedTrade, width: number): string {
  const date = trade.tradeDate.slice(5)
  const details = `${date} · ${trade.name} · 成交 ${formatMoney(trade.price)} · 费用 ${formatMoney(trade.totalFees)}`
  return fitLine(`${ANSI.brightBlack}${details}${ANSI.reset}`, width)
}

export class TradeHistoryWorkspace implements Component {
  readonly #trading: Pick<PaperTradingService, "trades">

  constructor(trading: Pick<PaperTradingService, "trades">) {
    this.#trading = trading
  }

  render(width: number): readonly string[] {
    const safeWidth = Math.max(0, width | 0)
    const trades = this.#trading.trades
    const lines: string[] = [
      fitLine(
        `交易记录 / 最近成交 ${ANSI.brightBlack}[${trades.length}笔]${ANSI.reset}`,
        safeWidth,
      ),
      "─".repeat(safeWidth),
    ]

    if (trades.length === 0) {
      lines.push(fitLine(`${ANSI.brightBlack}暂无成交${ANSI.reset}`, safeWidth))
      lines.push(
        fitLine(`${ANSI.brightBlack}使用 /buy 或 /sell 进行模拟交易${ANSI.reset}`, safeWidth),
      )
      return lines
    }

    for (let index = trades.length - 1; index >= 0; index--) {
      const trade = trades[index]
      if (trade === undefined) continue
      lines.push(tradeSummary(trade, safeWidth), tradeDetails(trade, safeWidth))
    }
    return lines
  }
}
