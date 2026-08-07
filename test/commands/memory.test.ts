import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentSystemEvent } from "../../src/agent/event-dispatcher"
import { MemoryService } from "../../src/agent/memory-service"
import { MemoryStore } from "../../src/agent/memory-store"
import type { CommandContext, CommandResult } from "../../src/commands/commands"
import { MEMORY_COMMANDS } from "../../src/commands/memory"

const NOW = new Date("2026-07-18T12:00:00.000Z") // 周六 20:00（上海）

function fixture(): {
  readonly directory: string
  readonly context: CommandContext
  readonly service: MemoryService
  readonly events: AgentSystemEvent[]
} {
  const directory = mkdtempSync(join(tmpdir(), "astocktui-memory-commands-"))
  const service = new MemoryService({
    store: new MemoryStore(join(directory, "memory.json")),
    now: () => NOW,
  })
  const events: AgentSystemEvent[] = []
  const keys = new Set<string>()
  const sink = {
    enqueue(event: AgentSystemEvent): "queued" | "deduped" {
      if (keys.has(event.dedupeKey)) return "deduped"
      keys.add(event.dedupeKey)
      events.push(event)
      return "queued"
    },
  }
  const context: CommandContext = {
    focus: () => {},
    refresh: () => ({ market: "skipped", news: "skipped" }),
    refreshAndWait: async () => {},
    quit: () => {},
    clearAgent: () => {},
    marketOverview: async () => {
      throw new Error("未实现")
    },
    status: () => ({
      activeWorkspace: "agent",
      market: { state: "idle", source: null },
      news: { state: "idle", source: null },
      agent: "ready",
    }),
    marketSnapshot: () => null,
    newsSnapshot: () => null,
    portfolio: () => ({ initialCapital: 100_000, cash: 100_000, positions: [] }),
    quote: async () => undefined,
    trading: () => {
      throw new Error("未实现")
    },
    portfolioChanged: () => {},
    watchlist: () => [],
    changeWatchlist: async () => ({ ok: false, code: "", message: "未实现" }),
    systemEvents: () => sink,
    memory: () => service,
  }
  return { directory, context, service, events }
}

function run(context: CommandContext, input: string): CommandResult {
  const command = MEMORY_COMMANDS[0]
  if (command === undefined) throw new Error("记忆命令未注册")
  const result = command.execute(context, input.trim().split(/\s+/u).slice(1))
  if (result instanceof Promise) throw new Error("预期同步命令")
  return result
}

describe("记忆命令", () => {
  test("空记忆列表与追加后的列表", () => {
    const { directory, context, service } = fixture()
    try {
      expect(run(context, "/memory").lines).toEqual(["暂无记忆"])
      service.remember({ kind: "pattern", content: "缩量阴跌不抄底" })
      service.remember({ kind: "evaluation", content: "追高买入被套" })

      const result = run(context, "/memory list")
      expect(result.title).toContain("2 条")
      expect(result.lines[0]).toContain("[MEM-0002 评估] 追高买入被套（Agent")
      expect(result.lines[1]).toContain("[MEM-0001 规律] 缩量阴跌不抄底（Agent")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("清空记忆", () => {
    const { directory, context, service } = fixture()
    try {
      service.remember({ kind: "pattern", content: "缩量阴跌不抄底" })
      expect(run(context, "/memory clear").lines[0]).toContain("已清空")
      expect(service.count).toBe(0)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("手动触发做梦，同日重复触发被去重", () => {
    const { directory, context, events } = fixture()
    try {
      expect(run(context, "/memory dream").lines[0]).toContain("已触发记忆整理")
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ kind: "dream", title: "记忆整理" })
      expect(events[0]?.prompt).toContain("list_memories")
      expect(events[0]?.prompt).toContain("replace_memories")

      expect(run(context, "/memory dream").lines[0]).toContain("今日已整理")
      expect(events).toHaveLength(1)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("未知子命令给出用法", () => {
    const { directory, context } = fixture()
    try {
      const result = run(context, "/memory bogus")
      expect(result.title).toBe("命令错误")
      expect(result.lines[0]).toContain("/memory")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
