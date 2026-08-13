import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { stripVTControlCharacters } from "node:util"
import { visibleWidth } from "@oh-my-pi/pi-tui"
import {
  AgentController,
  type AgentDriver,
  type AgentDriverEvent,
} from "../../src/agent/controller"
import { ScheduledTaskStore } from "../../src/agent/scheduled-task-store"
import { MarketIntelligenceApp } from "../../src/app/app"
import { AutomationRuntime } from "../../src/app/automation-runtime"
import type { MarketDataSource, MarketSnapshot } from "../../src/market/data"
import type { FinancialNewsSnapshot, NewsDataSource } from "../../src/news/data"
import { ConditionalOrderStore } from "../../src/trading/conditional-order-store"
import { PaperTradingService } from "../../src/trading/trading"
import { WatchlistService } from "../../src/trading/watchlist"

const MARKET_SNAPSHOT: MarketSnapshot = {
  quotes: [],
  trend: [],
  source: "test-market",
}

const TRADING_MARKET_SNAPSHOT: MarketSnapshot = {
  quotes: [
    {
      code: "SH600519",
      name: "贵州茅台",
      price: 100,
      changePercent: 1,
      source: "test-market",
    },
  ],
  trend: [100],
  source: "test-market",
}

const NEWS_SNAPSHOT: FinancialNewsSnapshot = {
  items: [],
  source: "test-news",
}

function focusAgent(app: MarketIntelligenceApp): void {
  app.handleInput("\t")
  app.handleInput("\t")
  app.handleInput("\t")
}

function enter(app: MarketIntelligenceApp, input: string): void {
  for (const character of input) app.handleInput(character)
  app.handleInput("\r")
}

async function enterCommand(app: MarketIntelligenceApp, input: string): Promise<void> {
  enter(app, input)
  await app.waitForCommand()
}

function expectFrameFits(frame: readonly string[], width: number): void {
  for (const line of frame) expect(visibleWidth(line)).toBeLessThanOrEqual(width)
}

class ScriptedAgentDriver implements AgentDriver {
  async run(input: string, emit: (event: AgentDriverEvent) => void): Promise<void> {
    emit({ type: "tool_start", id: "market", name: "get_market_snapshot", label: "读取实时行情" })
    emit({
      type: "tool_end",
      id: "market",
      name: "get_market_snapshot",
      label: "读取实时行情",
      summary: "行情读取完成",
      isError: false,
    })
    emit({ type: "text_delta", delta: `Pi 回答：${input}` })
  }

  clear(): void {}
  abort(): void {}

  usageSummary(): string {
    return ""
  }
}

class LongAnswerAgentDriver implements AgentDriver {
  async run(_input: string, emit: (event: AgentDriverEvent) => void): Promise<void> {
    emit({
      type: "text_delta",
      delta: Array.from({ length: 20 }, (_, index) => `第${index + 1}段分析内容`).join("\n\n"),
    })
  }

  clear(): void {}
  abort(): void {}

  usageSummary(): string {
    return ""
  }
}

