import { type BacktestHttp, fetchDailyKlines } from "./backtest-data"
import { type BacktestResult, runBacktest } from "./backtest-engine"
import { type BacktestMetrics, computeMetrics } from "./backtest-metrics"
import { type BacktestStrategy, createStrategy, listStrategies } from "./backtest-strategy"
import { ANSI } from "./colors"
import type { AppCommand, CommandResult } from "./commands"
import { isAshareCode, normalizeMarketCode } from "./market-code"
import type { KlineBar } from "./market-data"

const USAGE = "/backtest <代码> [策略] [参数=值 …]"
const DEFAULT_STRATEGY = "ma-cross"
const DEFAULT_DAYS = 250
const DEFAULT_CASH = 100_000
const MAX_DAYS = 1000
const HTTP_TIMEOUT_MS = 10_000
const SPARKLINE_COLS = 40
const RECENT_TRADES = 5
const SPARK_CHARS = "▁▂▃▄▅▆▇█"

const defaultHttp: BacktestHttp = { fetch: (input) => fetch(input) }

export interface BacktestArgs {
  readonly code: string
  readonly strategyName: string
  readonly params: Readonly<Record<string, number>>
  readonly days: number
  readonly cash: number
}

export function parseBacktestArgs(args: readonly string[]): BacktestArgs | { error: string } {
  const codeArg = args[0]
  if (codeArg === undefined) return { error: "缺少股票代码" }
  const code = normalizeMarketCode(codeArg)
  if (code === null || !isAshareCode(code)) return { error: `仅支持 A 股代码：${codeArg}` }
  let strategyName = DEFAULT_STRATEGY
  const params: Record<string, number> = {}
  let days = DEFAULT_DAYS
  let cash = DEFAULT_CASH
  for (const token of args.slice(1)) {
    const eq = token.indexOf("=")
    if (eq < 0) {
      if (strategyName !== DEFAULT_STRATEGY) return { error: `多余参数：${token}` }
      strategyName = token
      continue
    }
    const key = token.slice(0, eq)
    const value = Number(token.slice(eq + 1))
    if (!Number.isFinite(value)) return { error: `参数 ${key} 不是数值` }
    if (key === "days") {
      if (!Number.isInteger(value) || value < 30 || value > MAX_DAYS) {
        return { error: `days 必须是 30~${MAX_DAYS} 的整数` }
      }
      days = value
    } else if (key === "cash") {
      if (value <= 0) return { error: "cash 必须为正数" }
      cash = value
    } else {
      params[key] = value
    }
  }
  const known = listStrategies().find((info) => info.name === strategyName)
  if (known !== undefined) {
    for (const key of Object.keys(params)) {
      if (!known.params.some((param) => param.key === key)) {
        return { error: `策略 ${strategyName} 不支持参数 ${key}` }
      }
    }
  }
  return { code, strategyName, params, days, cash }
}

function percent(value: number | null): string {
  if (value === null) return "--"
  const text = `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`
  const color = value > 0 ? ANSI.red : value < 0 ? ANSI.green : ANSI.brightWhite
  return `${color}${text}${ANSI.reset}`
}

/** A 股红涨绿跌的带符号金额；与 commands.ts 的 profitText 口径一致 */
function signedMoney(value: number): string {
  const amount = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(value))
  const sign = value > 0 ? `+¥${amount}` : value < 0 ? `-¥${amount}` : `¥${amount}`
  const color = value > 0 ? ANSI.red : value < 0 ? ANSI.green : ANSI.brightWhite
  return `${color}${sign}${ANSI.reset}`
}

function sparkline(equities: readonly number[], cols: number): string {
  if (equities.length === 0) return ""
  const bucketSize = Math.max(1, Math.ceil(equities.length / cols))
  const samples: number[] = []
  for (let start = 0; start < equities.length; start += bucketSize) {
    const bucket = equities.slice(start, start + bucketSize)
    samples.push(bucket.reduce((sum, value) => sum + value, 0) / bucket.length)
  }
  const min = Math.min(...samples)
  const max = Math.max(...samples)
  const range = max - min
  return samples
    .map((value) => {
      const level = range === 0 ? 0 : Math.round(((value - min) / range) * (SPARK_CHARS.length - 1))
      return SPARK_CHARS[level] ?? SPARK_CHARS[0]
    })
    .join("")
}

