import { describe, expect, test } from "bun:test"
import {
  appendMemoryEntry,
  describeTradeEvaluation,
  EMPTY_MEMORY_STATE,
  isMemoryState,
  MAX_MEMORY_ENTRIES,
  PROMPT_MEMORY_LIMIT,
  removeMemoryEntry,
  renderMemoryPrompt,
  replaceMemoryEntries,
  syncTradeEvaluations,
} from "../src/memory"
import type { SimulatedTrade } from "../src/trading-types"

const NOW = new Date("2026-07-16T08:00:00.000Z")
const now = () => NOW

const BUY_TRADE: SimulatedTrade = {
  id: "SIM-0001",
  side: "buy",
  code: "SZ000938",
  name: "紫光股份",
  quantity: 100,
  price: 20,
  grossAmount: 2000,
  commission: 5,
  stampDuty: 0,
  transferFee: 0.02,
  totalFees: 5.02,
  cashChange: -2005.02,
  cashAfter: 97994.98,
  realizedProfit: 0,
  executedAt: "2026-07-15T02:00:00.000Z",
  tradeDate: "2026-07-15",
}

const SELL_TRADE: SimulatedTrade = {
  ...BUY_TRADE,
  id: "SIM-0002",
  side: "sell",
  price: 22,
  grossAmount: 2200,
  stampDuty: 1.1,
  totalFees: 7.32,
  cashChange: 2192.68,
  cashAfter: 100187.66,
  realizedProfit: 187.66,
  executedAt: "2026-07-16T06:00:00.000Z",
  tradeDate: "2026-07-16",
}

describe("记忆状态校验", () => {
  test("空状态合法，错误结构被拒绝", () => {
    expect(isMemoryState(EMPTY_MEMORY_STATE)).toBe(true)
    expect(isMemoryState(null)).toBe(false)
    expect(isMemoryState({ ...EMPTY_MEMORY_STATE, version: 2 })).toBe(false)
    expect(isMemoryState({ ...EMPTY_MEMORY_STATE, entries: [{ id: "MEM-0001" }] })).toBe(false)
    expect(isMemoryState({ ...EMPTY_MEMORY_STATE, lastDreamAt: 1 })).toBe(false)
  })
})

describe("系统成交评估文案", () => {
  test("买入记录方向、数量、价格与费用", () => {
    const text = describeTradeEvaluation(BUY_TRADE)
    expect(text).toContain("买入 紫光股份(SZ000938) 100股 @20.00")
    expect(text).toContain("费用 5.02 元")
    expect(text).toContain("2026-07-15")
    expect(text).not.toContain("实现盈亏")
  })
  test("卖出额外记录实现盈亏", () => {
    const text = describeTradeEvaluation(SELL_TRADE)
    expect(text).toContain("卖出 紫光股份(SZ000938) 100股 @22.00")
    expect(text).toContain("实现盈亏 +187.66 元")
    expect(text).toContain("费用 7.32 元")
  })
})

describe("成交同步为系统评估", () => {
  test("新成交生成评估条目且重复同步幂等", () => {
    const first = syncTradeEvaluations(EMPTY_MEMORY_STATE, [BUY_TRADE], now)
    expect(first.added).toHaveLength(1)
    expect(first.added[0]).toMatchObject({
      id: "MEM-0001",
      kind: "evaluation",
      source: "system",
      tradeId: "SIM-0001",
    })
    const again = syncTradeEvaluations(first.state, [BUY_TRADE], now)
    expect(again.added).toEqual([])
    expect(again.state.entries).toHaveLength(1)
  })
  test("只追加新成交，账户重置后同号新成交仍被记录", () => {
    const first = syncTradeEvaluations(EMPTY_MEMORY_STATE, [BUY_TRADE], now)
    const second = syncTradeEvaluations(first.state, [BUY_TRADE, SELL_TRADE], now)
    expect(second.added.map((entry) => entry.tradeId)).toEqual(["SIM-0002"])

    const reset = syncTradeEvaluations(second.state, [], now)
    expect(reset.added).toEqual([])
    const reborn: SimulatedTrade = { ...BUY_TRADE, executedAt: "2026-07-17T02:00:00.000Z" }
    const third = syncTradeEvaluations(reset.state, [reborn], now)
    expect(third.added).toHaveLength(1)
    expect(third.added[0]?.tradeId).toBe("SIM-0001")
  })
})

