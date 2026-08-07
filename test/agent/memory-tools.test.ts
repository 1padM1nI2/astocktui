import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentTool } from "@oh-my-pi/pi-agent-core"
import { MemoryService } from "../../src/agent/memory-service"
import { MemoryStore } from "../../src/agent/memory-store"
import { createMemoryAgentTools } from "../../src/agent/memory-tools"
import type { CommandContext } from "../../src/commands/commands"

const NOW = new Date("2026-07-16T08:00:00.000Z")

function stubContext(memory: MemoryService): CommandContext {
  return {
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
    memory: () => memory,
  }
}

async function runTool(
  tools: readonly AgentTool[],
  name: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const tool = tools.find((candidate) => candidate.name === name)
  if (tool === undefined) throw new Error(`工具不存在：${name}`)
  const result = await tool.execute("test-call", params)
  const text = result.content.find((item) => item.type === "text")?.text
  return text === undefined ? null : JSON.parse(text)
}

function temporaryTools(): {
  readonly directory: string
  readonly tools: readonly AgentTool[]
  readonly service: MemoryService
} {
  const directory = mkdtempSync(join(tmpdir(), "astocktui-memory-tools-"))
  const service = new MemoryService({
    store: new MemoryStore(join(directory, "memory.json")),
    now: () => NOW,
  })
  return { directory, service, tools: createMemoryAgentTools(stubContext(service)) }
}

describe("记忆 Agent 工具", () => {
  test("记录、读取、删除记忆", async () => {
    const temporary = temporaryTools()
    try {
      const remembered = (await runTool(temporary.tools, "remember_memory", {
        kind: "pattern",
        content: "尾盘拉升次日多半低开",
        tags: ["短线"],
      })) as { id: string; source: string }
      expect(remembered).toMatchObject({ id: "MEM-0001", source: "agent" })

      const listed = (await runTool(temporary.tools, "list_memories")) as {
        total: number
        entries: { content: string }[]
      }
      expect(listed.total).toBe(1)
      expect(listed.entries[0]?.content).toBe("尾盘拉升次日多半低开")

      expect(await runTool(temporary.tools, "forget_memory", { id: "MEM-0001" })).toMatchObject({
        ok: true,
      })
      expect(await runTool(temporary.tools, "forget_memory", { id: "MEM-0001" })).toMatchObject({
        ok: false,
      })
    } finally {
      rmSync(temporary.directory, { recursive: true, force: true })
    }
  })

  test("非法内容通过工具执行报错", async () => {
    const temporary = temporaryTools()
    try {
      await expect(
        runTool(temporary.tools, "remember_memory", { kind: "pattern", content: "  " }),
      ).rejects.toThrow("内容不能为空")
    } finally {
      rmSync(temporary.directory, { recursive: true, force: true })
    }
  })

  test("做梦写回整理后的记忆列表", async () => {
    const temporary = temporaryTools()
    try {
      temporary.service.remember({ kind: "pattern", content: "旧规律" })
      const replaced = (await runTool(temporary.tools, "replace_memories", {
        entries: [
          { id: "MEM-0001", kind: "pattern", content: "旧规律（修订）" },
          { kind: "evaluation", content: "归纳：追高买入两次亏损，等待回踩确认" },
        ],
      })) as { total: number; lastDreamAt: string | null; entries: { id: string }[] }
      expect(replaced.total).toBe(2)
      expect(replaced.lastDreamAt).toBe(NOW.toISOString())
      expect(replaced.entries.map((entry) => entry.id)).toEqual(["MEM-0001", "MEM-0002"])
    } finally {
      rmSync(temporary.directory, { recursive: true, force: true })
    }
  })
})
