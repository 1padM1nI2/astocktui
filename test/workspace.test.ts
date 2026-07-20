import { describe, expect, test } from "bun:test"
import { stripVTControlCharacters } from "node:util"
import { visibleWidth } from "@oh-my-pi/pi-tui"
import { AgentController, type AgentDriver, type AgentDriverEvent } from "../src/agent-controller"
import { MarketIntelligenceApp } from "../src/app"
import { ANSI } from "../src/colors"
import type { FinancialNewsSnapshot, NewsDataSource } from "../src/news-data"
import { PaperTradingService } from "../src/trading"

function expectFrameFits(lines: readonly string[], width: number): void {
  for (const line of lines) {
    expect(visibleWidth(line)).toBeLessThanOrEqual(width)
  }
}

const TEST_NEWS_SNAPSHOT: FinancialNewsSnapshot = {
  source: "NewsNow 2源",
  items: [
    {
      id: "cls-telegraph:1",
      title: "央行开展逆回购操作",
      publishedAt: Date.UTC(2026, 6, 14, 1, 30),
      source: "财联社",
    },
    {
      id: "wallstreetcn-quick:2",
      title: "A股三大指数集体高开",
      publishedAt: Date.UTC(2026, 6, 14, 1, 25),
      source: "华尔街见闻",
    },
    {
      id: "cls-telegraph:3",
      title: "人民币中间价公布",
      publishedAt: Date.UTC(2026, 6, 14, 1, 20),
      source: "财联社",
    },
  ],
}

const TEST_NEWS_SOURCE: NewsDataSource = {
  async loadNews(): Promise<FinancialNewsSnapshot> {
    return TEST_NEWS_SNAPSHOT
  },
}

class WorkspaceAgentDriver implements AgentDriver {
  async run(input: string, emit: (event: AgentDriverEvent) => void): Promise<void> {
    emit({ type: "tool_start", id: "news", name: "get_financial_news", label: "财经新闻" })
    emit({
      type: "tool_end",
      id: "news",
      name: "get_financial_news",
      label: "财经新闻",
      summary: "新闻读取完成",
      isError: false,
    })
    emit({ type: "text_delta", delta: `已分析：${input}` })
  }

  clear(): void {}
  abort(): void {}
}

