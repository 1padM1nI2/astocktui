import type { KlineBar } from "../market/data"
import type { ConditionDefinition } from "./condition-types"
import { computeRsi, computeSma } from "./strategy"

function closesOf(bars: readonly KlineBar[], index: number): readonly number[] {
  return bars.slice(0, index + 1).map((bar) => bar.close)
}

function rangeExtreme(
  bars: readonly KlineBar[],
  index: number,
  period: number,
  pick: (bar: KlineBar) => number,
  extreme: (left: number, right: number) => number,
  seed: number,
): number {
  let result = seed
  for (let i = Math.max(0, index - period); i < index; i++) {
    const bar = bars[i]
    if (bar !== undefined) result = extreme(result, pick(bar))
  }
  return result
}

function maCross(
  bars: readonly KlineBar[],
  index: number,
  fast: number,
  slow: number,
): "golden" | "dead" | null {
  const closes = closesOf(bars, index)
  const fastNow = computeSma(closes, fast, index)
  const slowNow = computeSma(closes, slow, index)
  const fastPrev = computeSma(closes, fast, index - 1)
  const slowPrev = computeSma(closes, slow, index - 1)
  if (fastPrev <= slowPrev && fastNow > slowNow) return "golden"
  if (fastPrev >= slowPrev && fastNow < slowNow) return "dead"
  return null
}

function rsiCondition(
  name: string,
  summary: string,
  thresholdKey: string,
  thresholdDefault: number,
  test: (rsi: number, threshold: number) => boolean,
): ConditionDefinition {
  return {
    name,
    summary,
    params: [
      { key: "period", description: "RSI 周期", defaultValue: 14, integer: true },
      { key: thresholdKey, description: "判定阈值", defaultValue: thresholdDefault },
    ],
    create(params) {
      const period = params["period"] ?? 14
      const threshold = params[thresholdKey] ?? thresholdDefault
      if (period < 2) return null
      return {
        name,
        summary: `${summary} RSI${period} 阈值${threshold}`,
        warmup: period + 1,
        evaluate(bars, index) {
          const rsi = computeRsi(closesOf(bars, index), period, index)
          return Number.isFinite(rsi) && test(rsi, threshold)
        },
      }
    },
  }
}

function maCompare(name: string, summary: string, above: boolean): ConditionDefinition {
  return {
    name,
    summary,
    params: [{ key: "period", description: "均线周期", defaultValue: 20, integer: true }],
    create(params) {
      const period = params["period"] ?? 20
      return {
        name,
        summary: `${summary}${period}日均线`,
        warmup: period,
        evaluate(bars, index) {
          const ma = computeSma(closesOf(bars, index), period, index)
          const close = bars[index]?.close ?? Number.NaN
          return Number.isFinite(ma) && (above ? close > ma : close < ma)
        },
      }
    },
  }
}

function crossCondition(
  name: string,
  summary: string,
  kind: "golden" | "dead",
): ConditionDefinition {
  return {
    name,
    summary,
    params: [
      { key: "fast", description: "快线周期", defaultValue: 5, integer: true },
      { key: "slow", description: "慢线周期", defaultValue: 20, integer: true },
    ],
    create(params) {
      const fast = params["fast"] ?? 5
      const slow = params["slow"] ?? 20
      if (fast >= slow) return null
      return {
        name,
        summary: `${summary} 快线${fast}日 慢线${slow}日`,
        warmup: slow + 1,
        evaluate: (bars, index) => maCross(bars, index, fast, slow) === kind,
      }
    },
  }
}

export const CONDITION_DEFINITIONS: readonly ConditionDefinition[] = [
  rsiCondition("rsi_oversold", "RSI 超卖", "threshold", 30, (rsi, threshold) => rsi <= threshold),
  rsiCondition("rsi_overbought", "RSI 超买", "threshold", 70, (rsi, threshold) => rsi >= threshold),
  maCompare("above_ma", "收盘价站上", true),
  maCompare("below_ma", "收盘价跌破", false),
  crossCondition("ma_golden", "均线金叉", "golden"),
  crossCondition("ma_dead", "均线死叉", "dead"),
  {
    name: "breakout_high",
    summary: "突破前 N 日最高价",
    params: [{ key: "period", description: "通道天数", defaultValue: 20, integer: true }],
    create(params) {
      const period = params["period"] ?? 20
      return {
        name: "breakout_high",
        summary: `突破前${period}日最高价`,
        warmup: period + 1,
        evaluate(bars, index) {
          const highest = rangeExtreme(
            bars,
            index,
            period,
            (bar) => bar.high,
            Math.max,
            Number.NEGATIVE_INFINITY,
          )
          return (bars[index]?.close ?? 0) > highest
        },
      }
    },
  },
  {
    name: "breakout_low",
    summary: "跌破前 N 日最低价",
    params: [{ key: "period", description: "通道天数", defaultValue: 10, integer: true }],
    create(params) {
      const period = params["period"] ?? 10
      return {
        name: "breakout_low",
        summary: `跌破前${period}日最低价`,
        warmup: period + 1,
        evaluate(bars, index) {
          const lowest = rangeExtreme(
            bars,
            index,
            period,
            (bar) => bar.low,
            Math.min,
            Number.POSITIVE_INFINITY,
          )
          return (bars[index]?.close ?? Number.POSITIVE_INFINITY) < lowest
        },
      }
    },
  },
  {
    name: "volume_surge",
    summary: "成交量超过前 N 日均量倍率",
    params: [
      { key: "period", description: "均量天数", defaultValue: 5, integer: true },
      { key: "ratio", description: "放量倍率", defaultValue: 2 },
    ],
    create(params) {
      const period = params["period"] ?? 5
      const ratio = params["ratio"] ?? 2
      return {
        name: "volume_surge",
        summary: `放量 前${period}日均量×${ratio}`,
        warmup: period + 1,
        evaluate(bars, index) {
          const today = bars[index]?.volume
          if (today === undefined) return false
          let sum = 0
          for (let i = index - period; i < index; i++) {
            const volume = bars[i]?.volume
            if (volume === undefined) return false
            sum += volume
          }
          return today > (sum / period) * ratio
        },
      }
    },
  },
  {
    name: "pct_up",
    summary: "当日涨幅不低于阈值",
    params: [{ key: "min", description: "最小涨幅%", defaultValue: 5 }],
    create(params) {
      const min = params["min"] ?? 5
      return {
        name: "pct_up",
        summary: `当日涨幅≥${min}%`,
        warmup: 2,
        evaluate(bars, index) {
          const previous = bars[index - 1]?.close
          const close = bars[index]?.close
          if (previous === undefined || close === undefined || previous <= 0) return false
          return (close / previous - 1) * 100 >= min
        },
      }
    },
  },
  {
    name: "pct_down",
    summary: "当日跌幅不超过阈值",
    params: [{ key: "max", description: "最大跌幅%", defaultValue: -5 }],
    create(params) {
      const max = params["max"] ?? -5
      if (max >= 0) return null
      return {
        name: "pct_down",
        summary: `当日跌幅≤${max}%`,
        warmup: 2,
        evaluate(bars, index) {
          const previous = bars[index - 1]?.close
          const close = bars[index]?.close
          if (previous === undefined || close === undefined || previous <= 0) return false
          return (close / previous - 1) * 100 <= max
        },
      }
    },
  },
]
