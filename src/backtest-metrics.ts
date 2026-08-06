import type { BacktestResult } from "./backtest-engine"

export interface BacktestMetrics {
  /** 期末权益 / 初始资金 - 1 */
  readonly totalReturn: number
  /** 买入持有基准的同期收益率 */
  readonly benchmarkReturn: number
  /** 按 252 个交易日折算；不足两个交易日时为 null */
  readonly annualizedReturn: number | null
  /** 权益曲线峰谷最大跌幅，正数表示回撤幅度 */
  readonly maxDrawdown: number
  readonly tradeCount: number
  /** 完整买卖回合数（按卖出次数计） */
  readonly roundTrips: number
  /** 盈利回合占比；无卖出时为 null */
  readonly winRate: number | null
  /** 日收益均值/波动×√252；波动为零时为 null */
  readonly sharpeRatio: number | null
}

const TRADING_DAYS_PER_YEAR = 252

export function computeMetrics(result: BacktestResult): BacktestMetrics {
  const { equityCurve, trades, initialCapital, finalEquity, benchmarkFinalEquity } = result
  const totalReturn = finalEquity / initialCapital - 1
  const days = equityCurve.length
  const annualizedReturn =
    days >= 2 && finalEquity > 0
      ? (finalEquity / initialCapital) ** (TRADING_DAYS_PER_YEAR / days) - 1
      : null

  let peak = Number.NEGATIVE_INFINITY
  let maxDrawdown = 0
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity)
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - point.equity) / peak)
  }

  const sells = trades.filter((trade) => trade.side === "sell")
  const wins = sells.filter((trade) => trade.realizedProfit > 0).length

  let sharpeRatio: number | null = null
  if (days >= 2) {
    const returns: number[] = []
    for (let i = 1; i < days; i++) {
      const previous = equityCurve[i - 1]?.equity ?? 0
      if (previous > 0) returns.push((equityCurve[i]?.equity ?? 0) / previous - 1)
    }
    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length
    const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length
    const deviation = Math.sqrt(variance)
    if (deviation > 0) sharpeRatio = (mean / deviation) * Math.sqrt(TRADING_DAYS_PER_YEAR)
  }

  return {
    totalReturn,
    benchmarkReturn: benchmarkFinalEquity / initialCapital - 1,
    annualizedReturn,
    maxDrawdown,
    tradeCount: trades.length,
    roundTrips: sells.length,
    winRate: sells.length > 0 ? wins / sells.length : null,
    sharpeRatio,
  }
}