describe("市场智能工作台", () => {
  test("在宽终端中同时呈现行情、持仓、新闻和 Agent 工作区", () => {
    // Given
    const app = new MarketIntelligenceApp()

    // When
    const frame = app.render(160)

    // Then
    expect(frame.join("\n")).toContain("行情")
    expect(frame.join("\n")).toContain("持仓 / 模拟账户")
    expect(frame.join("\n")).toContain("实时新闻")
    expect(frame.join("\n")).toContain("Agent")
    expectFrameFits(frame, 160)
  })

  test("宽屏 Agent 右侧显示最近交易记录", () => {
    const trading = new PaperTradingService()
    trading.execute("buy", { code: "SH600519", name: "贵州茅台", price: 10 }, 100)
    const app = new MarketIntelligenceApp(undefined, undefined, () => 30, trading)

    const frame = app.render(160)
    const bottomHeader = frame.find((line) => line.includes("Agent / 上下文")) ?? ""
    const plainHeader = stripVTControlCharacters(bottomHeader)
    const plainFrame = stripVTControlCharacters(frame.join("\n"))

    expect(plainHeader).toContain("交易记录 / 最近成交 [1笔]")
    expect(plainHeader.indexOf("交易记录")).toBeGreaterThan(plainHeader.indexOf("Agent"))
    expect(plainHeader.match(/╭/g)).toHaveLength(2)
    expect(plainHeader.match(/╮/g)).toHaveLength(2)
    expect(plainFrame).toContain("SIM-0001 买入 SH600519 100股")
    expectFrameFits(frame, 160)

    app.handleInput("\t")
    app.handleInput("\t")
    app.handleInput("\t")
    const narrowFrame = stripVTControlCharacters(app.render(159).join("\n"))
    expect(narrowFrame).toContain("Agent / 上下文")
    expect(narrowFrame).not.toContain("交易记录 / 最近成交")
  })

  test("宽屏上排行情、持仓与新闻，下排 Agent 至少占据一半高度", () => {
    const app = new MarketIntelligenceApp(undefined, undefined, () => 30)
    const frame = app.render(160)
    const workspaceHeaderIndex = frame.findIndex((line) => line.includes("行情 / 沪深A股 实时"))
    const agentHeaderIndex = frame.findIndex((line) => line.includes("Agent / 上下文"))
    const workspaceHeader = frame[workspaceHeaderIndex] ?? ""
    const agentHeader = frame[agentHeaderIndex] ?? ""

    expect(frame).toHaveLength(30)
    expect(workspaceHeader).toContain("实时新闻 / 财经")
    expect(workspaceHeader).toContain("持仓 / 模拟账户")
    expect(workspaceHeader).not.toContain("Agent / 上下文")
    expect(workspaceHeader.match(/╭/g)).toHaveLength(3)
    expect(workspaceHeader.match(/╮/g)).toHaveLength(3)
    expect(agentHeaderIndex).toBeGreaterThan(workspaceHeaderIndex)
    expect(agentHeader).toContain("╭")
    expect(agentHeader).toContain("╮")
    expect(frame.length - (agentHeaderIndex - 1)).toBeGreaterThanOrEqual(15)
    expect(visibleWidth(agentHeader)).toBe(160)
    expect(frame.at(-1)).toContain("╰")
    expect(frame.at(-1)).toContain("╯")
  })

  test("宽屏 Agent 将输入光标保留在提示符后", () => {
    const app = new MarketIntelligenceApp(undefined, undefined, () => 30)
    app.handleInput("\t")
    app.handleInput("\t")
    app.handleInput("\t")

    const inputLine = app.render(160).find((line) => line.includes(`${ANSI.reverse} ${ANSI.reset}`))
    expect(inputLine).toBeDefined()
    const cursorIndex = inputLine?.indexOf(ANSI.reverse) ?? -1
    expect(visibleWidth(inputLine?.slice(0, cursorIndex) ?? "")).toBe(5)
  })

  test("移除独立标签行并随切换高亮当前工作区边框", () => {
    const app = new MarketIntelligenceApp(undefined, undefined, () => 30)

    const marketFrame = app.render(160)
    const marketTitles = marketFrame.find((line) => line.includes("行情 / 沪深A股 实时")) ?? ""
    expect(marketTitles).toContain("◆ 行情 / 沪深A股 实时")
    expect(marketTitles).not.toContain("◆ 实时新闻 / 财经")

    app.handleInput("\t")
    const portfolioFrame = app.render(160)
    const portfolioTitles = portfolioFrame.find((line) => line.includes("持仓 / 模拟账户")) ?? ""
    expect(portfolioTitles).toContain("◆ 持仓 / 模拟账户")
    expect(portfolioTitles).not.toContain("◆ 行情 / 沪深A股 实时")

    app.handleInput("\t")
    const newsFrame = app.render(160)
    const newsTitles = newsFrame.find((line) => line.includes("实时新闻 / 财经")) ?? ""
    expect(newsTitles).toContain("◆ 实时新闻 / 财经")
    expect(newsTitles).not.toContain("◆ 持仓 / 模拟账户")

    app.handleInput("\t")
    const agentTitle = app.render(160).find((line) => line.includes("Agent / 上下文")) ?? ""
    expect(agentTitle).toContain("◆ Agent / 上下文")

    const narrowTitle = new MarketIntelligenceApp().render(79)[0] ?? ""
    expect(narrowTitle).toContain("◆ 行情 / 沪深A股 实时")
    expect(narrowTitle).not.toContain("实时新闻")
  })

  test("159 列终端只显示当前工作区", () => {
    const frame = new MarketIntelligenceApp().render(159).join("\n")

    expect(frame).toContain("行情 / 沪深A股 实时")
    expect(frame).not.toContain("实时新闻 / 财经")
    expect(frame).not.toContain("持仓 / 模拟账户")
    expect(frame).not.toContain("Agent / 上下文")
  })

  test("在 79 列终端中以单工作区显示且中文文本不溢出", () => {
    const app = new MarketIntelligenceApp()
    app.handleInput("\t")
    app.handleInput("\t")
    const frame = app.render(79)
    expect(frame.join("\n")).toContain("实时新闻")
    expect(frame.join("\n")).not.toContain("贵州茅台 1528.60")
    expectFrameFits(frame, 79)
  })

  test("在新闻与 Agent 之间切换时保留新闻上下文并提交 Agent 问题", () => {
    // Given
    const app = new MarketIntelligenceApp(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => new AgentController(new WorkspaceAgentDriver(), "test/model"),
    )

    // When
    app.handleInput("\t")
    app.handleInput("\t")
    app.handleInput("\t")
    for (const character of "分析午后拉升") app.handleInput(character)
    app.handleInput("\r")
    const agentFrame = app.render(120)
    app.handleInput("\t")
    app.handleInput("\t")
    const marketFrame = app.render(120)

    // Then
    expect(agentFrame.join("\n")).toContain("分析午后拉升")
    expect(agentFrame.join("\n")).toContain("Tool · 财经新闻")
    expect(marketFrame.join("\n")).toContain("600519")
    expectFrameFits(agentFrame, 120)
    expectFrameFits(marketFrame, 120)
  })
})

