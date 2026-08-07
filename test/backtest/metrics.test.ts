import { describe, expect, test } from "bun:test"
import type { BacktestResult, BacktestTrade, EquityPoint } from "../../src/backtest/engine"
import { computeMetrics } from "../../src/backtest/metrics"

function resultOf(
  equities: readonly number[],
  trades: readonly BacktestTrade[] = [],
  benchmark = 100_000,
): BacktestResult {
  const curve: EquityPoint[] = equities.map((equity, index) => ({
    date: `2024-01-${String(index + 1).padStart(2, "0")}`,
    close: 10,
    equity,
  }))
  const initial = equities[0] ?? 100_000
  return {
    initialCapital: initial,
    finalEquity: equities[equities.length - 1] ?? initial,
    benchmarkFinalEquity: benchmark,
    holdingQuantity: 0,
    trades,
    equityCurve: curve,
  }
}

function sell(realizedProfit: number): BacktestTrade {
  return {
    side: "sell",
    date: "2024-01-02",
    price: 10,
    quantity: 100,
    grossAmount: 1000,
    fees: 5,
    realizedProfit,
  }
}

describe("computeMetrics", () => {
  test("总收益率与基准收益率", () => {
    const metrics = computeMetrics(resultOf([100_000, 110_000], [], 105_000))
    expect(metrics.totalReturn).toBeCloseTo(0.1, 6)
    expect(metrics.benchmarkReturn).toBeCloseTo(0.05, 6)
  })

  test("年化收益按 252 个交易日折算", () => {
    // 126 个交易日累计 1.21 倍 → 年化 1.21^2-1 = 0.4641
    const equities = [...Array.from({ length: 125 }, () => 100_000), 121_000]
    expect(computeMetrics(resultOf(equities)).annualizedReturn).toBeCloseTo(0.4641, 3)
    const flat = resultOf(Array.from({ length: 126 }, () => 100_000))
    expect(computeMetrics(flat).annualizedReturn).toBeCloseTo(0, 6)
  })

  test("最大回撤取权益曲线峰谷最大跌幅", () => {
    const metrics = computeMetrics(resultOf([100_000, 120_000, 90_000, 110_000]))
    expect(metrics.maxDrawdown).toBeCloseTo(0.25, 6)
  })

  test("胜率按卖出回合统计盈利次数", () => {
    const metrics = computeMetrics(resultOf([100_000, 101_000], [sell(100), sell(-50), sell(0)]))
    expect(metrics.tradeCount).toBe(3)
    expect(metrics.roundTrips).toBe(3)
    expect(metrics.winRate).toBeCloseTo(1 / 3, 6)
  })

  test("无卖出时胜率为 null", () => {
    expect(computeMetrics(resultOf([100_000, 100_000])).winRate).toBeNull()
  })

  test("权益恒定时夏普比率为 null", () => {
    expect(computeMetrics(resultOf([100_000, 100_000, 100_000])).sharpeRatio).toBeNull()
  })

  test("权益稳步上升时夏普比率为正", () => {
    const equities = Array.from({ length: 30 }, (_, i) => 100_000 + i * 100)
    const sharpe = computeMetrics(resultOf(equities)).sharpeRatio
    expect(sharpe).not.toBeNull()
    expect(sharpe ?? 0).toBeGreaterThan(0)
  })

  test("单日数据年化为 null", () => {
    expect(computeMetrics(resultOf([100_000])).annualizedReturn).toBeNull()
  })
})
