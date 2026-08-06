import { describe, expect, test } from "bun:test"
import { runBacktest } from "../src/backtest-engine"
import type { BacktestStrategy } from "../src/backtest-strategy"
import type { KlineBar } from "../src/market-data"

function bars(rows: readonly [open: number, close: number][]): KlineBar[] {
  return rows.map(([open, close], index) => ({
    date: `2024-01-${String(index + 1).padStart(2, "0")}`,
    open,
    close,
    high: Math.max(open, close),
    low: Math.min(open, close),
  }))
}

/** 按脚本逐日返回信号的策略 */
function scripted(signals: readonly ("buy" | "sell" | null)[]): BacktestStrategy {
  return {
    name: "scripted",
    summary: "脚本策略",
    warmup: 0,
    decide: (_bars, index) => signals[index] ?? null,
  }
}

describe("runBacktest 撮合", () => {
  test("收盘出信号，次日开盘价成交", () => {
    // 第1天收盘买入信号 → 第2天开盘价 10 成交；第3天收盘卖出信号 → 第4天开盘价 12 成交
    const data = bars([
      [10, 10],
      [10, 11],
      [11, 11],
      [12, 12],
    ])
    const result = runBacktest(data, scripted(["buy", null, "sell", null]), {
      initialCapital: 10_000,
    })
    expect(result.trades).toHaveLength(2)
    expect(result.trades[0]).toMatchObject({ side: "buy", date: "2024-01-02", price: 10 })
    expect(result.trades[1]).toMatchObject({ side: "sell", date: "2024-01-04", price: 12 })
  })

  test("买入数量为整手且含费用后不超过现金", () => {
    const data = bars([
      [10, 10],
      [10, 10],
    ])
    const result = runBacktest(data, scripted(["buy", null]), { initialCapital: 1050 })
    const trade = result.trades[0]
    expect(trade?.side).toBe("buy")
    expect(trade?.quantity).toBe(100)
    expect((trade?.grossAmount ?? 0) + (trade?.fees ?? 0)).toBeLessThanOrEqual(1050)
  })

  test("现金不足一手时不产生交易", () => {
    const data = bars([
      [10, 10],
      [10, 10],
    ])
    const result = runBacktest(data, scripted(["buy", null]), { initialCapital: 500 })
    expect(result.trades).toHaveLength(0)
    expect(result.finalEquity).toBe(500)
  })

  test("信号日买入后当日不会卖出（T+1）", () => {
    // 同一天先买后卖的脚本：买入在次日开盘成交，卖出信号与之同日收盘出现，
    // 最早只能在再下一日开盘成交，因此成交日必须不同
    const data = bars([
      [10, 10],
      [10, 10],
      [10, 10],
    ])
    const result = runBacktest(data, scripted(["buy", "sell", null]), { initialCapital: 10_000 })
    const dates = result.trades.map((trade) => trade.date)
    expect(dates).toEqual(["2024-01-02", "2024-01-03"])
  })

  test("空仓信号与无持仓卖出被忽略", () => {
    const data = bars([
      [10, 10],
      [10, 10],
      [10, 10],
    ])
    const result = runBacktest(data, scripted(["sell", "buy", "buy"]), { initialCapital: 10_000 })
    expect(result.trades.map((trade) => trade.side)).toEqual(["buy"])
  })
})

describe("runBacktest 费用与盈亏", () => {
  test("费用口径与模拟盘一致：佣金万三最低五元、卖出印花税万五、过户费十万分之一", () => {
    const data = bars([
      [10, 10],
      [10, 10],
      [10, 10],
      [11, 11],
    ])
    const result = runBacktest(data, scripted(["buy", null, "sell", null]), {
      initialCapital: 10_000,
    })
    const [buy, sell] = result.trades
    // 买入 900股@10：佣金 max(5, 9000*0.0003)=5，过户费 0.09
    expect(buy?.quantity).toBe(900)
    expect(buy?.fees).toBe(5.09)
    // 卖出 900股@11：佣金 max(5, 2.97)=5，印花税 4.95，过户费 0.10
    expect(sell?.fees).toBe(10.05)
    // 成本含买入费用：9000+5.09=9005.09；卖出净得 9900-10.05=9889.95
    expect(sell?.realizedProfit).toBe(884.86)
  })

  test("期末未平仓按最后收盘价计入权益", () => {
    const data = bars([
      [10, 10],
      [10, 12],
    ])
    const result = runBacktest(data, scripted(["buy", null]), { initialCapital: 10_000 })
    const trade = result.trades[0]
    const expected = 10_000 - (trade?.grossAmount ?? 0) - (trade?.fees ?? 0) + 900 * 12
    expect(result.finalEquity).toBeCloseTo(expected, 2)
    expect(result.holdingQuantity).toBe(900)
  })
})

describe("runBacktest 权益曲线与基准", () => {
  test("权益曲线逐日记录且末日等于期末权益", () => {
    const data = bars([
      [10, 10],
      [10, 11],
      [11, 12],
    ])
    const result = runBacktest(data, scripted(["buy", null, null]), { initialCapital: 10_000 })
    expect(result.equityCurve).toHaveLength(3)
    expect(result.equityCurve[0]?.equity).toBe(10_000)
    expect(result.equityCurve[2]?.equity).toBe(result.finalEquity)
    expect(result.equityCurve[1]?.date).toBe("2024-01-02")
  })

  test("买入持有基准首日开盘满仓", () => {
    const data = bars([
      [10, 10],
      [10, 20],
    ])
    const result = runBacktest(data, scripted([null, null]), { initialCapital: 10_000 })
    // 1000股费用后超出现金，降至 900股@10 费用 5.09，期末市值 18000
    expect(result.benchmarkFinalEquity).toBeCloseTo(10_000 - 5.09 - 9_000 + 18_000, 2)
  })

  test("K线不足两根时返回空结果", () => {
    const result = runBacktest(bars([[10, 10]]), scripted(["buy"]), { initialCapital: 10_000 })
    expect(result.trades).toHaveLength(0)
    expect(result.finalEquity).toBe(10_000)
  })
})
