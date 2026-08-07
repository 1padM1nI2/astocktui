import type { AgentTool, AgentToolResult } from "@oh-my-pi/pi-agent-core"
import { z } from "@oh-my-pi/pi-ai"
import { runBatchBacktest } from "../backtest/backtest-batch"
import { type BacktestHttp, fetchDailyKlines } from "../backtest/backtest-data"
import { runBacktest } from "../backtest/backtest-engine"
import { computeMetrics } from "../backtest/backtest-metrics"
import { createStrategy, listStrategies } from "../backtest/backtest-strategy"
import { screenStocks } from "../backtest/stock-screen"
import type { HotRankSnapshot } from "../market/eastmoney-hot-rank"
import { isAshareCode, normalizeMarketCode } from "../market/market-code"

/** 回测工具依赖的最小上下文，CommandContext 结构兼容 */
export interface BacktestToolContext {
  watchlist(): readonly string[]
  hotRank?(refresh?: boolean): Promise<HotRankSnapshot | null>
}

const HTTP_TIMEOUT_MS = 10_000
const MAX_CODES = 20
const HOT_LIMIT = 50
const RECENT_TRADES = 10

const defaultHttp: BacktestHttp = { fetch: (input) => fetch(input) }

const strategySchema = z.enum(["ma-cross", "rsi", "breakout"])
const paramsSchema = z.record(z.string(), z.number()).optional()
const daysSchema = z.number().int().min(30).max(1000).optional()
const cashSchema = z.number().positive().optional()

interface StrategyInput {
  readonly strategy?: "ma-cross" | "rsi" | "breakout"
  readonly params?: Record<string, number>
  readonly days?: number
  readonly cash?: number
}

function jsonResult(value: unknown): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    details: value,
  }
}

function resolveStrategy(input: StrategyInput) {
  const strategy = createStrategy(input.strategy ?? "ma-cross", input.params ?? {})
  if (strategy === null) {
    const available = listStrategies()
      .map(
        (info) =>
          `${info.name}（${info.params.map((param) => `${param.key}=${param.defaultValue}`).join(" ")}）`,
      )
      .join("、")
    throw new Error(`策略不可用：${input.strategy ?? ""}，可选 ${available}`)
  }
  return strategy
}

function normalizeCodes(codes: readonly string[]): string[] {
  const normalized: string[] = []
  for (const raw of codes) {
    const code = normalizeMarketCode(raw)
    if (code === null || !isAshareCode(code)) throw new Error(`仅支持 A 股代码：${raw}`)
    if (!normalized.includes(code)) normalized.push(code)
  }
  if (normalized.length === 0) throw new Error("缺少股票代码")
  if (normalized.length > MAX_CODES) throw new Error(`一次最多回测 ${MAX_CODES} 只标的`)
  return normalized
}

