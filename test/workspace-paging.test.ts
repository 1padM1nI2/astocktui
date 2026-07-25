import { describe, expect, test } from "bun:test"
import { stripVTControlCharacters } from "node:util"
import { MarketWorkspace } from "../src/components/market"
import { NewsWorkspace } from "../src/components/news"
import { PortfolioWorkspace } from "../src/components/portfolio"
import { TradeHistoryWorkspace } from "../src/components/trade-history"
import type { FinancialNewsSnapshot } from "../src/news-data"
import type { PortfolioPosition } from "../src/portfolio"
import { PaperTradingService } from "../src/trading"
import { renderWorkspacePanel } from "../src/workspace-layout"

function frameText(lines: readonly string[]): string {
  return stripVTControlCharacters(lines.join("\n"))
}

function press(
  component: { handleInput(data: string): unknown },
  data: string,
  times: number,
): void {
  for (let index = 0; index < times; index++) component.handleInput(data)
}

describe("行情工作区翻页", () => {
  const codes = Array.from({ length: 20 }, (_, index) => `SH6000${String(index).padStart(2, "0")}`)

  test("自选股超出面板高度时可用上下键滚动浏览", () => {
    const market = new MarketWorkspace(codes)

    const top = frameText(renderWorkspacePanel(market, 40, 8, true))
    expect(top).toContain("600000")
    expect(top).not.toContain("600005")

    press(market, "\x1b[B", 4)
    const scrolled = frameText(renderWorkspacePanel(market, 40, 8, true))
    expect(scrolled).not.toContain("600000")
    expect(scrolled).toContain("600005")

    press(market, "\x1b[A", 4)
    const restored = frameText(renderWorkspacePanel(market, 40, 8, true))
    expect(restored).toContain("600000")
  })

  test("PageDown 与 PageUp 按面板高度翻页", () => {
    const market = new MarketWorkspace(codes)

    renderWorkspacePanel(market, 40, 8, true)
    market.handleInput("\x1b[6~")
    const paged = frameText(renderWorkspacePanel(market, 40, 8, true))
    expect(paged).not.toContain("600000")
    expect(paged).toContain("600009")

    market.handleInput("\x1b[5~")
    const back = frameText(renderWorkspacePanel(market, 40, 8, true))
    expect(back).toContain("600000")
  })
})

describe("持仓工作区翻页", () => {
  function positions(count: number): readonly PortfolioPosition[] {
    return Array.from({ length: count }, (_, index) => ({
      code: `SH6000${String(index).padStart(2, "0")}`,
      name: `股票${index}`,
      quantity: 100,
      sellableQuantity: 100,
      averageCost: 10,
      currentPrice: 11,
    }))
  }

  test("持仓明细超出面板高度时可翻页查看", () => {
    const portfolio = new PortfolioWorkspace({
      initialCapital: 100_000,
      cash: 50_000,
      positions: positions(12),
    })

    const top = frameText(renderWorkspacePanel(portfolio, 40, 8, true))
    expect(top).toContain("总资产")
    expect(top).not.toContain("600000")

    portfolio.handleInput("\x1b[6~")
    const paged = frameText(renderWorkspacePanel(portfolio, 40, 8, true))
    expect(paged).toContain("600000")

    portfolio.handleInput("\x1b[6~")
    const deeper = frameText(renderWorkspacePanel(portfolio, 40, 8, true))
    expect(deeper).not.toContain("600000")
    expect(deeper).toContain("600005")

    portfolio.handleInput("\x1b[H")
    const home = frameText(renderWorkspacePanel(portfolio, 40, 8, true))
    expect(home).toContain("总资产")
  })
})

describe("交易记录工作区翻页", () => {
  test("成交记录超出面板高度时可翻页浏览较早记录", () => {
    const trading = new PaperTradingService()
    for (let index = 0; index < 12; index++) {
      trading.execute("buy", { code: "SH600519", name: "贵州茅台", price: 10 }, 100)
    }
    const history = new TradeHistoryWorkspace(trading)

    const top = frameText(renderWorkspacePanel(history, 40, 8, true))
    expect(top).toContain("SIM-0012")
    expect(top).not.toContain("SIM-0001")

    history.handleInput("\x1b[6~")
    const paged = frameText(renderWorkspacePanel(history, 40, 8, true))
    expect(paged).not.toContain("SIM-0012")
    expect(paged).toContain("SIM-0008")

    history.handleInput("\x1b[F")
    const oldest = frameText(renderWorkspacePanel(history, 40, 8, true))
    expect(oldest).toContain("SIM-0001")
  })
})

describe("新闻工作区翻页", () => {
  function snapshot(count: number): FinancialNewsSnapshot {
    return {
      source: "测试源",
      items: Array.from({ length: count }, (_, index) => ({
        id: `n${index}`,
        title: `新闻标题${String(index).padStart(2, "0")}`,
        publishedAt: Date.UTC(2026, 6, 14, 1, 30),
        source: "财联社",
      })),
    }
  }

  test("选中项下移时视图跟随滚动且保持高亮可见", () => {
    const news = new NewsWorkspace()
    news.applySnapshot(snapshot(30))

    const top = frameText(renderWorkspacePanel(news, 50, 8, true))
    expect(top).toContain("新闻标题00")
    expect(top).not.toContain("新闻标题10")

    press(news, " ", 1) // 空格进入选中模式
    press(news, "\x1b[B", 14)
    const frame = renderWorkspacePanel(news, 50, 8, true)
    const text = frameText(frame)
    expect(text).toContain("新闻标题14")
    expect(text).not.toContain("新闻标题08")
    expect(text).not.toContain("新闻标题19")
    const selectedLine = frame.find((line) => line.includes("新闻标题14"))
    expect(selectedLine).toContain("\x1b[36m\x1b[7m")
  })

  test("PageDown 按步长移动选中项", () => {
    const news = new NewsWorkspace()
    news.applySnapshot(snapshot(30))
    renderWorkspacePanel(news, 50, 8, true)

    press(news, " ", 1)
    press(news, "\x1b[B", 2)
    news.handleInput("\x1b[6~")
    const text = frameText(renderWorkspacePanel(news, 50, 8, true))
    expect(text).toContain("新闻标题07")
    expect(text).not.toContain("新闻标题01")
  })
})
