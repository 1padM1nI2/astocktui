import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentTool } from "@oh-my-pi/pi-agent-core"
import { toolWireSchema } from "@oh-my-pi/pi-ai"
import { createAStockAgentTools } from "../src/agent-tools"
import type { CommandContext } from "../src/commands"
import type { HotRankSnapshot } from "../src/eastmoney-hot-rank"
import type { MarketSnapshot } from "../src/market-data"
import type { MarketOverviewSnapshot } from "../src/market-overview"
import type { FinancialNewsSnapshot } from "../src/news-data"
import { ScheduledTaskService } from "../src/scheduled-task-service"
import { ScheduledTaskStore } from "../src/scheduled-task-store"
import { PaperTradingService } from "../src/trading"

const QUOTE = {
  code: "SH600519",
  name: "贵州茅台",
  price: 100,
  changePercent: 1,
  source: "test-market",
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

function toolContext(): {
  readonly context: CommandContext
  readonly trading: PaperTradingService
  readonly focused: string[]
  readonly refreshed: string[]
  readonly watchlist: string[]
  portfolioChanges: number
  resets: number
} {
  const trading = new PaperTradingService({ now: () => new Date("2026-07-16T02:00:00.000Z") })
  const focused: string[] = []
  const refreshed: string[] = []
  const watchlist = ["SH600519"]
  const market: MarketSnapshot = { quotes: [QUOTE], trend: [99, 100], source: "test-market" }
  const overview: MarketOverviewSnapshot = {
    indices: [],
    breadth: {
      rising: 3_000,
      falling: 2_000,
      flat: 100,
      gainAtLeast10Percent: 50,
      lossAtLeast10Percent: 10,
      distribution: {},
    },
    sectors: { leaders: [], laggards: [], totalTurnover: 1_000_000_000_000 },
    movers: { gainers: [], losers: [] },
    capital: null,
    source: "test-overview",
    availability: {
      indices: false,
      breadth: true,
      sectors: true,
      movers: true,
      capital: false,
      errors: [],
    },
    updatedAt: 1_752_634_800_000,
  }
  const news: FinancialNewsSnapshot = {
    items: [
      { id: "1", title: "白酒板块午后走强", publishedAt: 1_752_634_800_000, source: "财联社" },
      { id: "2", title: "银行板块震荡", publishedAt: 1_752_634_700_000, source: "华尔街见闻" },
    ],
    source: "test-news",
  }
  const state = {
    context: undefined as unknown as CommandContext,
    trading,
    focused,
    refreshed,
    watchlist,
    portfolioChanges: 0,
    resets: 0,
  }
  state.context = {
    focus: (workspace) => focused.push(workspace),
    refresh: (target) => ({
      market: target === "news" ? "skipped" : "started",
      news: target === "market" ? "skipped" : "started",
    }),
    refreshAndWait: async (target) => {
      refreshed.push(target)
    },
    quit: () => {},
    clearAgent: () => {},
    status: () => ({
      activeWorkspace: "agent",
      market: { state: "ready", source: market.source },
      news: { state: "ready", source: news.source },
      agent: "ready",
    }),
    marketSnapshot: () => market,
    marketOverview: async () => overview,
    newsSnapshot: () => news,
    portfolio: () => trading.snapshot,
    quote: async (code) => (code.endsWith("600519") ? QUOTE : undefined),
    trading: () => trading,
    portfolioChanged: () => {
      state.portfolioChanges++
    },
    watchlist: () => [...watchlist],
    changeWatchlist: async (action, code) => {
      if (action === "add") watchlist.push(code)
      else watchlist.splice(watchlist.indexOf(code), 1)
      return { ok: true, code, message: action === "add" ? `已添加 ${code}` : `已删除 ${code}` }
    },
  }
  return state
}

describe("AStock Pi Agent 工具", () => {
  test("文件工具读取并编辑复盘记忆", async () => {
    const tools = createAStockAgentTools(toolContext().context)
    const dir = join(tmpdir(), `astocktui-agent-tools-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, "复盘记忆.md")
    writeFileSync(path, "结论：白酒趋势偏强\n", "utf8")

    globalThis.tool = {
      read: async ({ path: target }) => {
        const match = target.match(/^([A-Za-z]:[\\/][^:]*)/)
        const filePath = match?.[1] ?? target.split(":")[0] ?? target
        return readFileSync(filePath, "utf8")
      },
      edit: async ({ path: target, edits }) => {
        const content = readFileSync(target, "utf8")
        const first = edits[0]
        if (first === undefined) throw new Error("缺少编辑内容")
        writeFileSync(target, content.replace(first.old_text, first.new_text), "utf8")
        return { ok: true }
      },
    }

    expect(await runTool(tools, "read", { path })).toContain("白酒趋势偏强")
    await runTool(tools, "edit", { path, old_text: "偏强", new_text: "转弱" })
    expect(readFileSync(path, "utf8")).toContain("转弱")
    globalThis.tool = undefined
  })

  test("独立终端没有宿主工具时仍能读取并编辑本地复盘文件", async () => {
    const directory = mkdtempSync(join(tmpdir(), "astocktui-local-file-tools-"))
    try {
      const path = join(directory, "复盘.md")
      writeFileSync(path, "结论：仓位偏高\n", "utf8")
      globalThis.tool = undefined
      const tools = createAStockAgentTools(toolContext().context)

      expect(await runTool(tools, "read", { path })).toContain("仓位偏高")
      await runTool(tools, "edit", { path, old_text: "偏高", new_text: "合理" })
      expect(readFileSync(path, "utf8")).toContain("仓位合理")
    } finally {
      globalThis.tool = undefined
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("向 Agent 暴露全部行情、新闻、账户和控制接口", () => {
    const tools = createAStockAgentTools(toolContext().context)
    expect(tools.map((tool) => tool.name)).toEqual([
      "get_app_status",
      "get_market_snapshot",
      "get_market_overview",
      "get_financial_news",
      "get_portfolio",
      "get_hot_rank",
      "get_trade_history",
      "refresh_data",
      "manage_watchlist",
      "preview_trade",
      "execute_trade",
      "reset_paper_account",
      "focus_workspace",
      "read",
      "write",
      "edit",
      "list",
      "move",
      "mkdir",
      "delete",
      "manage_condition_order",
      "manage_scheduled_task",
      "remember_memory",
      "list_memories",
      "forget_memory",
      "replace_memories",
    ])
  })

  test("行情工具描述告知 Agent 全球代码格式与市场元数据", () => {
    const tools = createAStockAgentTools(toolContext().context)
    const watchlist = tools.find((tool) => tool.name === "manage_watchlist")
    const snapshot = tools.find((tool) => tool.name === "get_market_snapshot")
    expect(watchlist?.description).toContain("US:AAPL")
    expect(watchlist?.description).toContain("JP:")
    expect(watchlist?.description).toContain("KR:")
    expect(snapshot?.description).toContain("marketState")
    expect(snapshot?.description).toContain("diagnostics")
  })

  test("Agent 通过显式工具管理自定义定时任务", async () => {
    const directory = mkdtempSync(join(tmpdir(), "astocktui-task-agent-tools-"))
    try {
      const state = toolContext()
      const service = new ScheduledTaskService({
        store: new ScheduledTaskStore(join(directory, "scheduled-tasks.json")),
        sink: { enqueue: () => "queued" },
        now: () => new Date("2026-07-17T01:00:00.000Z"),
      })
      state.context.scheduledTasks = () => service
      const tools = createAStockAgentTools(state.context)
      expect(
        await runTool(tools, "manage_scheduled_task", {
          action: "create",
          name: "午后检查",
          prompt: "检查风险",
          schedule: { kind: "interval", minutes: 15 },
        }),
      ).toMatchObject({ id: "TASK-0001", createdBy: "agent" })
      expect(
        await runTool(tools, "manage_scheduled_task", { action: "pause", id: "TASK-0001" }),
      ).toMatchObject({ enabled: false })
      expect(await runTool(tools, "manage_scheduled_task", { action: "list" })).toMatchObject({
        total: 1,
      })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("定时任务工具容忍缺省 weekdaysOnly 与未补零时间", async () => {
    const directory = mkdtempSync(join(tmpdir(), "astocktui-task-agent-tools-"))
    try {
      const state = toolContext()
      const service = new ScheduledTaskService({
        store: new ScheduledTaskStore(join(directory, "scheduled-tasks.json")),
        sink: { enqueue: () => "queued" },
        now: () => new Date("2026-07-17T01:00:00.000Z"),
      })
      state.context.scheduledTasks = () => service
      const tools = createAStockAgentTools(state.context)
      const tool = tools.find((candidate) => candidate.name === "manage_scheduled_task")
      const schema = tool?.parameters as {
        safeParse(input: unknown): { success: boolean }
      }

      expect(
        schema.safeParse({
          action: "create",
          name: "盘前提醒",
          prompt: "提示",
          schedule: { kind: "daily", time: "09:30" },
        }).success,
      ).toBe(true)

      const created = await runTool(tools, "manage_scheduled_task", {
        action: "create",
        name: "盘前提醒",
        prompt: "提示",
        schedule: { kind: "daily", time: "9:30" },
      })
      expect(created).toMatchObject({
        id: "TASK-0001",
        schedule: { kind: "daily", time: "09:30", weekdaysOnly: false },
      })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("定时任务调度规则对模型呈现为扁平 schema", () => {
    const tools = createAStockAgentTools(toolContext().context)
    const tool = tools.find((candidate) => candidate.name === "manage_scheduled_task")
    if (tool === undefined) throw new Error("工具不存在：manage_scheduled_task")
    const wire = toolWireSchema(tool as never) as {
      properties?: Record<string, Record<string, unknown> | undefined>
    }
    const schedule = wire.properties?.["schedule"]
    expect(schedule?.["anyOf"]).toBeUndefined()
    expect(schedule?.["type"]).toBe("object")
    const kind = schedule?.["properties"] as Record<string, { enum?: string[] } | undefined>
    expect(kind["kind"]?.enum).toEqual(["once", "daily", "interval"])
  })

  test("定时任务缺少调度字段时给出按类型的明确错误", async () => {
    const directory = mkdtempSync(join(tmpdir(), "astocktui-task-agent-tools-"))
    try {
      const state = toolContext()
      const service = new ScheduledTaskService({
        store: new ScheduledTaskStore(join(directory, "scheduled-tasks.json")),
        sink: { enqueue: () => "queued" },
        now: () => new Date("2026-07-17T01:00:00.000Z"),
      })
      state.context.scheduledTasks = () => service
      const tools = createAStockAgentTools(state.context)

      await expect(
        runTool(tools, "manage_scheduled_task", {
          action: "create",
          name: "盘前提醒",
          prompt: "提示",
          schedule: { kind: "daily" },
        }),
      ).rejects.toThrow("每日任务需要 time")
      await expect(
        runTool(tools, "manage_scheduled_task", {
          action: "create",
          name: "提醒",
          prompt: "提示",
          schedule: { kind: "interval" },
        }),
      ).rejects.toThrow("间隔任务需要 minutes")
      await expect(
        runTool(tools, "manage_scheduled_task", {
          action: "create",
          name: "提醒",
          prompt: "提示",
          schedule: { kind: "once" },
        }),
      ).rejects.toThrow("一次性任务需要 at")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("读取工具返回实时行情、新闻、账户和成交记录", async () => {
    const state = toolContext()
    const tools = createAStockAgentTools(state.context)

    expect(await runTool(tools, "get_app_status")).toMatchObject({ activeWorkspace: "agent" })
    expect(await runTool(tools, "get_market_snapshot")).toMatchObject({ source: "test-market" })
    expect(await runTool(tools, "get_market_overview")).toMatchObject({
      source: "test-overview",
      breadth: { rising: 3_000, falling: 2_000 },
    })
    expect(await runTool(tools, "get_financial_news", { query: "白酒", limit: 1 })).toMatchObject({
      source: "test-news",
      total: 1,
      items: [{ title: "白酒板块午后走强" }],
    })
    expect(await runTool(tools, "get_portfolio")).toMatchObject({ cash: 100_000 })
    expect(await runTool(tools, "get_trade_history")).toEqual([])
  })

  test("Agent 行情工具保留全球市场的币种、状态和时间元数据", async () => {
    const state = toolContext()
    const tools = createAStockAgentTools({
      ...state.context,
      marketSnapshot: () => ({
        quotes: [
          {
            code: "US:AAPL",
            name: "Apple",
            price: 210,
            changePercent: 1.25,
            source: "yahoo",
            market: "US" as const,
            currency: "USD",
            marketState: "closed" as const,
            asOf: 1_752_634_800_000,
          },
        ],
        trend: [209, 210],
        source: "Yahoo Finance",
      }),
    })

    expect(await runTool(tools, "get_market_snapshot")).toMatchObject({
      quotes: [
        {
          code: "US:AAPL",
          market: "US",
          currency: "USD",
          marketState: "closed",
          asOf: 1_752_634_800_000,
        },
      ],
    })
  })

  test("Agent 交易复用模拟账户风控并更新持仓", async () => {
    const state = toolContext()
    const tools = createAStockAgentTools(state.context)

    const preview = await runTool(tools, "preview_trade", {
      side: "buy",
      code: "600519",
      quantity: 100,
    })
    expect(preview).toMatchObject({ side: "buy", code: "SH600519", quantity: 100 })
    expect(state.trading.trades).toHaveLength(0)

    const executed = await runTool(tools, "execute_trade", {
      side: "buy",
      code: "600519",
      quantity: 100,
    })
    expect(executed).toMatchObject({ ok: true, trade: { id: "SIM-0001" } })
    expect(state.trading.snapshot.positions[0]?.quantity).toBe(100)
    expect(state.portfolioChanges).toBe(1)
  })

  test("自主模拟交易工具声明为无需执行批准的本地写操作", () => {
    const tool = createAStockAgentTools(toolContext().context).find(
      (candidate) => candidate.name === "execute_trade",
    )

    expect(tool).toMatchObject({ approval: "write", concurrency: "exclusive" })
  })

  test("Agent 可按用户指定的历史或假设价格模拟成交", async () => {
    const state = toolContext()
    const tools = createAStockAgentTools(state.context)

    const preview = await runTool(tools, "preview_trade", {
      side: "buy",
      code: "600519",
      quantity: 100,
      price: 88.5,
    })
    expect(preview).toMatchObject({ price: 88.5, grossAmount: 8_850 })

    const executed = await runTool(tools, "execute_trade", {
      side: "buy",
      code: "600519",
      quantity: 100,
      price: 88.5,
    })
    expect(executed).toMatchObject({ ok: true, trade: { price: 88.5, grossAmount: 8_850 } })
    expect(state.trading.snapshot.positions[0]?.currentPrice).toBe(88.5)
  })

  test("Agent 可以刷新、管理自选股、切换焦点并显式重置模拟账户", async () => {
    const state = toolContext()
    const tools = createAStockAgentTools(state.context)
    state.trading.execute("buy", QUOTE, 100)

    await runTool(tools, "refresh_data", { target: "all" })
    await runTool(tools, "manage_watchlist", { action: "add", code: "SZ000938" })
    await runTool(tools, "focus_workspace", { workspace: "portfolio" })
    await runTool(tools, "focus_workspace", { workspace: "trade" })
    await expect(runTool(tools, "reset_paper_account", { confirmation: "NO" })).rejects.toThrow(
      "RESET",
    )
    await runTool(tools, "reset_paper_account", { confirmation: "RESET" })

    expect(state.refreshed).toEqual(["all"])
    expect(state.watchlist).toContain("SZ000938")
    expect(state.focused).toEqual(["portfolio", "trade"])
    expect(state.trading.snapshot.positions).toEqual([])
  })
})

describe("股吧人气榜工具", () => {
  const HOT_RANK: HotRankSnapshot = {
    items: [
      {
        code: "SH603986",
        rank: 1,
        rankChange: 2,
        name: "兆易创新",
        price: 371.1,
        changePercent: 1.94,
      },
      {
        code: "SZ001309",
        rank: 2,
        rankChange: -1,
        name: "德明利",
        price: 390.04,
        changePercent: -5.5,
      },
    ],
    source: "东财股吧人气",
    updatedAt: 1_753_900_000_000,
  }

  test("上下文未接入或未加载时返回 not_loaded", async () => {
    expect(await runTool(createAStockAgentTools(toolContext().context), "get_hot_rank")).toEqual({
      status: "not_loaded",
    })
    const unloaded = { ...toolContext().context, hotRank: async () => null }
    expect(await runTool(createAStockAgentTools(unloaded), "get_hot_rank")).toEqual({
      status: "not_loaded",
    })
  })

  test("返回人气榜条目并按 limit 截断", async () => {
    const context = { ...toolContext().context, hotRank: async () => HOT_RANK }
    const tools = createAStockAgentTools(context)

    expect(await runTool(tools, "get_hot_rank", { limit: 1 })).toEqual({
      source: "东财股吧人气",
      updatedAt: 1_753_900_000_000,
      total: 2,
      items: [HOT_RANK.items[0]],
    })
    const full = (await runTool(tools, "get_hot_rank")) as { readonly total: number }
    expect(full.total).toBe(2)
  })

  test("refresh 参数透传给数据源", async () => {
    const calls: (boolean | undefined)[] = []
    const context = {
      ...toolContext().context,
      hotRank: async (refresh?: boolean) => {
        calls.push(refresh)
        return HOT_RANK
      },
    }
    const tools = createAStockAgentTools(context)

    await runTool(tools, "get_hot_rank")
    await runTool(tools, "get_hot_rank", { refresh: true })

    expect(calls).toEqual([false, true])
  })
})