/** 历史回测与策略选股工具：与 /backtest、/screen 命令共用同一引擎 */
export function createBacktestAgentTools(
  context: BacktestToolContext,
  http: BacktestHttp = defaultHttp,
): readonly AgentTool[] {
  return [
    {
      name: "run_backtest",
      label: "回测交易策略",
      description:
        "用东财前复权日 K 回测单只 A 股的交易策略（ma-cross 双均线 / rsi 超买超卖 / breakout 通道突破），返回总收益、年化、最大回撤、胜率、夏普与买入持有基准对比。策略在收盘出信号、次日开盘成交，费用与 T+1 口径同模拟盘。",
      parameters: z.object({
        code: z.string().min(1),
        strategy: strategySchema.optional(),
        params: paramsSchema,
        days: daysSchema,
        cash: cashSchema,
      }),
      intent: "omit",
      approval: "read",
      execute: async (_id, params) => {
        const input = params as StrategyInput & { readonly code: string }
        const [code] = normalizeCodes([input.code])
        const strategy = resolveStrategy(input)
        const days = input.days ?? 250
        const bars = await fetchDailyKlines(http, HTTP_TIMEOUT_MS, code ?? "", days)
        const required = strategy.warmup + 2
        if (bars.length < required) {
          throw new Error(`历史数据不足：需要至少 ${required} 根日K，实际 ${bars.length} 根`)
        }
        const result = runBacktest(bars, strategy, { initialCapital: input.cash ?? 100_000 })
        return jsonResult({
          code,
          strategy: strategy.name,
          strategySummary: strategy.summary,
          period: { start: bars[0]?.date, end: bars[bars.length - 1]?.date, days: bars.length },
          initialCapital: result.initialCapital,
          finalEquity: result.finalEquity,
          holdingQuantity: result.holdingQuantity,
          metrics: computeMetrics(result),
          recentTrades: result.trades.slice(-RECENT_TRADES),
        })
      },
    },
    {
      name: "batch_backtest",
      label: "批量回测",
      description:
        "对多只 A 股（默认整个自选股列表）用同一策略批量回测，按总收益率降序返回各标的的指标对比，用于横向验证策略可行性。",
      parameters: z.object({
        codes: z.array(z.string().min(1)).max(MAX_CODES).optional(),
        strategy: strategySchema.optional(),
        params: paramsSchema,
        days: daysSchema,
        cash: cashSchema,
      }),
      intent: "omit",
      approval: "read",
      execute: async (_id, params) => {
        const input = params as StrategyInput & { readonly codes?: readonly string[] }
        const strategy = resolveStrategy(input)
        const codes =
          input.codes !== undefined ? normalizeCodes(input.codes) : [...context.watchlist()]
        if (codes.length === 0) throw new Error("自选股为空，且未提供 codes")
        const days = input.days ?? 250
        const rows = await runBatchBacktest(http, HTTP_TIMEOUT_MS, codes, strategy, {
          initialCapital: input.cash ?? 100_000,
          days,
        })
        return jsonResult({
          strategy: strategy.name,
          strategySummary: strategy.summary,
          days,
          rows: rows.map((row) => ({
            code: row.code,
            totalReturn: row.metrics?.totalReturn ?? null,
            annualizedReturn: row.metrics?.annualizedReturn ?? null,
            maxDrawdown: row.metrics?.maxDrawdown ?? null,
            winRate: row.metrics?.winRate ?? null,
            tradeCount: row.metrics?.tradeCount ?? null,
            benchmarkReturn: row.metrics?.benchmarkReturn ?? null,
            excessReturn:
              row.metrics === null ? null : row.metrics.totalReturn - row.metrics.benchmarkReturn,
            finalEquity: row.finalEquity,
            error: row.error,
          })),
        })
      },
    },
    {
      name: "screen_stocks",
      label: "策略选股",
      description:
        "按策略信号选股：扫描自选股（source=watchlist）或股吧人气榜（source=hot），返回最新交易日产生买入或卖出信号的股票。买入信号在前，quiet 为无信号，failures 为数据获取失败。",
      parameters: z.object({
        strategy: strategySchema.optional(),
        params: paramsSchema,
        source: z.enum(["watchlist", "hot"]).optional(),
      }),
      intent: "omit",
      approval: "read",
      execute: async (_id, params) => {
        const input = params as StrategyInput & { readonly source?: "watchlist" | "hot" }
        const strategy = resolveStrategy(input)
        const source = input.source ?? "watchlist"
        let codes: readonly string[]
        if (source === "hot") {
          const snapshot = await context.hotRank?.()
          if (snapshot === undefined || snapshot === null) throw new Error("热榜数据不可用")
          codes = snapshot.items.slice(0, HOT_LIMIT).map((item) => item.code)
        } else {
          codes = context.watchlist()
        }
        if (codes.length === 0) throw new Error("自选股为空，无可扫描标的")
        const result = await screenStocks(http, HTTP_TIMEOUT_MS, codes, strategy)
        return jsonResult({
          strategy: strategy.name,
          strategySummary: strategy.summary,
          source,
          scanned: codes.length,
          hits: result.hits,
          quiet: result.quiet,
          failures: result.failures,
        })
      },
    },
  ]
}
