import type { BacktestStrategy } from "./backtest-strategy"
import type { KlineBar } from "./market-data"
import { roundMoney } from "./trading-utils"

export interface BacktestTrade {
  readonly side: "buy" | "sell"
  readonly date: string
  readonly price: number
  readonly quantity: number
  readonly grossAmount: number
  readonly fees: number
  readonly realizedProfit: number
}

export interface EquityPoint {
  readonly date: string
  readonly close: number
  readonly equity: number
}

export interface BacktestResult {
  readonly initialCapital: number
  readonly finalEquity: number
  readonly benchmarkFinalEquity: number
  readonly holdingQuantity: number
  readonly trades: readonly BacktestTrade[]
  readonly equityCurve: readonly EquityPoint[]
}

export interface BacktestOptions {
  readonly initialCapital?: number
  readonly lotSize?: number
  readonly commissionRate?: number
  readonly minimumCommission?: number
  readonly stampDutyRate?: number
  readonly transferFeeRate?: number
}

interface CostModel {
  readonly lotSize: number
  readonly commissionRate: number
  readonly minimumCommission: number
  readonly stampDutyRate: number
  readonly transferFeeRate: number
}

/** 费用口径与 PaperTradingService 一致：佣金万三最低五元、卖出印花税万五、过户费十万分之一 */
function feesFor(costs: CostModel, side: "buy" | "sell", grossAmount: number): number {
  const commission = roundMoney(
    Math.max(costs.minimumCommission, grossAmount * costs.commissionRate),
  )
  const stampDuty = side === "sell" ? roundMoney(grossAmount * costs.stampDutyRate) : 0
  const transferFee = roundMoney(grossAmount * costs.transferFeeRate)
  return roundMoney(commission + stampDuty + transferFee)
}

/** 含费用可负担的最大整手数量 */
function affordableQuantity(costs: CostModel, cash: number, price: number): number {
  let quantity = Math.floor(cash / price / costs.lotSize) * costs.lotSize
  while (quantity > 0) {
    const gross = roundMoney(quantity * price)
    if (gross + feesFor(costs, "buy", gross) <= cash) return quantity
    quantity -= costs.lotSize
  }
  return 0
}

function benchmarkEquity(
  costs: CostModel,
  bars: readonly KlineBar[],
  initialCapital: number,
): number {
  const first = bars[0]
  const last = bars[bars.length - 1]
  if (first === undefined || last === undefined || first.open <= 0) return initialCapital
  const quantity = affordableQuantity(costs, initialCapital, first.open)
  if (quantity === 0) return initialCapital
  const gross = roundMoney(quantity * first.open)
  return roundMoney(initialCapital - gross - feesFor(costs, "buy", gross) + quantity * last.close)
}

/**
 * 日级回测：策略在第 i 日收盘出信号，第 i+1 日开盘成交，权益按每日收盘价计。
 * 买入满仓整手、卖出清仓；信号最早出现在买入成交日收盘，成交最早在次日开盘，
 * 因此同一交易日不会先买后卖，天然满足 T+1。
 */
export function runBacktest(
  bars: readonly KlineBar[],
  strategy: BacktestStrategy,
  options: BacktestOptions = {},
): BacktestResult {
  const initialCapital = options.initialCapital ?? 100_000
  const costs: CostModel = {
    lotSize: options.lotSize ?? 100,
    commissionRate: options.commissionRate ?? 0.0003,
    minimumCommission: options.minimumCommission ?? 5,
    stampDutyRate: options.stampDutyRate ?? 0.0005,
    transferFeeRate: options.transferFeeRate ?? 0.00001,
  }
  const trades: BacktestTrade[] = []
  const equityCurve: EquityPoint[] = []
  let cash = initialCapital
  let quantity = 0
  let costBasis = 0
  let acquiredIndex = -1
  let pending: "buy" | "sell" | null = null

  for (let index = 0; index < bars.length; index++) {
    const bar = bars[index]
    if (bar === undefined) continue
    // 昨日收盘信号在今日开盘成交
    if (pending === "buy" && quantity === 0 && bar.open > 0) {
      const shares = affordableQuantity(costs, cash, bar.open)
      if (shares > 0) {
        const gross = roundMoney(shares * bar.open)
        const fees = feesFor(costs, "buy", gross)
        cash = roundMoney(cash - gross - fees)
        quantity = shares
        costBasis = roundMoney(gross + fees)
        acquiredIndex = index
        trades.push({
          side: "buy",
          date: bar.date,
          price: bar.open,
          quantity: shares,
          grossAmount: gross,
          fees,
          realizedProfit: 0,
        })
      }
    } else if (pending === "sell" && quantity > 0 && index > acquiredIndex && bar.open > 0) {
      const gross = roundMoney(quantity * bar.open)
      const fees = feesFor(costs, "sell", gross)
      cash = roundMoney(cash + gross - fees)
      trades.push({
        side: "sell",
        date: bar.date,
        price: bar.open,
        quantity,
        grossAmount: gross,
        fees,
        realizedProfit: roundMoney(gross - fees - costBasis),
      })
      quantity = 0
      costBasis = 0
      acquiredIndex = -1
    }
    pending = null
    equityCurve.push({
      date: bar.date,
      close: bar.close,
      equity: roundMoney(cash + quantity * bar.close),
    })
    // 收盘后计算信号，下一交易日开盘执行
    pending = index < strategy.warmup ? null : strategy.decide(bars, index, quantity > 0)
  }

  const last = bars[bars.length - 1]
  return {
    initialCapital,
    finalEquity: roundMoney(cash + quantity * (last?.close ?? 0)),
    benchmarkFinalEquity: benchmarkEquity(costs, bars, initialCapital),
    holdingQuantity: quantity,
    trades,
    equityCurve,
  }
}
