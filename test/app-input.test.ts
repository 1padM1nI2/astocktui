import { expect, test } from "bun:test"
import { AgentScrollState } from "../src/agent-scroll"
import { AppInputHandler } from "../src/app-input"
import { CommandPrompt } from "../src/command-prompt"

function inputFixture(): {
  readonly handler: AppInputHandler
  readonly prompt: CommandPrompt
  readonly marketKeys: string[]
  readonly newsKeys: string[]
  readonly portfolioKeys: string[]
  readonly tradeKeys: string[]
  readonly executed: string[]
  quits: number
  toggles: number
  marketConsume: boolean
  newsConsume: boolean
  tab: number
  setTab(tab: number): void
} {
  const prompt = new CommandPrompt()
  const marketKeys: string[] = []
  const newsKeys: string[] = []
  const portfolioKeys: string[] = []
  const tradeKeys: string[] = []
  const executed: string[] = []
  const state = { tab: 0, quits: 0, toggles: 0, marketConsume: true, newsConsume: true }
  return {
    prompt,
    marketKeys,
    newsKeys,
    portfolioKeys,
    tradeKeys,
    executed,
    get quits() {
      return state.quits
    },
    set quits(value: number) {
      state.quits = value
    },
    get toggles() {
      return state.toggles
    },
    set toggles(value: number) {
      state.toggles = value
    },
    get marketConsume() {
      return state.marketConsume
    },
    set marketConsume(value: boolean) {
      state.marketConsume = value
    },
    get newsConsume() {
      return state.newsConsume
    },
    set newsConsume(value: boolean) {
      state.newsConsume = value
    },
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
      executeCommand: (input) => {
        executed.push(input)
        return { kind: "output", title: "", lines: [] }
      },
      promptAgent: () => {},
      refreshMarket: () => {},
      refreshNews: () => {},
      toggleMarketPanel: () => {
        state.toggles++
      },
      handleNewsInput: (data) => {
        newsKeys.push(data)
        return state.newsConsume
      },
      handleMarketInput: (data) => {
        marketKeys.push(data)
        return state.marketConsume
      },
      handlePortfolioInput: (data) => {
        portfolioKeys.push(data)
        return true
      },
      handleTradeInput: (data) => {
        tradeKeys.push(data)
        return true
      },
      onQuit: () => {
        state.quits++
      },
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

test("行情页按 h 切换人气榜面板，其他标签页不触发", () => {
  const fixture = inputFixture()

  fixture.handler.handle("h")
  expect(fixture.toggles).toBe(1)
  expect(fixture.marketKeys).toEqual([])

  fixture.handler.handle("H")
  expect(fixture.toggles).toBe(2)
  expect(fixture.marketKeys).toEqual([])

  fixture.setTab(2)
  fixture.handler.handle("h")
  expect(fixture.toggles).toBe(2)
})

test("粘贴的命令保留为可编辑命令而不立即执行", () => {
  const fixture = inputFixture()
  fixture.handler.handle("\x1b[200~/task list\x1b[201~")

  expect(fixture.prompt.view.input).toBe("/task list")
  expect(fixture.prompt.view.isPaletteOpen).toBe(true)
})

test("行情页 Esc 先交由工作区退出详情，未消费才退出应用", () => {
  const fixture = inputFixture()

  fixture.handler.handle("\x1b")
  expect(fixture.marketKeys).toEqual(["\x1b"])
  expect(fixture.quits).toEqual(0)

  fixture.marketConsume = false
  fixture.handler.handle("\x1b")
  expect(fixture.quits).toEqual(1)
})

test("新闻页 Esc 先交由工作区退出详情，未消费才退出应用", () => {
  const fixture = inputFixture()
  fixture.setTab(2)

  fixture.handler.handle("\x1b")
  expect(fixture.newsKeys).toEqual(["\x1b"])
  expect(fixture.quits).toEqual(0)

  fixture.newsConsume = false
  fixture.handler.handle("\x1b")
  expect(fixture.quits).toEqual(1)
})
