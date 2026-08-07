import type { SimulatedTrade } from "../trading/trading-types"
import {
  appendMemoryEntry,
  EMPTY_MEMORY_STATE,
  MEMORY_CONTENT_MAX,
  type MemoryEntry,
  type MemoryInput,
  type MemoryState,
  removeMemoryEntry,
  renderMemoryPrompt,
  replaceMemoryEntries,
  syncTradeEvaluations,
} from "./memory"
import { MemoryStore } from "./memory-store"

export interface MemoryServiceOptions {
  readonly store?: MemoryStore
  readonly trades?: () => readonly SimulatedTrade[]
  readonly now?: () => Date
}

export class MemoryService {
  readonly #store: MemoryStore
  readonly #trades: (() => readonly SimulatedTrade[]) | undefined
  readonly #now: () => Date
  #state: MemoryState

  constructor(options: MemoryServiceOptions = {}) {
    this.#store = options.store ?? new MemoryStore()
    this.#trades = options.trades
    this.#now = options.now ?? (() => new Date())
    this.#state = this.#store.load() ?? EMPTY_MEMORY_STATE
  }

  get count(): number {
    return this.#state.entries.length
  }

  get lastDreamAt(): string | null {
    return this.#state.lastDreamAt
  }

  list(): readonly MemoryEntry[] {
    this.syncTrades()
    return this.#state.entries
  }

  remember(input: MemoryInput): MemoryEntry {
    const content = input.content.trim()
    if (content.length === 0) throw new Error("记忆内容不能为空")
    if (content.length > MEMORY_CONTENT_MAX) {
      throw new Error(`记忆内容超长：最多 ${MEMORY_CONTENT_MAX} 字`)
    }
    this.syncTrades()
    const { state, entry } = appendMemoryEntry(
      this.#state,
      { ...input, content, source: "agent" },
      this.#now,
    )
    this.#commit(state)
    return entry
  }

  forget(id: string): boolean {
    const next = removeMemoryEntry(this.#state, id)
    if (next === null) return false
    this.#commit(next)
    return true
  }

  clear(): void {
    this.#commit({ ...EMPTY_MEMORY_STATE, evaluatedTrades: this.#state.evaluatedTrades })
  }

  replaceAll(inputs: readonly MemoryInput[]): readonly MemoryEntry[] {
    this.syncTrades()
    this.#commit(replaceMemoryEntries(this.#state, inputs, this.#now))
    return this.#state.entries
  }

  promptSupplement(): readonly string[] {
    return renderMemoryPrompt(this.#state.entries)
  }

  syncTrades(): number {
    if (this.#trades === undefined) return 0
    const { state, added } = syncTradeEvaluations(this.#state, this.#trades(), this.#now)
    if (added.length === 0) return 0
    this.#commit(state)
    return added.length
  }

  #commit(state: MemoryState): void {
    this.#store.save(state)
    this.#state = state
  }
}
