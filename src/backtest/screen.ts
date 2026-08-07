import type { KlineBar } from "../market/data"
import type { ScreenCondition } from "./conditions"
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

export interface ConditionHit {
  readonly code: string
  readonly close: number
  readonly date: string
}

export interface ConditionScreenResult {
  readonly hits: readonly ConditionHit[]
  readonly misses: readonly string[]
  readonly failures: readonly ScreenFailure[]
}

interface CollectedBars {
  readonly barsByCode: ReadonlyMap<string, readonly KlineBar[]>
  readonly failures: readonly ScreenFailure[]
}

/** 并发拉取各标的日 K；不足 required 根或请求失败计入 failures，单只失败不影响其他 */
async function collectBars(
  http: BacktestHttp,
  timeoutMs: number,
  codes: readonly string[],
  fetchCount: number,
  required: number,
): Promise<CollectedBars> {
  const barsByCode = new Map<string, readonly KlineBar[]>()
  const failures: ScreenFailure[] = []
  await Promise.all(
    codes.map(async (code) => {
      try {
        const bars = await fetchDailyKlines(http, timeoutMs, code, fetchCount)
        if (bars.length < required) {
          failures.push({ code, error: `历史数据不足（${bars.length}/${required} 根日K）` })
          return
        }
        barsByCode.set(code, bars)
      } catch (error) {
        failures.push({ code, error: error instanceof Error ? error.message : "筛选失败" })
      }
    }),
  )
  failures.sort((left, right) => left.code.localeCompare(right.code))
  return { barsByCode, failures }
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
  const { barsByCode, failures } = await collectBars(
    http,
    timeoutMs,
    codes,
    strategy.warmup + 2,
    strategy.warmup + 2,
  )
  const hits: ScreenHit[] = []
  const quiet: string[] = []
  for (const [code, bars] of barsByCode) {
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
  }
  const order = (hit: ScreenHit): number => (hit.signal === "buy" ? 0 : 1)
  hits.sort((left, right) => order(left) - order(right) || left.code.localeCompare(right.code))
  quiet.sort()
  return { hits, quiet, failures }
}

/**
 * 条件组合选股：AND 语义，全部条件在最后一个交易日收盘同时满足才入选。
 * 取数比最大 warmup 多一根作余量，判定只需满足最大 warmup。
 */
export async function screenByConditions(
  http: BacktestHttp,
  timeoutMs: number,
  codes: readonly string[],
  conditions: readonly ScreenCondition[],
): Promise<ConditionScreenResult> {
  const maxWarmup = Math.max(...conditions.map((condition) => condition.warmup))
  const { barsByCode, failures } = await collectBars(
    http,
    timeoutMs,
    codes,
    maxWarmup + 1,
    maxWarmup,
  )
  const hits: ConditionHit[] = []
  const misses: string[] = []
  for (const [code, bars] of barsByCode) {
    const last = bars.length - 1
    const bar = bars[last]
    if (bar === undefined) continue
    if (conditions.every((condition) => condition.evaluate(bars, last))) {
      hits.push({ code, close: bar.close, date: bar.date })
    } else {
      misses.push(code)
    }
  }
  hits.sort((left, right) => left.code.localeCompare(right.code))
  misses.sort()
  return { hits, misses, failures }
}