describe("Tab 导航", () => {
  function activeWorkspace(frame: string): string {
    if (frame.includes("涨跌幅")) return "行情"
    if (frame.includes("持仓 / 模拟账户")) return "持仓"
    if (frame.includes("实时新闻 / 财经")) return "新闻"
    if (frame.includes("交易记录 / 最近成交")) return "交易记录"
    if (frame.includes(">_")) return "Agent"
    return "unknown"
  }
  test("Tab 正序切换行情→持仓→新闻→Agent→交易记录→行情", () => {
    const app = new MarketIntelligenceApp()
    expect(activeWorkspace(app.render(79).join("\n"))).toBe("行情")
    app.handleInput("\t")
    expect(activeWorkspace(app.render(79).join("\n"))).toBe("持仓")
    app.handleInput("\t")
    expect(activeWorkspace(app.render(79).join("\n"))).toBe("新闻")
    app.handleInput("\t")
    expect(activeWorkspace(app.render(79).join("\n"))).toBe("Agent")
    app.handleInput("\t")
    expect(activeWorkspace(app.render(79).join("\n"))).toBe("交易记录")
    app.handleInput("\t")
    expect(activeWorkspace(app.render(79).join("\n"))).toBe("行情")
  })

  test("Shift+Tab 逆序切换行情→交易记录→Agent→新闻→持仓→行情", () => {
    const app = new MarketIntelligenceApp()
    app.handleInput("\x1b[Z")
    expect(activeWorkspace(app.render(79).join("\n"))).toBe("交易记录")
    app.handleInput("\x1b[Z")
    expect(activeWorkspace(app.render(79).join("\n"))).toBe("Agent")
    app.handleInput("\x1b[Z")
    expect(activeWorkspace(app.render(79).join("\n"))).toBe("新闻")
    app.handleInput("\x1b[Z")
    expect(activeWorkspace(app.render(79).join("\n"))).toBe("持仓")
    app.handleInput("\x1b[Z")
    expect(activeWorkspace(app.render(79).join("\n"))).toBe("行情")
  })

  test("宽屏下交易记录面板随 Tab 获得焦点高亮", () => {
    const app = new MarketIntelligenceApp(undefined, undefined, () => 30)
    for (let index = 0; index < 4; index++) app.handleInput("\t")

    const frame = app.render(160)
    const bottom = frame.find((line) => line.includes("交易记录 / 最近成交")) ?? ""
    expect(bottom).toContain("◆ 交易记录 / 最近成交")
    expect(bottom).not.toContain("◆ Agent / 上下文")
  })

  test("Left 和 Right 方向键切换标签页", () => {
    const app = new MarketIntelligenceApp()
    app.handleInput("\x1b[C")
    expect(activeWorkspace(app.render(79).join("\n"))).toBe("持仓")
    app.handleInput("\x1b[D")
    expect(activeWorkspace(app.render(79).join("\n"))).toBe("行情")
  })

  test("方向键在窄屏布局中也有效", () => {
    const app = new MarketIntelligenceApp()
    app.handleInput("\x1b[C")
    app.handleInput("\x1b[C")
    app.handleInput("\x1b[C")
    const frame = app.render(79).join("\n")
    expect(activeWorkspace(frame)).toBe("Agent")
    expectFrameFits(app.render(79), 79)
  })
})

