import type { ConditionalOrderState } from "./conditional-orders"
import { defaultAppDataPath, readJsonFile, writeJsonFileAtomically } from "./json-file"

export const EMPTY_CONDITIONAL_ORDER_STATE: ConditionalOrderState = {
  version: 1,
  sequence: 0,
  orders: [],
}

export class ConditionalOrderStore {
  readonly path: string
  constructor(path: string = defaultAppDataPath("conditional-orders.json")) {
    this.path = path
  }
  load(): { state: ConditionalOrderState; diagnostic: string | null } {
    try {
      const value = readJsonFile(this.path)
      if (value === null) return { state: EMPTY_CONDITIONAL_ORDER_STATE, diagnostic: null }
      if (!isState(value)) throw new Error("状态结构无效")
      return { state: value, diagnostic: null }
    } catch (error) {
      return {
        state: EMPTY_CONDITIONAL_ORDER_STATE,
        diagnostic: error instanceof Error ? error.message : String(error),
      }
    }
  }
  save(state: ConditionalOrderState): void {
    writeJsonFileAtomically(this.path, state)
  }
}
function isState(value: unknown): value is ConditionalOrderState {
  if (typeof value !== "object" || value === null) return false
  const state = value as Record<string, unknown>
  return (
    state["version"] === 1 &&
    typeof state["sequence"] === "number" &&
    Array.isArray(state["orders"])
  )
}
