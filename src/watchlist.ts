import { normalizeMarketCode } from "./market-code"
import { DEFAULT_WATCHLIST_CODES } from "./market-data"

export interface WatchlistState {
  readonly version: 1
  readonly codes: readonly string[]
}

export interface WatchlistChange {
  readonly ok: boolean
  readonly message: string
  readonly code?: string
}

export interface WatchlistOptions {
  readonly codes?: readonly string[]
  readonly state?: WatchlistState
  readonly onStateChange?: (state: WatchlistState) => void
}

export class WatchlistService {
  readonly #codes: string[]
  readonly #onStateChange: ((state: WatchlistState) => void) | undefined

  constructor(options: WatchlistOptions = {}) {
    const initialCodes = options.state?.codes ?? options.codes ?? DEFAULT_WATCHLIST_CODES
    this.#codes = normalizeInitialCodes(initialCodes)
    this.#onStateChange = options.onStateChange
  }

  get codes(): readonly string[] {
    return [...this.#codes]
  }

  get state(): WatchlistState {
    return { version: 1, codes: [...this.#codes] }
  }

  add(rawCode: string): WatchlistChange {
    const code = normalizeMarketCode(rawCode)
    if (code === null) return invalidCode()
    if (this.#codes.includes(code)) return { ok: false, code, message: `已在自选股中：${code}` }

    const before = [...this.#codes]
    this.#codes.push(code)
    this.#commitOrRestore(before)
    return { ok: true, code, message: `已添加 ${code}` }
  }

  remove(rawCode: string): WatchlistChange {
    const code = normalizeMarketCode(rawCode)
    if (code === null) return invalidCode()
    const index = this.#codes.indexOf(code)
    if (index < 0) return { ok: false, code, message: `不在自选股中：${code}` }
    if (this.#codes.length === 1) {
      return { ok: false, code, message: "自选股至少保留一只股票" }
    }

    const before = [...this.#codes]
    this.#codes.splice(index, 1)
    this.#commitOrRestore(before)
    return { ok: true, code, message: `已删除 ${code}` }
  }

  #commitOrRestore(before: readonly string[]): void {
    try {
      this.#onStateChange?.(this.state)
    } catch (error) {
      this.#codes.length = 0
      this.#codes.push(...before)
      throw error
    }
  }
}

function invalidCode(): WatchlistChange {
  return { ok: false, message: "股票代码格式无效，示例：600519、US:AAPL、JP:7203 或 KR:005930" }
}

function normalizeInitialCodes(codes: readonly string[]): string[] {
  if (codes.length === 0) throw new Error("自选股至少保留一只股票")
  const normalized: string[] = []
  for (const rawCode of codes) {
    const code = normalizeMarketCode(rawCode)
    if (code === null) throw new Error(`自选股代码无效：${rawCode}`)
    if (normalized.includes(code)) throw new Error(`自选股代码重复：${code}`)
    normalized.push(code)
  }
  return normalized
}
