import { describe, expect, test } from "bun:test"
import { createStrategy, listStrategies } from "../src/backtest-strategy"
import type { KlineBar } from "../src/market-data"

function bars(closes: readonly number[]): KlineBar[] {
  return closes.map((close, index) => ({
    date: `2024-01-${String(index + 1).padStart(2, "0")}`,
    open: close,
    close,
    high: close,
    low: close,
  }))
}

describe("listStrategies", () => {
  test("内置双均线、RSI 与突破策略", () => {
    const names = listStrategies().map((strategy) => strategy.name)
    expect(names).toEqual(["ma-cross", "rsi", "breakout"])
  })

  test("每个策略都声明参数与默认值", () => {
    for (const info of listStrategies()) {
      expect(info.summary.length).toBeGreaterThan(0)
      for (const param of info.params) {
        expect(Number.isFinite(param.defaultValue)).toBe(true)
      }
    }
  })
})

describe("createStrategy", () => {
  test("未知策略返回 null", () => {
    expect(createStrategy("nope", {})).toBeNull()
  })

  test("参数覆盖默认值并影响预热期", () => {
    const strategy = createStrategy("ma-cross", { fast: 2, slow: 6 })
    expect(strategy?.warmup).toBe(6)
  })

  test("非法参数返回 null", () => {
    expect(createStrategy("ma-cross", { fast: 0 })).toBeNull()
    expect(createStrategy("ma-cross", { fast: 10, slow: 5 })).toBeNull()
    expect(createStrategy("rsi", { period: 1 })).toBeNull()
  })
})

describe("ma-cross 双均线策略", () => {
  const strategy = createStrategy("ma-cross", { fast: 2, slow: 4 })
  if (strategy === null) throw new Error("策略创建失败")

  test("快线上穿慢线当日发出买入信号", () => {
    // 慢线持续走低后快线因大涨上穿：cross 发生在最后一个 index
    const data = bars([10, 9, 8, 7, 12])
    expect(strategy.decide(data, 3, false)).toBeNull()
    expect(strategy.decide(data, 4, false)).toBe("buy")
  })

  test("快线下穿慢线且持仓时发出卖出信号", () => {
    const data = bars([7, 8, 9, 10, 6])
    expect(strategy.decide(data, 4, true)).toBe("sell")
  })

  test("空仓时不出卖出信号，持仓时不出买入信号", () => {
    const cross = bars([10, 9, 8, 7, 12])
    expect(strategy.decide(cross, 4, true)).toBeNull()
    const down = bars([7, 8, 9, 10, 6])
    expect(strategy.decide(down, 4, false)).toBeNull()
  })

  test("预热期之前不发出信号", () => {
    const data = bars([5, 6, 7])
    expect(strategy.decide(data, 2, false)).toBeNull()
  })
})

describe("rsi 策略", () => {
  const strategy = createStrategy("rsi", { period: 3, oversold: 30, overbought: 70 })
  if (strategy === null) throw new Error("策略创建失败")

  test("持续下跌使 RSI 跌破超卖线后买入", () => {
    const data = bars([10, 9, 8, 7, 6])
    expect(strategy.decide(data, 4, false)).toBe("buy")
  })

  test("持续上涨使 RSI 超过超买线后卖出", () => {
    const data = bars([6, 7, 8, 9, 10])
    expect(strategy.decide(data, 4, true)).toBe("sell")
  })

  test("横盘时不发信号", () => {
    const data = bars([10, 10.1, 9.9, 10, 10.05])
    expect(strategy.decide(data, 4, false)).toBeNull()
    expect(strategy.decide(data, 4, true)).toBeNull()
  })
})

describe("breakout 突破策略", () => {
  const strategy = createStrategy("breakout", { entry: 3, exit: 2 })
  if (strategy === null) throw new Error("策略创建失败")

  test("收盘价突破前 N 日最高价买入", () => {
    const data: KlineBar[] = [
      { date: "d1", open: 10, close: 10, high: 11, low: 9 },
      { date: "d2", open: 10, close: 10, high: 11, low: 9 },
      { date: "d3", open: 10, close: 10, high: 11, low: 9 },
      { date: "d4", open: 11.5, close: 11.5, high: 11.6, low: 10.5 },
    ]
    expect(strategy.decide(data, 2, false)).toBeNull()
    expect(strategy.decide(data, 3, false)).toBe("buy")
  })

  test("收盘价跌破前 M 日最低价卖出", () => {
    const data: KlineBar[] = [
      { date: "d1", open: 10, close: 10, high: 11, low: 9 },
      { date: "d2", open: 10, close: 10, high: 11, low: 9 },
      { date: "d3", open: 8.5, close: 8.5, high: 9.5, low: 8.4 },
    ]
    expect(strategy.decide(data, 2, true)).toBe("sell")
  })
})
