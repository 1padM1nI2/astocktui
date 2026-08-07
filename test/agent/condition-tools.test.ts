import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentTool } from "@oh-my-pi/pi-agent-core"
import { createConditionAgentTools } from "../../src/agent/condition-tools"
import { AUTOMATION_COMMANDS } from "../../src/commands/automation"
import type { CommandContext, CommandResult } from "../../src/commands/commands"
import type { MarketSnapshot } from "../../src/market/data"
import { ConditionalOrderService } from "../../src/trading/conditional-order-service"
import { ConditionalOrderStore } from "../../src/trading/conditional-order-store"

const NOW = new Date("2026-07-21T01:30:00.000Z") // 周二 09:30（上海）

const MARKET: MarketSnapshot = {
  quotes: [{ code: "SH600519", name: "贵州茅台", price: 1400, changePercent: 1, source: "test" }],
  trend: [1390, 1400],
  source: "test",
}

function fixture(): {
  readonly directory: string
  readonly context: CommandContext
  readonly service: ConditionalOrderService
  readonly tools: readonly AgentTool[]
} {
  const directory = mkdtempSync(join(tmpdir(), "astocktui-condition-tools-"))
  const service = new ConditionalOrderService({
    sink: { enqueue: () => "queued" },
    lotSize: 100,
    now: () => NOW,
    store: new ConditionalOrderStore(join(directory, "conditional-orders.json")),
  })
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
    marketSnapshot: () => MARKET,
    newsSnapshot: () => null,
    portfolio: () => ({ initialCapital: 100_000, cash: 100_000, positions: [] }),
    quote: async () => undefined,
    trading: () => {
      throw new Error("未实现")
    },
    portfolioChanged: () => {},
    watchlist: () => ["SH600519"],
    changeWatchlist: async () => ({ ok: false, code: "", message: "未实现" }),
    conditionalOrders: () => service,
  }
  return { directory, context, service, tools: createConditionAgentTools(context) }
}

async function runTool(
  tools: readonly AgentTool[],
  params: Record<string, unknown>,
): Promise<unknown> {
  const tool = tools.find((candidate) => candidate.name === "manage_condition_order")
  if (tool === undefined) throw new Error("工具不存在：manage_condition_order")
  const result = await tool.execute("test-call", params)
  const text = result.content.find((item) => item.type === "text")?.text
  return text === undefined ? null : JSON.parse(text)
}

function runCommand(context: CommandContext, input: string): CommandResult {
  const command = AUTOMATION_COMMANDS.find((candidate) => candidate.name === "condition")
  if (command === undefined) throw new Error("命令不存在：condition")
  const args = input.split(/\s+/).slice(1)
  const result = command.execute(context, args)
  if (result instanceof Promise) throw new Error("预期同步命令")
  return result
}

describe("manage_condition_order 创建条件单", () => {
  test("创建价格交易条件单并持久化", async () => {
    const { directory, service, tools } = fixture()
    try {
      const created = await runTool(tools, {
        action: "create",
        code: "SH600519",
        name: "茅台破位",
        condition: { type: "price", operator: "lte", price: 1300 },
        side: "sell",
        quantity: 100,
        triggerPolicy: "repeat",
        cooldownMinutes: 30,
      })
      expect(created).toMatchObject({
        code: "SH600519",
        name: "茅台破位",
        status: "enabled",
        triggerPolicy: "repeat",
        cooldownMinutes: 30,
        condition: { type: "price", operator: "lte", price: 1300 },
        action: { kind: "trade", side: "sell", quantity: 100 },
      })
      expect(service.orders).toHaveLength(1)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("缺买卖参数时创建仅分析条件单，有效期默认 24 小时", async () => {
    const { directory, service, tools } = fixture()
    try {
      const created = (await runTool(tools, {
        action: "create",
        code: "SH600519",
        condition: { type: "change-percent", operator: "gte", percent: 3, referencePrice: 1400 },
      })) as { readonly action: { readonly kind: string }; readonly expiresAt: string }
      expect(created.action.kind).toBe("analyze")
      expect(new Date(created.expiresAt).getTime()).toBe(NOW.getTime() + 24 * 3_600_000)
      expect(service.orders[0]?.name).toBe("SH600519")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("非法数量或非整手被拒绝", async () => {
    const { directory, tools } = fixture()
    try {
      await expect(
        runTool(tools, {
          action: "create",
          code: "SH600519",
          condition: { type: "price", operator: "lte", price: 1300 },
          side: "sell",
          quantity: 10,
        }),
      ).rejects.toThrow("整数倍")
      await expect(
        runTool(tools, {
          action: "create",
          code: "SH600519",
          condition: { type: "price", price: 1300 },
        }),
      ).rejects.toThrow()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe("/condition 命令扩展", () => {
  test("percent 条件以最新价作参考价", () => {
    const { directory, context, service } = fixture()
    try {
      const result = runCommand(context, "/condition percent SH600519 buy 100 above 3")
      expect(result.title).toBe("创建条件单")
      expect(service.orders[0]?.condition).toEqual({
        type: "change-percent",
        operator: "gte",
        percent: 3,
        referencePrice: 1400,
      })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("analyze 模式不需要数量", () => {
    const { directory, context, service } = fixture()
    try {
      const result = runCommand(context, "/condition price SH600519 analyze below 1300")
      expect(result.title).toBe("创建条件单")
      expect(service.orders[0]?.action).toEqual({ kind: "analyze" })
      expect(service.orders[0]?.condition).toMatchObject({ type: "price", operator: "lte" })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("percent 缺少最新行情时报错", () => {
    const { directory, context, service } = fixture()
    try {
      const broken: CommandContext = { ...context, marketSnapshot: () => null }
      const result = runCommand(broken, "/condition percent SH600519 buy 100 above 3")
      expect(result.title).toBe("命令错误")
      expect(service.orders).toHaveLength(0)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
