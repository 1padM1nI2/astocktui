import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MEMORY_CONTENT_MAX } from "../../src/agent/memory"
import { MemoryService } from "../../src/agent/memory-service"
import { MemoryStore } from "../../src/agent/memory-store"
import type { SimulatedTrade } from "../../src/trading/types"

const NOW = new Date("2026-07-16T08:00:00.000Z")

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

function temporaryService(trades: SimulatedTrade[] = []): {
  readonly directory: string
  readonly trades: SimulatedTrade[]
  create: () => MemoryService
} {
  const directory = mkdtempSync(join(tmpdir(), "astocktui-memory-service-"))
  const path = join(directory, "memory.json")
  return {
    directory,
    trades,
    create: () =>
      new MemoryService({ store: new MemoryStore(path), trades: () => trades, now: () => NOW }),
  }
}

describe("记忆服务", () => {
  test("记录、遗忘、清空并持久化到磁盘", () => {
    const temporary = temporaryService()
    try {
      const service = temporary.create()
      const entry = service.remember({ kind: "pattern", content: "高开低走减仓" })
      expect(entry.id).toBe("MEM-0001")
      expect(entry.source).toBe("agent")
      expect(service.count).toBe(1)

      expect(
        temporary
          .create()
          .list()
          .map((item) => item.content),
      ).toEqual(["高开低走减仓"])

      expect(service.forget("MEM-0001")).toBe(true)
      expect(service.forget("MEM-0001")).toBe(false)
      service.remember({ kind: "evaluation", content: "早盘追高被套" })
      service.clear()
      expect(service.count).toBe(0)
      expect(temporary.create().list()).toEqual([])
    } finally {
      rmSync(temporary.directory, { recursive: true, force: true })
    }
  })

  test("非法内容被拒绝", () => {
    const temporary = temporaryService()
    try {
      const service = temporary.create()
      expect(() => service.remember({ kind: "pattern", content: "   " })).toThrow("内容不能为空")
      expect(() =>
        service.remember({ kind: "pattern", content: "长".repeat(MEMORY_CONTENT_MAX + 1) }),
      ).toThrow("内容超长")
    } finally {
      rmSync(temporary.directory, { recursive: true, force: true })
    }
  })

  test("新成交自动沉淀为系统评估且重启后不重复", () => {
    const temporary = temporaryService([BUY_TRADE])
    try {
      const service = temporary.create()
      expect(service.list().map((entry) => entry.source)).toEqual(["system"])
      expect(service.syncTrades()).toBe(0)

      temporary.trades.push({
        ...BUY_TRADE,
        id: "SIM-0002",
        executedAt: "2026-07-16T06:00:00.000Z",
      })
      expect(service.syncTrades()).toBe(1)

      const restored = temporary.create()
      expect(restored.list()).toHaveLength(2)
      expect(restored.syncTrades()).toBe(0)
    } finally {
      rmSync(temporary.directory, { recursive: true, force: true })
    }
  })

  test("清空记忆不会重放历史成交评估", () => {
    const temporary = temporaryService([BUY_TRADE])
    try {
      const service = temporary.create()
      expect(service.list()).toHaveLength(1)
      service.clear()
      expect(service.syncTrades()).toBe(0)
      expect(service.list()).toEqual([])
    } finally {
      rmSync(temporary.directory, { recursive: true, force: true })
    }
  })

  test("做梦写回更新 lastDreamAt 并注入 prompt", () => {
    const temporary = temporaryService()
    try {
      const service = temporary.create()
      expect(service.promptSupplement()).toEqual([])

      service.remember({ kind: "pattern", content: "缩量阴跌不抄底" })
      service.replaceAll([{ id: "MEM-0001", kind: "pattern", content: "缩量阴跌不抄底（确认）" }])
      expect(service.lastDreamAt).toBe(NOW.toISOString())

      const supplement = service.promptSupplement()
      expect(supplement[0]).toContain("长期记忆")
      expect(supplement[1]).toContain("缩量阴跌不抄底（确认）")
      expect(temporary.create().lastDreamAt).toBe(NOW.toISOString())
    } finally {
      rmSync(temporary.directory, { recursive: true, force: true })
    }
  })
})
