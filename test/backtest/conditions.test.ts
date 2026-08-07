import { describe, expect, test } from "bun:test"
import {
  createCondition,
  listConditions,
  parseConditionSpecs,
  type ScreenCondition,
} from "../../src/backtest/conditions"
import type { KlineBar } from "../../src/market/data"

function bars(rows: readonly (readonly [close: number, volume?: number])[]): KlineBar[] {
  return rows.map(([close, volume], index) => ({
    date: `2024-02-${String(index + 1).padStart(2, "0")}`,
    open: close,
    close,
    high: close,
    low: close,
    ...(volume !== undefined ? { volume } : {}),
  }))
}

function evaluate(condition: ScreenCondition, data: KlineBar[]): boolean {
  return condition.evaluate(data, data.length - 1)
}

describe("listConditions", () => {
  test("内置条件覆盖均线、RSI、突破、量能与涨跌幅", () => {
    const names = listConditions().map((condition) => condition.name)
    expect(names).toEqual([
      "rsi_oversold",
      "rsi_overbought",
      "above_ma",
      "below_ma",
      "ma_golden",
      "ma_dead",
      "breakout_high",
      "breakout_low",
      "volume_surge",
      "pct_up",
      "pct_down",
    ])
  })
})

describe("createCondition", () => {
  test("未知条件返回 null", () => {
    expect(createCondition("nope", {})).toBeNull()
  })

  test("非法参数返回 null", () => {
    expect(createCondition("above_ma", { period: 0 })).toBeNull()
    expect(createCondition("ma_golden", { fast: 20, slow: 5 })).toBeNull()
    expect(createCondition("volume_surge", { ratio: 0 })).toBeNull()
  })

  test("参数覆盖默认值", () => {
    expect(createCondition("above_ma", { period: 10 })?.warmup).toBe(10)
  })
})

describe("parseConditionSpecs", () => {
  test("解析名称与内联参数", () => {
    expect(parseConditionSpecs(["rsi_oversold(period=10,threshold=25)", "above_ma"])).toEqual([
      { name: "rsi_oversold", params: { period: 10, threshold: 25 } },
      { name: "above_ma", params: {} },
    ])
  })

  test("未知条件与非法参数报错", () => {
    expect(parseConditionSpecs(["nope"])).toHaveProperty("error")
    expect(parseConditionSpecs(["above_ma(period=0)"])).toHaveProperty("error")
    expect(parseConditionSpecs(["above_ma(foo=1)"])).toHaveProperty("error")
    expect(parseConditionSpecs([])).toHaveProperty("error")
  })
})

describe("条件判定", () => {
  test("rsi_oversold：RSI 不超阈值", () => {
    const condition = createCondition("rsi_oversold", { period: 3, threshold: 30 })
    if (condition === null) throw new Error("创建失败")
    expect(evaluate(condition, bars([[10], [9], [8], [7], [6]]))).toBe(true)
    expect(evaluate(condition, bars([[6], [7], [8], [9], [10]]))).toBe(false)
  })

  test("above_ma / below_ma：收盘与均线比较", () => {
    const above = createCondition("above_ma", { period: 3 })
    const below = createCondition("below_ma", { period: 3 })
    if (above === null || below === null) throw new Error("创建失败")
    expect(evaluate(above, bars([[10], [10], [13]]))).toBe(true)
    expect(evaluate(above, bars([[10], [10], [7]]))).toBe(false)
    expect(evaluate(below, bars([[10], [10], [7]]))).toBe(true)
  })

  test("ma_golden / ma_dead：当日交叉", () => {
    const golden = createCondition("ma_golden", { fast: 2, slow: 4 })
    const dead = createCondition("ma_dead", { fast: 2, slow: 4 })
    if (golden === null || dead === null) throw new Error("创建失败")
    expect(evaluate(golden, bars([[10], [9], [8], [7], [12]]))).toBe(true)
    expect(evaluate(golden, bars([[7], [8], [9], [10], [11]]))).toBe(false)
    expect(evaluate(dead, bars([[7], [8], [9], [10], [6]]))).toBe(true)
  })

  test("breakout_high / breakout_low：突破前 N 日极值", () => {
    const high = createCondition("breakout_high", { period: 3 })
    const low = createCondition("breakout_low", { period: 2 })
    if (high === null || low === null) throw new Error("创建失败")
    expect(evaluate(high, bars([[10], [11], [9], [12]]))).toBe(true)
    expect(evaluate(high, bars([[10], [11], [9], [10]]))).toBe(false)
    expect(evaluate(low, bars([[10], [11], [9], [8]]))).toBe(true)
  })

  test("volume_surge：成交量超过前 N 日均量倍率；缺量不成立", () => {
    const surge = createCondition("volume_surge", { period: 2, ratio: 2 })
    if (surge === null) throw new Error("创建失败")
    expect(
      evaluate(
        surge,
        bars([
          [10, 100],
          [10, 100],
          [10, 250],
        ]),
      ),
    ).toBe(true)
    expect(
      evaluate(
        surge,
        bars([
          [10, 100],
          [10, 100],
          [10, 150],
        ]),
      ),
    ).toBe(false)
    expect(evaluate(surge, bars([[10], [10], [10]]))).toBe(false)
  })

  test("pct_up / pct_down：当日涨跌幅阈值", () => {
    const up = createCondition("pct_up", { min: 5 })
    const down = createCondition("pct_down", { max: -5 })
    if (up === null || down === null) throw new Error("创建失败")
    expect(evaluate(up, bars([[10], [10.5]]))).toBe(true)
    expect(evaluate(up, bars([[10], [10.4]]))).toBe(false)
    expect(evaluate(down, bars([[10], [9.5]]))).toBe(true)
    expect(evaluate(down, bars([[10], [9.6]]))).toBe(false)
  })
})
