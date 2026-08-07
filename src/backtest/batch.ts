import { ANSI } from "../app/colors"
import { alignCell } from "../app/width"
import { type BacktestHttp, fetchDailyKlines } from "./data"
import { type BacktestOptions, runBacktest } from "./engine"
import { type BacktestMetrics, computeMetrics } from "./metrics"
import type { BacktestStrategy } from "./strategy"

export type BatchBacktestHttp = BacktestHttp

export interface BatchBacktestRow {
  readonly code: string
  readonly metrics: BacktestMetrics | null
  readonly finalEquity: number | null
  readonly error: string | null
}

/** 多代码并发回测；单只失败降级为行内错误，按总收益率降序（失败排最后） */
export async function runBatchBacktest(
  http: BatchBacktestHttp,
  timeoutMs: number,
  codes: readonly string[],
  strategy: BacktestStrategy,
  options: BacktestOptions & { readonly days?: number },
): Promise<readonly BatchBacktestRow[]> {
  const days = options.days ?? 250
  const rows = await Promise.all(
    codes.map(async (code): Promise<BatchBacktestRow> => {
      try {
        const bars = await fetchDailyKlines(http, timeoutMs, code, days)
        const required = strategy.warmup + 2
        if (bars.length < required) {
          return {
            code,
            metrics: null,
            finalEquity: null,
            error: `历史数据不足（${bars.length}/${required} 根日K）`,
          }
        }
        const result = runBacktest(bars, strategy, options)
        return {
          code,
          metrics: computeMetrics(result),
          finalEquity: result.finalEquity,
          error: null,
        }
      } catch (error) {
        return {
          code,
          metrics: null,
          finalEquity: null,
          error: error instanceof Error ? error.message : "回测失败",
        }
      }
    }),
  )
  return rows.sort(
    (left, right) => (right.metrics?.totalReturn ?? -2) - (left.metrics?.totalReturn ?? -2),
  )
}

function percentCell(value: number | null): string {
  if (value === null) return "--"
  const text = `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`
  const color = value > 0 ? ANSI.red : value < 0 ? ANSI.green : ANSI.brightWhite
  return `${color}${text}${ANSI.reset}`
}

/** 批量对比表：代码、总收益、年化、回撤、胜率、交易、超额；失败行展示原因 */
export function renderBatchReport(
  strategy: BacktestStrategy,
  days: number,
  rows: readonly BatchBacktestRow[],
): string[] {
  const lines = [
    `策略 ${strategy.summary} · 近 ${days} 根日K · ${rows.length} 只标的（按总收益排序）`,
    `${alignCell("代码", 10, "left")}${alignCell("总收益", 10, "right")}${alignCell("年化", 10, "right")}${alignCell("最大回撤", 10, "right")}${alignCell("胜率", 8, "right")}${alignCell("交易", 6, "right")}  超额`,
  ]
  for (const row of rows) {
    const metrics = row.metrics
    if (metrics === null) {
      lines.push(`${alignCell(row.code, 10, "left")}${row.error ?? "回测失败"}`)
      continue
    }
    const cells = [
      alignCell(row.code, 10, "left"),
      alignCell(percentCell(metrics.totalReturn), 10, "right"),
      alignCell(percentCell(metrics.annualizedReturn), 10, "right"),
      alignCell(`${(metrics.maxDrawdown * 100).toFixed(2)}%`, 10, "right"),
      alignCell(
        metrics.winRate === null ? "--" : `${(metrics.winRate * 100).toFixed(0)}%`,
        8,
        "right",
      ),
      alignCell(String(metrics.tradeCount), 6, "right"),
    ]
    lines.push(`${cells.join("")}  ${percentCell(metrics.totalReturn - metrics.benchmarkReturn)}`)
  }
  return lines
}