describe("记忆条目增删", () => {
  test("追加分配连续 id 并裁剪到上限", () => {
    const { state, entry } = appendMemoryEntry(
      EMPTY_MEMORY_STATE,
      { kind: "pattern", content: "  放量突破后回踩不破五日线  ", source: "agent" },
      now,
    )
    expect(entry.id).toBe("MEM-0001")
    expect(entry.content).toBe("放量突破后回踩不破五日线")
    expect(state.sequence).toBe(1)

    let full = EMPTY_MEMORY_STATE
    for (let index = 0; index < MAX_MEMORY_ENTRIES + 5; index += 1) {
      full = appendMemoryEntry(
        full,
        { kind: "pattern", content: `规律 ${index}`, source: "agent" },
        now,
      ).state
    }
    expect(full.entries).toHaveLength(MAX_MEMORY_ENTRIES)
    expect(full.entries[0]?.content).toBe("规律 5")
    expect(full.sequence).toBe(MAX_MEMORY_ENTRIES + 5)
  })
  test("按 id 删除，未知 id 返回 null", () => {
    const { state } = appendMemoryEntry(
      EMPTY_MEMORY_STATE,
      { kind: "evaluation", content: "追高买入被套", source: "agent" },
      now,
    )
    const removed = removeMemoryEntry(state, "MEM-0001")
    expect(removed?.entries).toEqual([])
    expect(removeMemoryEntry(state, "MEM-9999")).toBeNull()
  })
})

describe("做梦整体写回", () => {
  test("保留命中 id 的来源与时间，新条目来自做梦", () => {
    const base = appendMemoryEntry(
      EMPTY_MEMORY_STATE,
      { kind: "pattern", content: "旧规律", source: "agent" },
      now,
    ).state
    const synced = syncTradeEvaluations(base, [SELL_TRADE], now).state

    const later = new Date("2026-07-17T12:00:00.000Z")
    const next = replaceMemoryEntries(
      synced,
      [
        { id: "MEM-0001", kind: "pattern", content: "旧规律（修订）" },
        { kind: "pattern", content: "归纳：放量突破需配合换手率确认" },
      ],
      () => later,
    )
    expect(next.entries).toHaveLength(2)
    expect(next.entries[0]).toMatchObject({
      id: "MEM-0001",
      source: "agent",
      content: "旧规律（修订）",
      createdAt: NOW.toISOString(),
      updatedAt: later.toISOString(),
    })
    expect(next.entries[1]).toMatchObject({ id: "MEM-0003", source: "dream" })
    expect(next.lastDreamAt).toBe(later.toISOString())
    expect(next.evaluatedTrades).toEqual(synced.evaluatedTrades)
  })
  test("重复或未知 id 按新条目处理", () => {
    const base = appendMemoryEntry(
      EMPTY_MEMORY_STATE,
      { kind: "pattern", content: "旧规律", source: "agent" },
      now,
    ).state
    const next = replaceMemoryEntries(
      base,
      [
        { id: "MEM-0001", kind: "pattern", content: "保留" },
        { id: "MEM-0001", kind: "pattern", content: "重复 id" },
        { id: "MEM-9999", kind: "pattern", content: "未知 id" },
      ],
      now,
    )
    expect(next.entries.map((entry) => entry.id)).toEqual(["MEM-0001", "MEM-0002", "MEM-0003"])
    expect(next.entries[1]?.source).toBe("dream")
  })
})

describe("记忆注入 prompt", () => {
  test("空记忆不注入", () => {
    expect(renderMemoryPrompt([])).toEqual([])
  })
  test("头部加条目行，遵守条数与长度上限", () => {
    let state = EMPTY_MEMORY_STATE
    for (let index = 0; index < PROMPT_MEMORY_LIMIT + 10; index += 1) {
      state = appendMemoryEntry(
        state,
        {
          kind: index % 2 === 0 ? "pattern" : "evaluation",
          content: `内容 ${index}`,
          source: "agent",
        },
        now,
      ).state
    }
    const lines = renderMemoryPrompt(state.entries)
    expect(lines).toHaveLength(PROMPT_MEMORY_LIMIT + 1)
    expect(lines[0]).toContain("长期记忆")
    expect(lines[1]).toContain("[规律] 内容 10")
    expect(lines[PROMPT_MEMORY_LIMIT]).toContain("[评估] 内容 59")

    const long = appendMemoryEntry(
      EMPTY_MEMORY_STATE,
      { kind: "pattern", content: "长".repeat(300), source: "agent" },
      now,
    ).state
    const compact = renderMemoryPrompt(long.entries)
    expect(compact[1]?.length).toBeLessThanOrEqual(220)
    expect(compact[1]).toContain("…")
  })
})