describe("Agent 命令窗口", () => {
  test("输入斜杠显示由注册表生成的命令列表并支持过滤", () => {
    const app = new MarketIntelligenceApp()
    focusAgent(app)

    app.handleInput("/")
    const allCommands = app.render(79).join("\n")
    expect(allCommands).toContain("命令列表")
    expect(allCommands).toContain("/help")
    expect(allCommands).toContain("/refresh")
    expect(allCommands).toContain("/portfolio")

    app.handleInput("r")
    app.handleInput("e")
    const filtered = app.render(79).join("\n")
    expect(filtered).toContain("/refresh")
    expect(filtered).not.toContain("/portfolio")
    expectFrameFits(app.render(79), 79)
  })

  test("命令候选和操作提示紧贴输入框上方", () => {
    const app = new MarketIntelligenceApp()
    focusAgent(app)
    for (const character of "/ref") app.handleInput(character)

    const lines = app.render(79).map(stripVTControlCharacters)
    const inputIndex = lines.findIndex((line) => line.includes(">_ /ref"))

    expect(inputIndex).toBeGreaterThan(1)
    expect(lines[inputIndex - 1]).toContain("↑↓ 选择 · Tab 补全 · Esc 关闭")
    expect(lines[inputIndex - 2]).toContain("/refresh")
    expect(lines[inputIndex]).not.toContain("↑↓ 选择")
  })

  test("任意工作区输入斜杠都会切换至 Agent 命令窗口", () => {
    for (const tabMoves of [0, 1, 2, 3]) {
      const app = new MarketIntelligenceApp()
      for (let index = 0; index < tabMoves; index++) app.handleInput("\t")

      app.handleInput("/")
      const frame = app.render(79).map(stripVTControlCharacters).join("\n")

      expect(frame).toContain("◆ Agent / 上下文")
      expect(frame).toContain("命令列表")
      expect(frame).toContain(">_ /")
    }

    const app = new MarketIntelligenceApp()
    focusAgent(app)
    app.handleInput("未提交问题")
    app.handleInput("\t")
    app.handleInput("/")
    const frame = app.render(79).map(stripVTControlCharacters).join("\n")
    expect(frame).toContain(">_ /")
    expect(frame).not.toContain("未提交问题")
  })

  test("命令列表打开时 Tab 补全而不是切换工作区", () => {
    const app = new MarketIntelligenceApp()
    focusAgent(app)
    for (const character of "/re") app.handleInput(character)

    app.handleInput("\t")
    const frame = stripVTControlCharacters(app.render(79).join("\n"))
    expect(frame).toContain(">_ /refresh ")
    expect(frame).toContain("Agent / 上下文")
  })

  test("命令列表打开时独占方向键和 Shift+Tab", () => {
    for (const key of ["\x1b[C", "\x1b[D", "\x1b[Z"]) {
      const app = new MarketIntelligenceApp()
      focusAgent(app)
      app.handleInput("/")

      app.handleInput(key)
      const frame = app.render(79).join("\n")
      expect(frame).toContain("Agent / 上下文")
      expect(frame).toContain("命令列表")
    }
  })

  test("长 Agent 输出可用 PageUp 与 PageDown 在历史和最新内容间翻页", async () => {
    const app = new MarketIntelligenceApp(
      undefined,
      undefined,
      () => 16,
      undefined,
      undefined,
      undefined,
      () => new AgentController(new LongAnswerAgentDriver(), "test/model"),
    )
    focusAgent(app)
    enter(app, "给出完整分析")
    await app.waitForAgent()

    const latest = stripVTControlCharacters(app.render(80).join("\n"))
    expect(latest).toContain("第20段分析内容")
    expect(latest).not.toContain("第1段分析内容")

    app.handleInput("\x1b[5~")
    const history = stripVTControlCharacters(app.render(80).join("\n"))
    expect(history).toContain("第10段分析内容")
    expect(history).not.toContain("第20段分析内容")

    app.handleInput("\x1b[6~")
    const returned = stripVTControlCharacters(app.render(80).join("\n"))
    expect(returned).toContain("第20段分析内容")
    expectFrameFits(app.render(80), 80)
  })

  test("refresh all 同时刷新行情与新闻并显示执行结果", async () => {
    let marketCalls = 0
    let newsCalls = 0
    const marketSource: MarketDataSource = {
      async loadSnapshot(): Promise<MarketSnapshot> {
        marketCalls++
        return MARKET_SNAPSHOT
      },
    }
    const newsSource: NewsDataSource = {
      async loadNews(): Promise<FinancialNewsSnapshot> {
        newsCalls++
        return NEWS_SNAPSHOT
      },
    }
    const app = new MarketIntelligenceApp(marketSource, newsSource)
    focusAgent(app)

    enter(app, "/refresh all")
    await Promise.resolve()

    expect(marketCalls).toBe(1)
    expect(newsCalls).toBe(1)
    expect(app.render(79).join("\n")).toContain("已启动刷新：行情、财经新闻")
  })

  test("刷新已在进行时命令反馈真实去重状态", () => {
    const marketSource: MarketDataSource = {
      loadSnapshot: () => new Promise<MarketSnapshot>(() => {}),
    }
    const newsSource: NewsDataSource = {
      loadNews: () => new Promise<FinancialNewsSnapshot>(() => {}),
    }
    const app = new MarketIntelligenceApp(marketSource, newsSource)
    void app.refreshMarket()
    void app.refreshNews()
    focusAgent(app)

    enter(app, "/refresh all")

    expect(app.render(79).join("\n")).toContain("刷新进行中：行情、财经新闻")
  })

  test("focus 命令切换工作区，portfolio 命令显示真实模拟账户", () => {
    const app = new MarketIntelligenceApp()
    focusAgent(app)
    enter(app, "/portfolio")
    const accountFrame = app.render(79)
    expect(accountFrame.join("\n")).toContain("模拟账户")
    expect(accountFrame.join("\n")).toContain("¥100,000.00")
    expectFrameFits(accountFrame, 79)

    enter(app, "/focus portfolio")
    expect(app.render(79).join("\n")).toContain("持仓 / 模拟账户")
  })

  test("status 命令反映当前工作区和数据状态", () => {
    const app = new MarketIntelligenceApp()
    focusAgent(app)

    enter(app, "/status")
    const frame = app.render(79).join("\n")
    expect(frame).toContain("工作台状态")
    expect(frame).toContain("工作区 Agent")
    expect(frame).toContain("行情 未加载")
    expect(frame).toContain("财经新闻 未加载")
  })

  test("preview 和 buy 使用实时行情完成模拟买入", async () => {
    const marketSource: MarketDataSource = {
      async loadSnapshot(): Promise<MarketSnapshot> {
        return TRADING_MARKET_SNAPSHOT
      },
    }
    const trading = new PaperTradingService({
      now: () => new Date("2026-07-15T02:00:00.000Z"),
    })
    const app = new MarketIntelligenceApp(marketSource, undefined, undefined, trading)
    await app.refreshMarket()
    focusAgent(app)

    await enterCommand(app, "/buy 519 100")
    let frame = stripVTControlCharacters(app.render(79).join("\n"))
    expect(frame).toContain("股票代码格式无效")
    expect(trading.snapshot.positions).toEqual([])

    await enterCommand(app, "/preview buy 600519 100")
    frame = stripVTControlCharacters(app.render(79).join("\n"))
    expect(frame).toContain("交易预览")
    expect(frame).toContain("买入 SH600519 贵州茅台 100股")
    expect(frame).toContain("预计支出 ¥10,005.10")
    expect(trading.snapshot.positions).toEqual([])

    await enterCommand(app, "/buy 600519 100")
    frame = stripVTControlCharacters(app.render(79).join("\n"))
    expect(frame).toContain("模拟买入成交")
    expect(frame).toContain("成交金额 ¥10,000.00")
    expect(trading.snapshot.positions[0]?.quantity).toBe(100)
    const wideFrame = stripVTControlCharacters(app.render(160).join("\n"))
    expect(wideFrame).toContain("交易记录 / 最近成交 [1笔]")
    expect(wideFrame).toContain("SIM-0001 买入 SH600519 100股")

    enter(app, "/portfolio")
    frame = stripVTControlCharacters(app.render(79).join("\n"))
    expect(frame).toContain("SH600519 贵州茅台 100股")
    expect(frame).toContain("¥89,994.90")

    enter(app, "/focus portfolio")
    frame = stripVTControlCharacters(app.render(79).join("\n"))
    expect(frame).toContain("可卖0股")
  })

  test("输入陌生股票代码后自动拉取行情并直接成交", async () => {
    let requestedCodes: readonly string[] = []
    const marketSource: MarketDataSource = {
      async loadSnapshot(codes): Promise<MarketSnapshot> {
        requestedCodes = [...codes]
        const quotes = codes.includes("SZ000938")
          ? [
              {
                code: "SZ000938",
                name: "紫光股份",
                price: 20,
                changePercent: 0.5,
                source: "test-market",
              },
            ]
          : []
        return { quotes, trend: [20], source: "test-market" }
      },
    }
    const trading = new PaperTradingService()
    const app = new MarketIntelligenceApp(marketSource, undefined, undefined, trading)
    focusAgent(app)

    enter(app, "/buy 000938 100")
    expect(app.render(79).join("\n")).toContain("命令执行中")
    expect(stripVTControlCharacters(app.render(79).join("\n"))).toContain("● 执行中")
    await app.waitForCommand()

    expect(requestedCodes).toContain("SZ000938")
    expect(app.render(79).join("\n")).toContain("模拟买入成交")
    expect(trading.snapshot.positions[0]?.code).toBe("SZ000938")
  })

  test("卖出遵守 T+1，成交记录可查询并支持确认重置", async () => {
    let now = new Date("2026-07-15T02:00:00.000Z")
    const marketSource: MarketDataSource = {
      async loadSnapshot(): Promise<MarketSnapshot> {
        return TRADING_MARKET_SNAPSHOT
      },
    }

    const trading = new PaperTradingService({ now: () => now })
    const app = new MarketIntelligenceApp(marketSource, undefined, undefined, trading)
    await app.refreshMarket()
    focusAgent(app)
    await enterCommand(app, "/buy 600519 100")

    await enterCommand(app, "/sell 600519 all")
    expect(app.render(79).join("\n")).toContain("T+1")

    now = new Date("2026-07-16T02:00:00.000Z")
    await enterCommand(app, "/sell 600519 all")
    expect(app.render(79).join("\n")).toContain("模拟卖出成交")

    enter(app, "/trades 600519")
    const trades = stripVTControlCharacters(app.render(79).join("\n"))
    expect(trades).toContain("成交记录")
    expect(trades).toContain("买入 SH600519")
    expect(trades).toContain("卖出 SH600519")

    enter(app, "/account reset")
    expect(app.render(79).join("\n")).toContain("需要确认")
    enter(app, "/account reset confirm")
    expect(app.render(79).join("\n")).toContain("模拟账户已重置")
    expect(trading.trades).toEqual([])
  })

  test("亏损卖出使用绿色且负号位于人民币符号前", async () => {
    let now = new Date("2026-07-15T02:00:00.000Z")
    let price = 100
    const marketSource: MarketDataSource = {
      async loadSnapshot(): Promise<MarketSnapshot> {
        return {
          ...TRADING_MARKET_SNAPSHOT,
          quotes: [
            {
              ...(TRADING_MARKET_SNAPSHOT.quotes[0] ?? {}),
              price,
            } as MarketSnapshot["quotes"][number],
          ],
        }
      },
    }
    const trading = new PaperTradingService({ now: () => now })
    const app = new MarketIntelligenceApp(marketSource, undefined, undefined, trading)
    await app.refreshMarket()
    focusAgent(app)
    await enterCommand(app, "/buy 600519 100")

    now = new Date("2026-07-16T02:00:00.000Z")
    price = 90
    await app.refreshMarket()
    await enterCommand(app, "/sell 600519 all")
    const rawFrame = app.render(120).join("\n")

    expect(rawFrame).toContain("\x1b[32m")
    expect(stripVTControlCharacters(rawFrame)).toContain("实现盈亏 -¥")
  })
  test("watch 命令查看、添加和删除行情自选股", async () => {
    const requestedCodes: string[][] = []
    const source: MarketDataSource = {
      async loadSnapshot(codes): Promise<MarketSnapshot> {
        requestedCodes.push([...codes])
        return {
          quotes: codes.map((code) => ({
            code,
            name: code === "SZ000938" ? "紫光股份" : "贵州茅台",
            price: code === "SZ000938" ? 20 : 1_500,
            changePercent: 0.5,
            source: "test-market",
          })),
          trend: [1_490, 1_500],
          source: "test-market",
        }
      },
    }
    const watchlist = new WatchlistService({ codes: ["SH600519"] })
    const directory = mkdtempSync(join(tmpdir(), "astocktui-command-window-watch-"))
    const automation = new AutomationRuntime({
      sink: { enqueue: () => "queued" },
      lotSize: 100,
      conditionalOrderStore: new ConditionalOrderStore(join(directory, "conditional-orders.json")),
      scheduledTaskStore: new ScheduledTaskStore(join(directory, "scheduled-tasks.json")),
    })
    const app = new MarketIntelligenceApp(
      source,
      undefined,
      undefined,
      new PaperTradingService(),
      undefined,
      watchlist,
      undefined,
      undefined,
      undefined,
      automation,
    )

    await enterCommand(app, "/watch list")
    expect(stripVTControlCharacters(app.render(79).join("\n"))).toContain("SH600519")

    await enterCommand(app, "/watch add 000938")
    let frame = stripVTControlCharacters(app.render(79).join("\n"))
    expect(frame).toContain("已添加 SZ000938")
    expect(requestedCodes.at(-1)).toEqual(["SH600519", "SZ000938"])

    await enterCommand(app, "/focus market")
    frame = stripVTControlCharacters(app.render(79).join("\n"))
    expect(frame).toContain("000938")
    expect(frame).toContain("紫光股份")

    await enterCommand(app, "/watch remove 000938")
    expect(stripVTControlCharacters(app.render(79).join("\n"))).toContain("已删除 SZ000938")
    expect(watchlist.codes).toEqual(["SH600519"])
    expect(requestedCodes.at(-1)).toEqual(["SH600519"])
    rmSync(directory, { recursive: true, force: true })
  })

  test("普通问题交给 Pi Agent 并显示真实流式回答和工具状态", async () => {
    const driver = new ScriptedAgentDriver()
    const app = new MarketIntelligenceApp(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => new AgentController(driver, "test/model"),
    )
    focusAgent(app)

    enter(app, "分析午后行情")
    await app.waitForAgent()
    const frame = stripVTControlCharacters(app.render(120).join("\n"))

    expect(frame).toContain("User · 分析午后行情")
    expect(frame).toContain("Tool · 读取实时行情")
    expect(frame).toContain("Pi 回答：分析午后行情")
    expect(frame).not.toContain("已完成多源分析")
  })

  test("clear 清除命令输出和既有 Agent 回答", async () => {
    const driver = new ScriptedAgentDriver()
    const app = new MarketIntelligenceApp(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => new AgentController(driver, "test/model"),
    )
    focusAgent(app)
    enter(app, "分析午后拉升")
    await app.waitForAgent()
    expect(app.render(79).join("\n")).toContain("分析午后拉升")

    enter(app, "/clear")
    const frame = app.render(79).join("\n")
    expect(frame).not.toContain("分析午后拉升")
    expect(frame).toContain("Pi Agent 已就绪")
  })

  test("quit、exit 及其斜杠形式都调用应用退出回调", () => {
    for (const command of ["/quit", "/exit", "quit", "exit"]) {
      const app = new MarketIntelligenceApp()
      focusAgent(app)
      let called = false
      app.onQuit = () => {
        called = true
      }

      enter(app, command)
      expect(called).toBe(true)
    }
  })

  test("命令列表和结果在宽屏与窄屏布局中均不溢出", () => {
    for (const width of [20, 40, 79, 160]) {
      const app = new MarketIntelligenceApp(undefined, undefined, () => 30)
      focusAgent(app)
      app.handleInput("/")
      expectFrameFits(app.render(width), width)
      app.handleInput("\x1b")
      enter(app, "/help")
      expectFrameFits(app.render(width), width)
    }
  })

  test("宽屏短面板滚动候选时始终显示当前命令", () => {
    const app = new MarketIntelligenceApp(undefined, undefined, () => 30)
    focusAgent(app)
    app.handleInput("/")
    app.handleInput("\x1b[A")

    const frame = stripVTControlCharacters(app.render(160).join("\n"))
    expect(frame).toContain("/quit | /exit")
  })
})

