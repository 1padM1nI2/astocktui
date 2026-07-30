import { stocks } from "stock-api"
import { withTimeout } from "./http-timeout"
import type {
  StockApiClient,
  StockApiKline,
  StockApiKlineOptions,
  StockApiQuote,
} from "./stock-api-types"

export const PROVIDER_TIMEOUT_MS = 8_000
export const PROVIDER_COOLDOWN_MS = 5 * 60_000
export const PROVIDER_MAX_FAILURES = 2

export interface StockApiProvider {
  readonly name: string
  readonly api: StockApiClient
}

export interface ProviderHealth {
  readonly consecutiveFailures: number
  readonly cooldownUntil: number
}

/** 冷却中的源排到最后，其余保持原顺序（纯函数，便于测试） */
export function orderProviders<T extends { readonly name: string }>(
  providers: readonly T[],
  health: ReadonlyMap<string, ProviderHealth>,
  now: number,
): readonly T[] {
  return providers
    .map((provider, index) => ({
      provider,
      index,
      coolingDown: (health.get(provider.name)?.cooldownUntil ?? 0) > now,
    }))
    .sort(
      (left, right) =>
        Number(left.coolingDown) - Number(right.coolingDown) || left.index - right.index,
    )
    .map((entry) => entry.provider)
}

const DEFAULT_PROVIDERS: readonly StockApiProvider[] = [
  { name: "tencent", api: stocks.tencent },
  { name: "sina", api: stocks.sina },
  { name: "eastmoney", api: stocks.eastmoney },
]

/**
 * 多行情源编排：按健康度排序逐家尝试，部分结果由下一家按 code 补全。
 * 连续失败达到上限进入冷却并降权，一次成功即复位。
 */
export class ResilientStockApiClient implements StockApiClient {
  readonly #providers: readonly StockApiProvider[]
  readonly #now: () => number
  readonly #timeoutMs: number
  readonly #cooldownMs: number
  readonly #maxFailures: number
  readonly #health = new Map<string, { consecutiveFailures: number; cooldownUntil: number }>()

  constructor(
    providers: readonly StockApiProvider[] = DEFAULT_PROVIDERS,
    now: () => number = Date.now,
    timeoutMs: number = PROVIDER_TIMEOUT_MS,
    cooldownMs: number = PROVIDER_COOLDOWN_MS,
    maxFailures: number = PROVIDER_MAX_FAILURES,
  ) {
    this.#providers = providers
    this.#now = now
    this.#timeoutMs = timeoutMs
    this.#cooldownMs = cooldownMs
    this.#maxFailures = maxFailures
  }

  async getStocks(codes: string[]): Promise<readonly StockApiQuote[]> {
    const missing = new Set(codes)
    const collected = new Map<string, StockApiQuote>()
    for (const provider of orderProviders(this.#providers, this.#health, this.#now())) {
      if (missing.size === 0) break
      try {
        const quotes = await withTimeout(
          provider.api.getStocks([...missing]),
          this.#timeoutMs,
          `${provider.name} 实时行情`,
        )
        this.#record(provider.name, quotes.length > 0)
        for (const quote of quotes) {
          if (missing.has(quote.code)) {
            collected.set(quote.code, quote)
            missing.delete(quote.code)
          }
        }
      } catch {
        this.#record(provider.name, false)
      }
    }
    return [...collected.values()]
  }

  async getKlines(code: string, options?: StockApiKlineOptions): Promise<readonly StockApiKline[]> {
    for (const provider of orderProviders(this.#providers, this.#health, this.#now())) {
      try {
        const klines = await withTimeout(
          provider.api.getKlines(code, options),
          this.#timeoutMs,
          `${provider.name} K 线`,
        )
        this.#record(provider.name, klines.length > 0)
        if (klines.length > 0) return klines
      } catch {
        this.#record(provider.name, false)
      }
    }
    return []
  }

  #record(name: string, succeeded: boolean): void {
    if (succeeded) {
      this.#health.set(name, { consecutiveFailures: 0, cooldownUntil: 0 })
      return
    }
    const consecutiveFailures = (this.#health.get(name)?.consecutiveFailures ?? 0) + 1
    const cooldownUntil =
      consecutiveFailures >= this.#maxFailures ? this.#now() + this.#cooldownMs : 0
    this.#health.set(name, { consecutiveFailures, cooldownUntil })
  }
}
