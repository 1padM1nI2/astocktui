import { expect, spyOn, test } from "bun:test"
import type { Terminal, TerminalAppearance } from "@oh-my-pi/pi-tui"
import { TUI } from "@oh-my-pi/pi-tui"
import { createDemo } from "../src/main"
import type { MarketDataSource, MarketSnapshot } from "../src/market-data"
import type { FinancialNewsSnapshot, NewsDataSource } from "../src/news-data"
import { PaperTradingService } from "../src/trading"
import { WatchlistService } from "../src/watchlist"

class MemoryTerminal implements Terminal {
  readonly columns = 120
  readonly rows = 30
  readonly kittyProtocolActive = false
  readonly kittyEnableSequence = null
  readonly output: string[] = []
  readonly lifecycle: string[] = []

  start(onInput: (data: string) => void, _onResize: () => void): void {
    this.#onInput = onInput
  }

  stop(): void {
    this.lifecycle.push("stop")
  }

  async drainInput(): Promise<void> {}

  write(data: string): void {
    this.output.push(data)
  }

  moveBy(_lines: number): void {}

  hideCursor(): void {}

  showCursor(): void {}

  clearLine(): void {}

  clearFromCursor(): void {}

  clearScreen(): void {
    this.lifecycle.push("clear")
  }

  setTitle(_title: string): void {}

  setProgress(_active: boolean): void {}

  onAppearanceChange(_callback: (appearance: TerminalAppearance) => void): void {}

  get appearance(): TerminalAppearance | undefined {
    return undefined
  }

  send(data: string): void {
    this.#onInput?.(data)
  }

  #onInput: ((data: string) => void) | undefined
}

test("createDemo 挂载工作台、设置焦点并在启动时刷新行情和新闻", () => {
  const terminal = new MemoryTerminal()
  const tui = new TUI(terminal)
  let refreshes = 0
  let newsRefreshes = 0
  const source: MarketDataSource = {
    async loadSnapshot(): Promise<MarketSnapshot> {
      refreshes++
      return {
        quotes: [
          {
            code: "SH600519",
            name: "贵州茅台",
            price: 1488.88,
            changePercent: 1.21,
            source: "tencent",
          },
        ],
        trend: [1470, 1488.88],
        source: "tencent",
      }
    },
  }
  const newsSource: NewsDataSource = {
    async loadNews(): Promise<FinancialNewsSnapshot> {
      newsRefreshes++
      return {
        source: "NewsNow 1源",
        items: [
          {
            id: "cls-telegraph:1",
            title: "央行开展逆回购操作",
            publishedAt: Date.UTC(2026, 6, 14, 1, 30),
            source: "财联社",
          },
        ],
      }
    },
  }

  const app = createDemo(tui, source, newsSource)
  tui.start()

  expect(tui.children).toContain(app)
  expect(tui.getFocused()).toBe(app)
  expect(refreshes).toBe(1)
  expect(newsRefreshes).toBe(1)

  terminal.send("\t")
  terminal.send("\t")
  expect(app.render(80).join("\n")).toContain("实时新闻 / 财经")
  tui.stop()
  app.stopAutoRefresh()
})

test("退出时先停止 TUI、清空画面，再结束进程", () => {
  const terminal = new MemoryTerminal()
  const tui = new TUI(terminal)
  const pendingSnapshot = Promise.withResolvers<MarketSnapshot>().promise
  const pendingNews = Promise.withResolvers<FinancialNewsSnapshot>().promise
  const exit = spyOn(process, "exit").mockImplementation((() => undefined) as typeof process.exit)

  try {
    createDemo(
      tui,
      {
        loadSnapshot(): Promise<MarketSnapshot> {
          return pendingSnapshot
        },
      },
      {
        loadNews(): Promise<FinancialNewsSnapshot> {
          return pendingNews
        },
      },
    )
    tui.start()
    terminal.send("q")

    expect(terminal.lifecycle).toEqual(["stop", "clear"])
    expect(exit).toHaveBeenCalledWith(0)
  } finally {
    exit.mockRestore()
  }
})

test("createDemo 使用恢复的模拟账户", () => {
  const terminal = new MemoryTerminal()
  const tui = new TUI(terminal)
  const trading = new PaperTradingService()
  trading.execute("buy", { code: "SZ000938", name: "紫光股份", price: 20 }, 100)

  const app = createDemo(tui, undefined, undefined, trading)
  app.handleInput("\t")

  expect(app.render(80).join("\n")).toContain("SZ000938")
  expect(app.render(80).join("\n")).toContain("紫光股份")
})

test("createDemo 使用恢复的行情自选股", () => {
  const terminal = new MemoryTerminal()
  const tui = new TUI(terminal)
  const watchlist = new WatchlistService({ codes: ["SZ000938"] })

  const app = createDemo(tui, undefined, undefined, undefined, watchlist)
  const frame = app.render(80).join("\n")

  expect(frame).toContain("000938")
  expect(frame).not.toContain("600519")
})