test("命令窗口将全球股票加入自选并在刷新后显示跨市场行", async () => {
  let requested: readonly string[] = []
  const source: MarketDataSource = {
    async loadSnapshot(codes): Promise<MarketSnapshot> {
      requested = [...codes]
      return {
        quotes: codes.map((code) =>
          code === "US:AAPL"
            ? {
                code,
                name: "Apple",
                price: 210,
                changePercent: 1.25,
                source: "yahoo",
                market: "US" as const,
                currency: "USD",
                marketState: "open" as const,
              }
            : { code, name: "A股", price: 100, changePercent: 0.5, source: "fixture" },
        ),
        trend: [99, 100],
        source: "多源",
      }
    },
  }
  const app = new MarketIntelligenceApp(source, undefined, () => 16)
  try {
    focusAgent(app)
    await enterCommand(app, "/watch add US:AAPL")
    expect(app.render(79).join("\n")).toContain("US:AAPL")

    await enterCommand(app, "/refresh market")
    await Promise.resolve()
    expect(requested).toContain("US:AAPL")
    app.handleInput("\t")
    app.handleInput("\t")
    const frame = app.render(79).map(stripVTControlCharacters).join("\n")
    expect(frame).toContain("全球股票")
    expect(frame).toContain("US USD")
    expectFrameFits(app.render(79), 79)
  } finally {
    await app.dispose()
  }
})
