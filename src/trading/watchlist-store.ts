import { defaultAppDataPath, readJsonFile, writeJsonFileAtomically } from "../infra/json-file"
import { normalizeMarketCode } from "../market/code"
import { type WatchlistOptions, WatchlistService, type WatchlistState } from "./watchlist"

export interface PersistentWatchlistOptions
  extends Omit<WatchlistOptions, "state" | "onStateChange"> {
  readonly path?: string
}

export function defaultWatchlistPath(): string {
  return defaultAppDataPath("watchlist.json")
}

export class WatchlistStore {
  readonly path: string

  constructor(path: string = defaultWatchlistPath()) {
    this.path = path
  }

  load(): WatchlistState | null {
    try {
      const value = readJsonFile(this.path)
      if (value === null) return null
      if (!isWatchlistState(value)) throw new Error("状态结构无效")
      return value
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`自选股文件损坏：${this.path}（${reason}）`)
    }
  }

  save(state: WatchlistState): void {
    writeJsonFileAtomically(this.path, state)
  }
}

export function createPersistentWatchlistService(
  options: PersistentWatchlistOptions = {},
): WatchlistService {
  const { path = defaultWatchlistPath(), ...watchlistOptions } = options
  const store = new WatchlistStore(path)
  const state = store.load()
  const onStateChange = (next: WatchlistState): void => store.save(next)
  return state === null
    ? new WatchlistService({ ...watchlistOptions, onStateChange })
    : new WatchlistService({ ...watchlistOptions, state, onStateChange })
}

function isWatchlistState(value: unknown): value is WatchlistState {
  if (typeof value !== "object" || value === null) return false
  if (Reflect.get(value, "version") !== 1) return false
  const codes = Reflect.get(value, "codes")
  if (!Array.isArray(codes) || codes.length === 0) return false
  const uniqueCodes = new Set<string>()
  for (const code of codes) {
    if (typeof code !== "string" || normalizeMarketCode(code) !== code || uniqueCodes.has(code)) {
      return false
    }
    uniqueCodes.add(code)
  }
  return true
}
