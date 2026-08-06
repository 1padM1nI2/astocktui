import type { KlineBar } from "./market-data"

export type BacktestSignal = "buy" | "sell" | null

export interface BacktestStrategy {
  readonly name: string
  readonly summary: string
  /** 需要的历史 K 线根数；index 小于该值时 decide 不会被引擎调用 */
  readonly warmup: number
  /** 基于 bars[index]（含）之前的收盘数据给出当日信号；holding 表示当前是否持仓 */
  decide(bars: readonly KlineBar[], index: number, holding: boolean): BacktestSignal
}

export interface StrategyParamInfo {
  readonly key: string
  readonly description: string
  readonly defaultValue: number
}

export interface StrategyInfo {
  readonly name: string
  readonly summary: string
  readonly params: readonly StrategyParamInfo[]
}

interface StrategyDefinition extends StrategyInfo {
  readonly create: (params: Readonly<Record<string, number>>) => BacktestStrategy | null
}

function validParams(
  definition: StrategyDefinition,
  params: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> | null {
  const resolved: Record<string, number> = {}
  for (const info of definition.params) {
    const value = params[info.key] ?? info.defaultValue
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) return null
    resolved[info.key] = value
  }
  return resolved
}

/** 简单移动平均；数据不足的窗口返回 NaN */
function sma(closes: readonly number[], period: number, index: number): number {
  if (index + 1 < period) return Number.NaN
  let sum = 0
  for (let i = index - period + 1; i <= index; i++) sum += closes[i] ?? 0
  return sum / period
}

/** Wilder RSI；index 小于 period 时返回 NaN */
export function computeRsi(closes: readonly number[], period: number, index: number): number {
  if (index < period) return Number.NaN
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i++) {
    const change = (closes[i] ?? 0) - (closes[i - 1] ?? 0)
    if (change > 0) gain += change
    else loss -= change
  }
  let avgGain = gain / period
  let avgLoss = loss / period
  for (let i = period + 1; i <= index; i++) {
    const change = (closes[i] ?? 0) - (closes[i - 1] ?? 0)
    avgGain = (avgGain * (period - 1) + Math.max(0, change)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -change)) / period
  }
  if (avgLoss === 0) return 100
  return 100 - 100 / (1 + avgGain / avgLoss)
}

const DEFINITIONS: readonly StrategyDefinition[] = [
  {
    name: "ma-cross",
    summary: "双均线：快线上穿慢线买入，下穿卖出",
    params: [
      { key: "fast", description: "快线周期", defaultValue: 5 },
      { key: "slow", description: "慢线周期", defaultValue: 20 },
    ],
    create(params) {
      const fast = params["fast"] ?? 5
      const slow = params["slow"] ?? 20
      if (fast >= slow) return null
      return {
        name: "ma-cross",
        summary: `双均线 快线${fast}日 慢线${slow}日`,
        warmup: slow,
        decide(bars, index, holding) {
          if (index < slow) return null
          const closes = bars.map((bar) => bar.close)
          const fastNow = sma(closes, fast, index)
          const slowNow = sma(closes, slow, index)
          const fastPrev = sma(closes, fast, index - 1)
          const slowPrev = sma(closes, slow, index - 1)
          if (!holding && fastPrev <= slowPrev && fastNow > slowNow) return "buy"
          if (holding && fastPrev >= slowPrev && fastNow < slowNow) return "sell"
          return null
        },
      }
    },
  },
  {
    name: "rsi",
    summary: "RSI 超买超卖：跌破超卖线买入，升破超买线卖出",
    params: [
      { key: "period", description: "RSI 周期", defaultValue: 14 },
      { key: "oversold", description: "超卖阈值", defaultValue: 30 },
      { key: "overbought", description: "超买阈值", defaultValue: 70 },
    ],
    create(params) {
      const period = params["period"] ?? 14
      const oversold = params["oversold"] ?? 30
      const overbought = params["overbought"] ?? 70
      if (period < 2 || oversold >= overbought) return null
      return {
        name: "rsi",
        summary: `RSI${period} 超卖${oversold} 超买${overbought}`,
        warmup: period + 1,
        decide(bars, index, holding) {
          if (index < period) return null
          const rsi = computeRsi(
            bars.map((bar) => bar.close),
            period,
            index,
          )
          if (!Number.isFinite(rsi)) return null
          if (!holding && rsi <= oversold) return "buy"
          if (holding && rsi >= overbought) return "sell"
          return null
        },
      }
    },
  },
  {
    name: "breakout",
    summary: "通道突破：收盘价突破前 N 日最高买入，跌破前 M 日最低卖出",
    params: [
      { key: "entry", description: "入场通道天数", defaultValue: 20 },
      { key: "exit", description: "离场通道天数", defaultValue: 10 },
    ],
    create(params) {
      const entry = params["entry"] ?? 20
      const exit = params["exit"] ?? 10
      return {
        name: "breakout",
        summary: `突破 入场${entry}日 离场${exit}日`,
        warmup: entry,
        decide(bars, index, holding) {
          if (!holding && index >= entry) {
            let highest = Number.NEGATIVE_INFINITY
            for (let i = index - entry; i < index; i++)
              highest = Math.max(highest, bars[i]?.high ?? 0)
            if ((bars[index]?.close ?? 0) > highest) return "buy"
          }
          if (holding && index >= exit) {
            let lowest = Number.POSITIVE_INFINITY
            for (let i = index - exit; i < index; i++) lowest = Math.min(lowest, bars[i]?.low ?? 0)
            if ((bars[index]?.close ?? 0) < lowest) return "sell"
          }
          return null
        },
      }
    },
  },
]

export function listStrategies(): readonly StrategyInfo[] {
  return DEFINITIONS.map(({ name, summary, params }) => ({ name, summary, params }))
}

export function createStrategy(
  name: string,
  params: Readonly<Record<string, number>>,
): BacktestStrategy | null {
  const definition = DEFINITIONS.find((item) => item.name === name)
  if (definition === undefined) return null
  const resolved = validParams(definition, params)
  if (resolved === null) return null
  return definition.create(resolved)
}