export function renderBacktestReport(
  strategy: BacktestStrategy,
  bars: readonly KlineBar[],
  result: BacktestResult,
  metrics: BacktestMetrics,
): string[] {
  const first = bars[0]
  const last = bars[bars.length - 1]
  const money = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const lines: string[] = [
    `区间 ${first?.date ?? "--"} ~ ${last?.date ?? "--"} · ${bars.length} 个交易日`,
    `策略 ${strategy.summary} · 初始资金 ¥${money.format(result.initialCapital)}`,
    `期末资产 ¥${money.format(result.finalEquity)} · 总收益 ${percent(metrics.totalReturn)}`,
    `年化 ${percent(metrics.annualizedReturn)} · 最大回撤 ${(metrics.maxDrawdown * 100).toFixed(2)}% · 夏普 ${metrics.sharpeRatio?.toFixed(2) ?? "--"}`,
    `交易 ${metrics.tradeCount} 次 · 完整回合 ${metrics.roundTrips} · 胜率 ${metrics.winRate === null ? "--" : `${(metrics.winRate * 100).toFixed(1)}%`}`,
    `买入持有 ${percent(metrics.benchmarkReturn)} · 超额 ${percent(metrics.totalReturn - metrics.benchmarkReturn)}`,
    `权益 ${sparkline(
      result.equityCurve.map((point) => point.equity),
      SPARKLINE_COLS,
    )}`,
  ]
  const recent = result.trades.slice(-RECENT_TRADES)
  if (recent.length > 0) {
    lines.push("最近成交：")
    for (const trade of recent) {
      const side =
        trade.side === "buy" ? `${ANSI.red}买入${ANSI.reset}` : `${ANSI.green}卖出${ANSI.reset}`
      const base = `${trade.date} ${side} ${trade.quantity}股 @${trade.price.toFixed(2)} 费用¥${trade.fees.toFixed(2)}`
      lines.push(trade.side === "sell" ? `${base} 盈亏 ${signedMoney(trade.realizedProfit)}` : base)
    }
  }
  if (result.holdingQuantity > 0)
    lines.push(`期末持仓 ${result.holdingQuantity}股（按最后收盘价计入权益）`)
  return lines
}

function failure(message: string, withUsage = true): CommandResult {
  const lines = withUsage ? [message, `用法 ${USAGE}`] : [message]
  return { kind: "output", title: "回测失败", lines }
}

export function createBacktestCommands(http: BacktestHttp = defaultHttp): readonly AppCommand[] {
  return [
    {
      name: "backtest",
      aliases: ["bt"],
      category: "data",
      usage: USAGE,
      description: "用历史日K回测交易策略（ma-cross / rsi / breakout）",
      async execute(_context, args) {
        const parsed = parseBacktestArgs(args)
        if ("error" in parsed) return failure(parsed.error)
        const strategy = createStrategy(parsed.strategyName, parsed.params)
        if (strategy === null) {
          const available = listStrategies()
            .map(
              (info) =>
                `${info.name}（${info.params.map((param) => `${param.key}=${param.defaultValue}`).join(" ")}）`,
            )
            .join("、")
          return failure(`策略不可用：${parsed.strategyName}，可选 ${available}`)
        }
        let bars: readonly KlineBar[]
        try {
          bars = await fetchDailyKlines(http, HTTP_TIMEOUT_MS, parsed.code, parsed.days)
        } catch (error) {
          return failure(error instanceof Error ? error.message : "历史K线获取失败", false)
        }
        const required = strategy.warmup + 2
        if (bars.length < required) {
          return failure(`历史数据不足：需要至少 ${required} 根日K，实际 ${bars.length} 根`, false)
        }
        const result = runBacktest(bars, strategy, { initialCapital: parsed.cash })
        return {
          kind: "output",
          title: `回测 ${parsed.code} · ${strategy.name}`,
          lines: renderBacktestReport(strategy, bars, result, computeMetrics(result)),
        }
      },
    },
  ]
}

export const BACKTEST_COMMANDS: readonly AppCommand[] = createBacktestCommands()
