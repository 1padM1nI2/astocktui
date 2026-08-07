import { type BacktestHttp, fetchDailyKlines } from "./data"
import type { BacktestStrategy } from "./strategy"

export interface ScreenHit {
  readonly code: string
  readonly signal: "buy" | "sell"
  readonly close: number
  readonly date: string
}

export interface ScreenFailure {
  readonly code: string
  readonly error: string
}

export interface ScreenResult {
  readonly hits: readonly ScreenHit[]
  readonly quiet: readonly string[]
  readonly failures: readonly ScreenFailure[]
}

/**
 * 策略选股：对每只股票取足够历史日K，用策略在最后一个交易日收盘判定信号。
 * 空仓视角出买入信号、持仓视角出卖出信号；数据不足与请求失败计入 failures。
 */
export async function screenStocks(
  http: BacktestHttp,
  timeoutMs: number,
  codes: readonly string[],
  strategy: BacktestStrategy,
): Promise<ScreenResult> {
  const hits: ScreenHit[] = []
  const quiet: string[] = []
  const failures: ScreenFailure[] = []
  const count = strategy.warmup + 2
  await Promise.all(
    codes.map(async (code) => {
      try {
        const bars = await fetchDailyKlines(http, timeoutMs, code, count)
        if (bars.length < count) {
          failures.push({ code, error: `历史数据不足（${bars.length}/${count} 根日K）` })
          return
        }
        const last = bars.length - 1
        const signal =
          strategy.decide(bars, last, false) === "buy"
            ? ("buy" as const)
            : strategy.decide(bars, last, true) === "sell"
              ? ("sell" as const)
              : null
        const bar = bars[last]
        if (signal === null || bar === undefined) quiet.push(code)
        else hits.push({ code, signal, close: bar.close, date: bar.date })
      } catch (error) {
        failures.push({ code, error: error instanceof Error ? error.message : "筛选失败" })
      }
    }),
  )
  const order = (hit: ScreenHit): number => (hit.signal === "buy" ? 0 : 1)
  hits.sort((left, right) => order(left) - order(right) || left.code.localeCompare(right.code))
  quiet.sort()
  failures.sort((left, right) => left.code.localeCompare(right.code))
  return { hits, quiet, failures }
}