describe("行情图表", () => {
  test("走势图显示在行情工作区中且不超出宽度", () => {
    const app = new MarketIntelligenceApp()
    const frame = app.render(80).join("\n")
    expect(frame).toContain("走势")
    expectFrameFits(app.render(80), 80)
    expectFrameFits(app.render(120), 120)
    expectFrameFits(app.render(160), 160)
  })

  test("走势图在宽屏和窄屏中均可渲染", () => {
    const app = new MarketIntelligenceApp()
    expect(app.render(160).join("\n")).toContain("走势")
    expectFrameFits(app.render(160), 160)
    expectFrameFits(app.render(40), 40)
  })
})

describe("新闻滚动", () => {
  function newsSelectionIndex(frame: string): number {
    const lines = frame.split("\n")
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? ""
      if (line.includes("\x1b[36m\x1b[7m") && /\d\d:\d\d/.test(line)) return i
    }
    return -1
  }
  test("Down 键下移选中新闻条目", async () => {
    const app = new MarketIntelligenceApp(undefined, TEST_NEWS_SOURCE)
    await app.refreshNews()
    app.handleInput("\t") // → NEWS
    app.handleInput("\t") // → NEWS
    app.handleInput("\x1b[B") // Down
    const frame = app.render(80).join("\n")
    // The second headline should be selected (index 1, after header+divider)
    expect(newsSelectionIndex(frame)).toBeGreaterThan(0)
  })

  test("Up 键上移选中并支持边界回绕", async () => {
    const app = new MarketIntelligenceApp(undefined, TEST_NEWS_SOURCE)
    await app.refreshNews()
    app.handleInput("\t")
    app.handleInput("\t")
    app.handleInput("\x1b[B")
    app.handleInput("\x1b[B")
    app.handleInput("\x1b[A")
    const frame = app.render(80).join("\n")
    expect(newsSelectionIndex(frame)).toBeGreaterThan(0)
  })

  test("切换工作区后新闻选中状态保留", async () => {
    const app = new MarketIntelligenceApp(undefined, TEST_NEWS_SOURCE)
    await app.refreshNews()
    app.handleInput("\t")
    app.handleInput("\t")
    app.handleInput("\x1b[B")
    app.handleInput("\x1b[B")
    app.handleInput("\t") // → AGENT
    app.handleInput("\x1b[Z") // ← NEWS
    const frame = app.render(80).join("\n")
    expect(newsSelectionIndex(frame)).toBeGreaterThan(0)
  })
})

describe("退出", () => {
  test("q 键在行情页触发 onQuit", () => {
    const app = new MarketIntelligenceApp()
    let called = false
    app.onQuit = () => {
      called = true
    }
    app.handleInput("q")
    expect(called).toBe(true)
  })

  test("Escape 键在新闻页触发 onQuit", () => {
    const app = new MarketIntelligenceApp()
    let called = false
    app.onQuit = () => {
      called = true
    }
    app.handleInput("\t")
    app.handleInput("\t")
    app.handleInput("\x1b")
    expect(called).toBe(true)
  })

  test("q 键在 Agent 输入模式下不触发退出", () => {
    const app = new MarketIntelligenceApp()
    let called = false
    app.onQuit = () => {
      called = true
    }
    app.handleInput("\t")
    app.handleInput("\t")
    app.handleInput("\t")
    app.handleInput("q")
    expect(called).toBe(false)
  })

  test("Ctrl+C 在行情页触发退出", () => {
    const app = new MarketIntelligenceApp()
    let called = false
    app.onQuit = () => {
      called = true
    }
    app.handleInput("\x03")
    expect(called).toBe(true)
  })

  test("Ctrl+C 在 Agent 输入模式下也触发退出", () => {
    const app = new MarketIntelligenceApp()
    let called = false
    app.onQuit = () => {
      called = true
    }
    app.handleInput("\t")
    app.handleInput("\t")
    app.handleInput("\t")
    app.handleInput("\x03")
    expect(called).toBe(true)
  })
})
