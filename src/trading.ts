import { isAshareCode } from "./market-code"
import type { MarketQuote } from "./market-data"
import type { PortfolioPosition, PortfolioSnapshot } from "./portfolio"
import {
  applyBuy,
  applySell,
  restoreTradingPositions,
  serializeTradingState,
  type TradingPosition,
} from "./trading-state"
import type {
  OrderQuantity,
  PaperTradingOptions,
  PaperTradingState,
  SimulatedTrade,
  TradePreview,
  TradeQuote,
  TradeResult,
  TradeSide,
} from "./trading-types"
import { roundMoney, tradingDate } from "./trading-utils"

export type {
  OrderQuantity,
  PaperTradingOptions,
  SimulatedTrade,
  TradePreview,
  TradeQuote,
  TradeResult,
  TradeSide,
} from "./trading-types"

export class PaperTradingService {
  readonly #initialCapital: number
  readonly #now: () => Date
  readonly #commissionRate: number
  readonly #minimumCommission: number
  readonly #stampDutyRate: number
  readonly #transferFeeRate: number
  readonly #lotSize: number
  readonly #onStateChange: ((state: PaperTradingState) => void) | undefined
  readonly #positions = new Map<string, TradingPosition>()
  readonly #trades: SimulatedTrade[] = []
  #cash: number
  #sequence = 0

  constructor(options: PaperTradingOptions = {}) {
    this.#initialCapital = options.state?.initialCapital ?? options.initialCapital ?? 100_000
    this.#cash = options.state?.cash ?? this.#initialCapital
    this.#now = options.now ?? (() => new Date())
    this.#commissionRate = options.commissionRate ?? 0.0003
    this.#minimumCommission = options.minimumCommission ?? 5
    this.#stampDutyRate = options.stampDutyRate ?? 0.0005
    this.#transferFeeRate = options.transferFeeRate ?? 0.00001
    this.#lotSize = options.lotSize ?? 100
    this.#onStateChange = options.onStateChange
    if (options.state !== undefined) this.#restore(options.state)
  }

  get lotSize(): number {
    return this.#lotSize
  }

  get state(): PaperTradingState {
    return serializeTradingState(
      this.#initialCapital,
      this.#cash,
      this.#sequence,
      this.#positions,
      this.#trades,
    )
  }

