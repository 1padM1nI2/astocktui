import type { SimulatedTrade } from "../trading/trading-types"

export type MemoryKind = "pattern" | "evaluation"
export type MemorySource = "system" | "agent" | "dream"

export interface MemoryEntry {
  readonly id: string
  readonly kind: MemoryKind
  readonly content: string
  readonly tags: readonly string[]
  readonly source: MemorySource
  readonly tradeId?: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface MemoryState {
  readonly version: 1
  readonly sequence: number
  readonly entries: readonly MemoryEntry[]
  readonly evaluatedTrades: readonly string[]
  readonly lastDreamAt: string | null
}

export interface MemoryInput {
  readonly id?: string
  readonly kind: MemoryKind
  readonly content: string
  readonly tags?: readonly string[]
}

export interface AppendMemoryInput extends MemoryInput {
  readonly source: MemorySource
  readonly tradeId?: string
}

export const MAX_MEMORY_ENTRIES = 500
export const PROMPT_MEMORY_LIMIT = 50
export const MEMORY_CONTENT_MAX = 500
export const PROMPT_ENTRY_MAX = 200

export const EMPTY_MEMORY_STATE: MemoryState = {
  version: 1,
  sequence: 0,
  entries: [],
  evaluatedTrades: [],
  lastDreamAt: null,
}

export const MEMORY_KIND_LABELS: Record<MemoryKind, string> = {
  pattern: "规律",
  evaluation: "评估",
}

export const MEMORY_SOURCE_LABELS: Record<MemorySource, string> = {
  system: "系统",
  agent: "Agent",
  dream: "做梦",
}

export function isMemoryState(value: unknown): value is MemoryState {
  if (typeof value !== "object" || value === null) return false
  const state = value as Record<string, unknown>
  if (state["version"] !== 1) return false
  const sequence = state["sequence"]
  if (typeof sequence !== "number" || !Number.isInteger(sequence) || sequence < 0) return false
  if (!Array.isArray(state["entries"]) || !state["entries"].every(isMemoryEntry)) return false
  const keys = state["evaluatedTrades"]
  if (!Array.isArray(keys) || !keys.every((key) => typeof key === "string")) return false
  const lastDreamAt = state["lastDreamAt"]
  return lastDreamAt === null || typeof lastDreamAt === "string"
}

export function memoryTradeKey(trade: SimulatedTrade): string {
  return `${trade.id}:${trade.executedAt}`
}

export function describeTradeEvaluation(trade: SimulatedTrade): string {
  const side = trade.side === "buy" ? "买入" : "卖出"
  const base = `${side} ${trade.name}(${trade.code}) ${trade.quantity}股 @${trade.price.toFixed(2)}`
  const fees = `费用 ${trade.totalFees.toFixed(2)} 元`
  if (trade.side === "buy") return `系统成交记录：${base}，${fees}，成交日 ${trade.tradeDate}`
  const profit = `${trade.realizedProfit >= 0 ? "+" : ""}${trade.realizedProfit.toFixed(2)}`
  return `系统成交记录：${base}，实现盈亏 ${profit} 元（${fees}），成交日 ${trade.tradeDate}`
}

export function syncTradeEvaluations(
  state: MemoryState,
  trades: readonly SimulatedTrade[],
  now: () => Date,
): { state: MemoryState; added: readonly MemoryEntry[] } {
  const recorded = new Set(state.evaluatedTrades)
  const added: MemoryEntry[] = []
  let next = state
  for (const trade of trades) {
    if (recorded.has(memoryTradeKey(trade))) continue
    const appended = appendMemoryEntry(
      next,
      {
        kind: "evaluation",
        content: describeTradeEvaluation(trade),
        tags: [trade.code, trade.side],
        source: "system",
        tradeId: trade.id,
      },
      now,
    )
    next = appended.state
    added.push(appended.entry)
  }
  return {
    state: { ...next, evaluatedTrades: trades.map(memoryTradeKey) },
    added,
  }
}

export function appendMemoryEntry(
  state: MemoryState,
  input: AppendMemoryInput,
  now: () => Date,
): { state: MemoryState; entry: MemoryEntry } {
  const timestamp = now().toISOString()
  const sequence = state.sequence + 1
  const entry: MemoryEntry = {
    id: `MEM-${String(sequence).padStart(4, "0")}`,
    kind: input.kind,
    content: input.content.trim(),
    tags: input.tags ?? [],
    source: input.source,
    ...(input.tradeId === undefined ? {} : { tradeId: input.tradeId }),
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  return {
    state: {
      ...state,
      sequence,
      entries: trimMemoryEntries([...state.entries, entry]),
    },
    entry,
  }
}

export function removeMemoryEntry(state: MemoryState, id: string): MemoryState | null {
  if (!state.entries.some((entry) => entry.id === id)) return null
  return { ...state, entries: state.entries.filter((entry) => entry.id !== id) }
}

export function replaceMemoryEntries(
  state: MemoryState,
  inputs: readonly MemoryInput[],
  now: () => Date,
): MemoryState {
  const timestamp = now().toISOString()
  const existing = new Map(state.entries.map((entry) => [entry.id, entry]))
  const used = new Set<string>()
  let sequence = state.sequence
  const entries: MemoryEntry[] = []
  for (const input of inputs) {
    const kept = input.id === undefined || used.has(input.id) ? undefined : existing.get(input.id)
    if (kept !== undefined) {
      used.add(kept.id)
      entries.push({
        ...kept,
        kind: input.kind,
        content: input.content.trim(),
        tags: input.tags ?? kept.tags,
        updatedAt: timestamp,
      })
      continue
    }
    sequence += 1
    const id = `MEM-${String(sequence).padStart(4, "0")}`
    used.add(id)
    entries.push({
      id,
      kind: input.kind,
      content: input.content.trim(),
      tags: input.tags ?? [],
      source: "dream",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  }
  return {
    version: 1,
    sequence,
    entries: trimMemoryEntries(entries),
    evaluatedTrades: state.evaluatedTrades,
    lastDreamAt: timestamp,
  }
}

export function renderMemoryPrompt(
  entries: readonly MemoryEntry[],
  limit: number = PROMPT_MEMORY_LIMIT,
): readonly string[] {
  if (entries.length === 0) return []
  const recent = entries.slice(-limit)
  return [
    `以下是你的长期记忆（最近 ${recent.length} 条，来自系统成交记录、你的主动记录与历次做梦整理）。分析与交易决策时请结合这些规律与评估；若记忆与最新行情或持仓冲突，以最新数据为准，并在做梦时修正。`,
    ...recent.map(
      (entry) =>
        `- [${MEMORY_KIND_LABELS[entry.kind]}] ${compactContent(entry.content)}（${entry.updatedAt.slice(0, 10)}）`,
    ),
  ]
}

function trimMemoryEntries(entries: readonly MemoryEntry[]): readonly MemoryEntry[] {
  return entries.length > MAX_MEMORY_ENTRIES
    ? entries.slice(entries.length - MAX_MEMORY_ENTRIES)
    : entries
}

function compactContent(content: string): string {
  return content.length > PROMPT_ENTRY_MAX ? `${content.slice(0, PROMPT_ENTRY_MAX - 1)}…` : content
}

function isMemoryEntry(value: unknown): value is MemoryEntry {
  if (typeof value !== "object" || value === null) return false
  const entry = value as Record<string, unknown>
  if (typeof entry["id"] !== "string") return false
  if (entry["kind"] !== "pattern" && entry["kind"] !== "evaluation") return false
  if (typeof entry["content"] !== "string") return false
  const tags = entry["tags"]
  if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === "string")) return false
  if (entry["source"] !== "system" && entry["source"] !== "agent" && entry["source"] !== "dream") {
    return false
  }
  if (entry["tradeId"] !== undefined && typeof entry["tradeId"] !== "string") return false
  return typeof entry["createdAt"] === "string" && typeof entry["updatedAt"] === "string"
}
