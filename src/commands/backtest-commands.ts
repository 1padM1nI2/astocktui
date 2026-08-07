import { ANSI } from "../app/colors"
import { renderBatchReport, runBatchBacktest } from "../backtest/backtest-batch"
import { type BacktestHttp, fetchDailyKlines } from "../backtest/backtest-data"
import { type BacktestResult, runBacktest } from "../backtest/backtest-engine"
import { type BacktestMetrics, computeMetrics } from "../backtest/backtest-metrics"
import {
  type BacktestStrategy,
  createStrategy,
  listStrategies,
} from "../backtest/backtest-strategy"
import { isAshareCode, normalizeMarketCode } from "../market/market-code"
import type { KlineBar } from "../market/market-data"
import type { AppCommand, CommandResult } from "./commands"

const USAGE = "/backtest <代码[,代码…]|watch> [策略] [参数=值 …]"
const DEFAULT_STRATEGY = "ma-cross"
const DEFAULT_DAYS = 250
const DEFAULT_CASH = 100_000
const MAX_DAYS = 1000
const MAX_CODES = 20
const HTTP_TIMEOUT_MS = 10_000
const SPARKLINE_COLS = 40
const RECENT_TRADES = 5
const SPARK_CHARS = "▁▂▃▄▅▆▇█"

const defaultHttp: BacktestHttp = { fetch: (input) => fetch(input) }

export interface BacktestArgs {
  readonly codes: readonly string[] | "watch"
  readonly strategyName: string
  readonly params: Readonly<Record<string, number>>
  readonly days: number
  readonly cash: number
}

/** 解析策略名与数值参数；不属于策略参数的 key=value 放入 rest 由调用方校验 */
export function parseStrategyTokens(
  tokens: readonly string[],
):
  | { strategyName: string; params: Record<string, number>; rest: Record<string, string> }
  | { error: string } {
  let strategyName = DEFAULT_STRATEGY
  const params: Record<string, number> = {}
  const rest: Record<string, string> = {}
  for (const token of tokens) {
    const eq = token.indexOf("=")
    if (eq < 0) {
      if (strategyName !== DEFAULT_STRATEGY) return { error: `多余参数：${token}` }
      strategyName = token
      continue
    }
    const key = token.slice(0, eq)
    const raw = token.slice(eq + 1)
    const declared = listStrategies()
      .find((info) => info.name === strategyName)
      ?.params.some((param) => param.key === key)
    if (declared === true) {
      const value = Number(raw)
      if (!Number.isFinite(value)) return { error: `参数 ${key} 不是数值` }
      params[key] = value
    } else {
      rest[key] = raw
    }
  }
  return { strategyName, params, rest }
}

export function parseBacktestArgs(args: readonly string[]): BacktestArgs | { error: string } {
  const codeArg = args[0]
  if (codeArg === undefined) return { error: "缺少股票代码" }
  let codes: readonly string[] | "watch"
  if (codeArg.toLowerCase() === "watch") {
    codes = "watch"
  } else {
    const normalized: string[] = []
    for (const token of codeArg.split(",")) {
      const code = normalizeMarketCode(token)
      if (code === null || !isAshareCode(code)) return { error: `仅支持 A 股代码：${token}` }
      if (!normalized.includes(code)) normalized.push(code)
    }
    if (normalized.length > MAX_CODES) return { error: `一次最多回测 ${MAX_CODES} 只标的` }
    codes = normalized
  }
  const parsed = parseStrategyTokens(args.slice(1))
  if ("error" in parsed) return parsed
  let days = DEFAULT_DAYS
  let cash = DEFAULT_CASH
  for (const [key, raw] of Object.entries(parsed.rest)) {
    const value = Number(raw)
    if (key === "days") {
      if (!Number.isInteger(value) || value < 30 || value > MAX_DAYS) {
        return { error: `days 必须是 30~${MAX_DAYS} 的整数` }
      }
      days = value
    } else if (key === "cash") {
      if (!Number.isFinite(value) || value <= 0) return { error: "cash 必须为正数" }
      cash = value
    } else {
      return { error: `未知参数：${key}` }
    }
  }
  return { codes, strategyName: parsed.strategyName, params: parsed.params, days, cash }
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
      async execute(context, args) {
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
        const codes = parsed.codes === "watch" ? [...context.watchlist()] : parsed.codes
        if (codes.length === 0) return failure("自选股为空，先用 /watch add <代码> 添加", false)
        if (codes.length > 1) {
          const rows = await runBatchBacktest(http, HTTP_TIMEOUT_MS, codes, strategy, {
            initialCapital: parsed.cash,
            days: parsed.days,
          })
          return {
            kind: "output",
            title: `批量回测 · ${strategy.name}`,
            lines: renderBatchReport(strategy, parsed.days, rows),
          }
        }
        const code = codes[0] ?? ""
        let bars: readonly KlineBar[]
        try {
          bars = await fetchDailyKlines(http, HTTP_TIMEOUT_MS, code, parsed.days)
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
          title: `回测 ${code} · ${strategy.name}`,
          lines: renderBacktestReport(strategy, bars, result, computeMetrics(result)),
        }
      },
    },
  ]
}

export const BACKTEST_COMMANDS: readonly AppCommand[] = createBacktestCommands()
