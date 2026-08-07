import { defaultAppDataPath, readJsonFile, writeJsonFileAtomically } from "../infra/json-file"
import { PaperTradingService } from "./trading"
import type {
  PaperTradingOptions,
  PaperTradingPositionState,
  PaperTradingState,
  SimulatedTrade,
} from "./trading-types"

export interface PersistentPaperTradingOptions
  extends Omit<PaperTradingOptions, "state" | "onStateChange"> {
  readonly path?: string
}

export function defaultPaperAccountPath(): string {
  return defaultAppDataPath("paper-account.json")
}

export class PaperAccountStore {
  readonly path: string

  constructor(path: string = defaultPaperAccountPath()) {
    this.path = path
  }

  load(): PaperTradingState | null {
    try {
      const value = readJsonFile(this.path)
      if (value === null) return null
      if (!isPaperTradingState(value)) throw new Error("状态结构无效")
      return value
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`模拟账户文件损坏：${this.path}（${reason}）`)
    }
  }

  save(state: PaperTradingState): void {
    writeJsonFileAtomically(this.path, state)
  }
}

export function createPersistentPaperTradingService(
  options: PersistentPaperTradingOptions = {},
): PaperTradingService {
  const { path = defaultPaperAccountPath(), ...tradingOptions } = options
  const store = new PaperAccountStore(path)
  const state = store.load()
  const onStateChange = (next: PaperTradingState): void => store.save(next)
  return state === null
    ? new PaperTradingService({ ...tradingOptions, onStateChange })
    : new PaperTradingService({ ...tradingOptions, state, onStateChange })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
}

function isPosition(value: unknown): value is PaperTradingPositionState {
  if (!isRecord(value)) return false
  const code = Reflect.get(value, "code")
  const name = Reflect.get(value, "name")
  const quantity = Reflect.get(value, "quantity")
  const averageCost = Reflect.get(value, "averageCost")
  const currentPrice = Reflect.get(value, "currentPrice")
  const lots = Reflect.get(value, "lots")
  if (
    typeof code !== "string" ||
    typeof name !== "string" ||
    !isPositiveInteger(quantity) ||
    !isFiniteNumber(averageCost) ||
    averageCost <= 0 ||
    !isFiniteNumber(currentPrice) ||
    currentPrice <= 0 ||
    !Array.isArray(lots)
  ) {
    return false
  }
  let lotQuantity = 0
  for (const lot of lots) {
    if (!isRecord(lot)) return false
    const quantity = Reflect.get(lot, "quantity")
    const acquiredOn = Reflect.get(lot, "acquiredOn")
    if (
      !isPositiveInteger(quantity) ||
      typeof acquiredOn !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(acquiredOn)
    ) {
      return false
    }
    lotQuantity += quantity
  }
  return lotQuantity === quantity
}

const TRADE_NUMBER_FIELDS = [
  "quantity",
  "price",
  "grossAmount",
  "commission",
  "stampDuty",
  "transferFee",
  "totalFees",
  "cashChange",
  "cashAfter",
  "realizedProfit",
] as const

function isTrade(value: unknown): value is SimulatedTrade {
  if (!isRecord(value)) return false
  const side = Reflect.get(value, "side")
  if (
    typeof Reflect.get(value, "id") !== "string" ||
    (side !== "buy" && side !== "sell") ||
    typeof Reflect.get(value, "code") !== "string" ||
    typeof Reflect.get(value, "name") !== "string" ||
    typeof Reflect.get(value, "executedAt") !== "string" ||
    typeof Reflect.get(value, "tradeDate") !== "string"
  ) {
    return false
  }
  for (const field of TRADE_NUMBER_FIELDS) {
    if (!isFiniteNumber(Reflect.get(value, field))) return false
  }
  return isPositiveInteger(Reflect.get(value, "quantity"))
}

function isPaperTradingState(value: unknown): value is PaperTradingState {
  if (!isRecord(value)) return false
  const initialCapital = Reflect.get(value, "initialCapital")
  const cash = Reflect.get(value, "cash")
  const sequence = Reflect.get(value, "sequence")
  const positions = Reflect.get(value, "positions")
  const trades = Reflect.get(value, "trades")
  if (
    Reflect.get(value, "version") !== 1 ||
    !isFiniteNumber(initialCapital) ||
    initialCapital <= 0 ||
    !isFiniteNumber(cash) ||
    cash < 0 ||
    typeof sequence !== "number" ||
    !Number.isInteger(sequence) ||
    sequence < 0 ||
    !Array.isArray(positions) ||
    !Array.isArray(trades)
  ) {
    return false
  }
  return positions.every(isPosition) && trades.every(isTrade)
}
