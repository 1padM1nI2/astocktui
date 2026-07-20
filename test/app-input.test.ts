import { expect, test } from "bun:test"
import { AgentScrollState } from "../src/agent-scroll"
import { AppInputHandler } from "../src/app-input"
import { CommandPrompt } from "../src/command-prompt"

function inputFixture(): {
  readonly handler: AppInputHandler
  readonly prompt: CommandPrompt
  readonly marketKeys: string[]
  readonly portfolioKeys: string[]
  readonly tradeKeys: string[]
  tab: number
  setTab(tab: number): void
} {
  const prompt = new CommandPrompt()
  const marketKeys: string[] = []
  const portfolioKeys: string[] = []
  const tradeKeys: string[] = []
  const state = { tab: 0 }
  return {
    prompt,
    marketKeys,
    portfolioKeys,
    tradeKeys,
    get tab() {
      return state.tab
    },
    setTab(tab) {
      state.tab = tab
    },
    handler: new AppInputHandler({
      prompt,
      scroll: new AgentScrollState(() => 24),
      activeTab: () => state.tab,
      setActiveTab: (tab) => {
        state.tab = tab
      },
      executeCommand: () => ({ kind: "output", title: "", lines: [] }),
      promptAgent: () => {},
      refreshMarket: () => {},
      refreshNews: () => {},
      handleNewsInput: () => {},
      handleMarketInput: (data) => {
        marketKeys.push(data)
        return true
      },
      handlePortfolioInput: (data) => {
        portfolioKeys.push(data)
        return true
      },
      handleTradeInput: (data) => {
        tradeKeys.push(data)
        return true
      },
      onQuit: () => {},
      onUpdate: () => {},
    }),
  }
}

test("终端 bracketed paste 被写入 Agent 输入框而不触发提交", () => {
  const fixture = inputFixture()
  fixture.handler.handle("\x1b[200~分析贵州茅台\r\n并说明风险\x1b[201~")

  expect(fixture.tab).toBe(3)
  expect(fixture.prompt.view.input).toBe("分析贵州茅台\n并说明风险")
  expect(fixture.prompt.view.submitted).toBeNull()
})

test("行情与持仓工作区接收滚动翻页按键", () => {
  const fixture = inputFixture()

  fixture.handler.handle("\x1b[B")
  expect(fixture.marketKeys).toEqual(["\x1b[B"])
  expect(fixture.portfolioKeys).toEqual([])

  fixture.setTab(1)
  fixture.handler.handle("\x1b[6~")
  expect(fixture.portfolioKeys).toEqual(["\x1b[6~"])
  expect(fixture.marketKeys).toEqual(["\x1b[B"])

  fixture.setTab(4)
  fixture.handler.handle("\x1b[5~")
  expect(fixture.tradeKeys).toEqual(["\x1b[5~"])
})

test("粘贴的命令保留为可编辑命令而不立即执行", () => {
  const fixture = inputFixture()
  fixture.handler.handle("\x1b[200~/task list\x1b[201~")

  expect(fixture.prompt.view.input).toBe("/task list")
  expect(fixture.prompt.view.isPaletteOpen).toBe(true)
})