  get snapshot(): PortfolioSnapshot {
    const today = tradingDate(this.#now())
    const positions: PortfolioPosition[] = []
    for (const position of this.#positions.values()) {
      positions.push({
        code: position.code,
        name: position.name,
        quantity: position.quantity,
        sellableQuantity: this.#sellableQuantity(position, today),
        averageCost: position.averageCost,
        currentPrice: position.currentPrice,
      })
    }
    positions.sort((left, right) => left.code.localeCompare(right.code))
    return {
      initialCapital: this.#initialCapital,
      cash: this.#cash,
      positions,
    }
  }

  get trades(): readonly SimulatedTrade[] {
    return this.#trades
  }

  preview(side: TradeSide, quote: TradeQuote, quantity: OrderQuantity): TradeResult {
    if (!isAshareCode(quote.code)) return { ok: false, message: "海外股票当前仅支持分析" }
    if (!Number.isFinite(quote.price) || quote.price <= 0) {
      return { ok: false, message: `价格无效：${quote.price}` }
    }
    const resolved = this.#resolveQuantity(side, quote.code, quantity)
    if (typeof resolved !== "number") return resolved
    const shares = resolved
    const grossAmount = roundMoney(quote.price * shares)
    const commission = roundMoney(
      Math.max(this.#minimumCommission, grossAmount * this.#commissionRate),
    )
    const stampDuty = side === "sell" ? roundMoney(grossAmount * this.#stampDutyRate) : 0
    const transferFee = roundMoney(grossAmount * this.#transferFeeRate)
    const totalFees = roundMoney(commission + stampDuty + transferFee)
    const cashChange =
      side === "buy" ? -roundMoney(grossAmount + totalFees) : roundMoney(grossAmount - totalFees)
    const position = this.#positions.get(quote.code)
    const realizedProfit =
      side === "sell" && position !== undefined
        ? roundMoney(cashChange - position.averageCost * shares)
        : 0
    const preview: TradePreview = {
      side,
      code: quote.code,
      name: quote.name,
      quantity: shares,
      price: quote.price,
      grossAmount,
      commission,
      stampDuty,
      transferFee,
      totalFees,
      cashChange,
      cashAfter: roundMoney(this.#cash + cashChange),
      realizedProfit,
    }
    if (side === "buy" && preview.cashAfter < 0) {
      return {
        ok: false,
        message: `资金不足：需要 ¥${roundMoney(-cashChange).toFixed(2)}，可用 ¥${this.#cash.toFixed(2)}`,
        preview,
      }
    }
    return { ok: true, message: "交易预览已生成", preview }
  }

  execute(side: TradeSide, quote: TradeQuote, quantity: OrderQuantity): TradeResult {
    const result = this.preview(side, quote, quantity)
    const preview = result.preview
    if (!result.ok || preview === undefined) return result
    const before = this.state
    const tradeDate = tradingDate(this.#now())
    if (side === "buy") applyBuy(this.#positions, preview, tradeDate)
    else applySell(this.#positions, preview, tradeDate)
    this.#cash = preview.cashAfter
    const trade: SimulatedTrade = {
      ...preview,
      id: `SIM-${String(++this.#sequence).padStart(4, "0")}`,
      executedAt: this.#now().toISOString(),
      tradeDate,
    }
    this.#trades.push(trade)
    this.#commitOrRestore(before)
    return { ok: true, message: side === "buy" ? "模拟买入成交" : "模拟卖出成交", preview, trade }
  }

  updatePrices(quotes: readonly (TradeQuote | MarketQuote)[]): void {
    const before = this.state
    let changed = false
    for (const quote of quotes) {
      const position = this.#positions.get(quote.code)
      if (
        position !== undefined &&
        Number.isFinite(quote.price) &&
        quote.price > 0 &&
        position.currentPrice !== quote.price
      ) {
        position.currentPrice = quote.price
        changed = true
      }
    }
    if (changed) this.#commitOrRestore(before)
  }

  reset(): void {
    const before = this.state
    this.#cash = this.#initialCapital
    this.#positions.clear()
    this.#trades.length = 0
    this.#sequence = 0
    this.#commitOrRestore(before)
  }

  #resolveQuantity(side: TradeSide, code: string, requested: OrderQuantity): number | TradeResult {
    if (side === "buy" && requested === "all") {
      return { ok: false, message: "买入数量必须是正整数" }
    }
    const position = this.#positions.get(code)
    const sellable =
      position === undefined ? 0 : this.#sellableQuantity(position, tradingDate(this.#now()))
    const quantity = requested === "all" ? sellable : requested
    if (!Number.isInteger(quantity) || quantity <= 0) {
      if (side === "sell" && position !== undefined && sellable === 0) {
        return { ok: false, message: "当前持仓受 T+1 限制，今日不可卖" }
      }
      return { ok: false, message: "交易数量必须是正整数" }
    }
    if (quantity % this.#lotSize !== 0) {
      return { ok: false, message: `买卖数量必须是 ${this.#lotSize}股整数倍` }
    }
    if (side === "sell") {
      if (position === undefined) return { ok: false, message: `无持仓：${code}` }
      if (quantity > sellable) {
        return { ok: false, message: `可卖数量不足：需要 ${quantity}股，可卖 ${sellable}股（T+1）` }
      }
    }
    return quantity
  }

  #commitOrRestore(before: PaperTradingState): void {
    try {
      this.#onStateChange?.(this.state)
    } catch (error) {
      this.#restore(before)
      throw error
    }
  }

  #restore(state: PaperTradingState): void {
    this.#cash = state.cash
    this.#sequence = state.sequence
    this.#positions.clear()
    for (const [code, position] of restoreTradingPositions(state)) {
      this.#positions.set(code, position)
    }
    this.#trades.length = 0
    for (const trade of state.trades) this.#trades.push({ ...trade })
  }

  #sellableQuantity(position: TradingPosition, today: string): number {
    let quantity = 0
    for (const lot of position.lots) {
      if (lot.acquiredOn < today) quantity += lot.quantity
    }
    return quantity
  }
}
