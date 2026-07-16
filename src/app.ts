import type { Component } from "@oh-my-pi/pi-tui"
import type { AgentController } from "./agent-controller"
import { AgentScrollState } from "./agent-scroll"
import {
  AGENT,
  MARKET,
  NEWS,
  renderAppFrame,
  TAB_COUNT,
  WORKSPACE_INDEX,
  WORKSPACE_NAMES,
} from "./app-render"
import { AutoRefreshController, type RefreshScheduler } from "./auto-refresh"
import { CommandPrompt } from "./command-prompt"
import {
  type CommandContext,
  type CommandExecution,
  executeCommand,
  type RefreshReport,
} from "./commands"
import { MarketWorkspace } from "./components/market"
import { NewsWorkspace } from "./components/news"
import { PortfolioWorkspace } from "./components/portfolio"
import { TradeHistoryWorkspace } from "./components/trade-history"
import { type MarketDataSource, StockApiMarketDataSource } from "./market-data"
import { type MarketOverviewDataSource, MarketOverviewService } from "./market-overview"
import { PublicMarketOverviewDataSource } from "./market-overview-source"
import type { NewsDataSource } from "./news-data"
import { NewsNowDataSource } from "./news-data"
import { createPiAgentController } from "./pi-agent"
import { PaperTradingService } from "./trading"
import { WatchlistService } from "./watchlist"
import { WatchlistCoordinator } from "./watchlist-coordinator"

export class MarketIntelligenceApp implements Component {
  onQuit: () => void = () => process.exit(0)
  #activeTab: number = MARKET
  readonly #prompt = new CommandPrompt()
  readonly #market: MarketWorkspace
  readonly #news = new NewsWorkspace()
  readonly #portfolio: PortfolioWorkspace
  readonly #tradeHistory: TradeHistoryWorkspace
  readonly #trading: PaperTradingService
  readonly #agent: AgentController
  readonly #watchlist: WatchlistCoordinator
  readonly #marketOverview: MarketOverviewService
  readonly #autoRefresh: AutoRefreshController
  onUpdate: () => void = () => {}
  readonly #marketSource: MarketDataSource
  #marketRefresh: Promise<void> | null = null
  readonly #newsSource: NewsDataSource
  #newsRefresh: Promise<void> | null = null
  readonly #agentScroll: AgentScrollState

  constructor(
    marketSource: MarketDataSource = new StockApiMarketDataSource(),
    newsSource: NewsDataSource = new NewsNowDataSource(),
    viewportRows?: () => number,
    trading: PaperTradingService = new PaperTradingService(),
    refreshScheduler?: RefreshScheduler,
    watchlist: WatchlistService = new WatchlistService(),
    agentFactory: (context: CommandContext) => AgentController = createPiAgentController,
    marketOverviewSource: MarketOverviewDataSource = new PublicMarketOverviewDataSource(),
  ) {
    this.#marketSource = marketSource
    this.#newsSource = newsSource
    this.#trading = trading
    this.#market = new MarketWorkspace(watchlist.codes)
    this.#watchlist = new WatchlistCoordinator(
      watchlist,
      this.#market,
      trading,
      () => this.refreshMarket(),
      () => this.#marketRefresh !== null,
    )
    this.#portfolio = new PortfolioWorkspace(trading.snapshot)
    this.#tradeHistory = new TradeHistoryWorkspace(trading)
    this.#autoRefresh = new AutoRefreshController({
      refreshMarket: () => this.refreshMarket(),
      refreshNews: () => this.refreshNews(),
      scheduler: refreshScheduler,
    })
    this.#agentScroll = new AgentScrollState(viewportRows)
    this.#marketOverview = new MarketOverviewService(marketOverviewSource)
    this.#agent = agentFactory(this.#commandContext())
    this.#agent.subscribe(() => this.onUpdate())
  }

  refreshMarket(): Promise<void> {
    if (this.#marketRefresh !== null) return this.#marketRefresh

    this.#market.beginRefresh()
    this.onUpdate()
    const refresh = this.#marketSource
      .loadSnapshot(this.#watchlist.codes)
      .then((snapshot) => {
        this.#market.applySnapshot(snapshot)
        this.#trading.updatePrices(snapshot.quotes)
        this.#portfolio.applySnapshot(this.#trading.snapshot)
      })
      .catch(() => this.#market.failRefresh())
      .finally(() => {
        this.#marketRefresh = null
        this.onUpdate()
      })
    this.#marketRefresh = refresh
    return refresh
  }

  refreshNews(): Promise<void> {
    if (this.#newsRefresh !== null) return this.#newsRefresh

    this.#news.beginRefresh()
    this.onUpdate()
    const refresh = this.#newsSource
      .loadNews()
      .then((snapshot) => this.#news.applySnapshot(snapshot))
      .catch(() => this.#news.failRefresh())
      .finally(() => {
        this.#newsRefresh = null
        this.onUpdate()
      })
    this.#newsRefresh = refresh
    return refresh
  }

  startAutoRefresh(): void {
    this.#autoRefresh.start()
  }

  stopAutoRefresh(): void {
    this.#autoRefresh.stop()
  }

  waitForCommand(): Promise<void> {
    return this.#prompt.whenIdle()
  }

  waitForAgent(): Promise<void> {
    return this.#agent.waitForIdle()
  }

  handleInput(data: string): void {
    if (data === "\x03") {
      this.onQuit()
      return
    }
    if (data === "/") {
      this.#activeTab = AGENT
      this.#prompt.openPalette()
      return
    }

    if (this.#activeTab !== AGENT && (data === "q" || data === "\x1b")) {
      this.onQuit()
      return
    }

    const handlePrompt = (): boolean =>
      this.#prompt.handleInput(
        data,
        (input) => this.#executeCommand(input),
        this.onUpdate,
        (input) => void this.#agent.prompt(input),
      )
    if (this.#activeTab === AGENT && this.#prompt.isPaletteOpen) {
      handlePrompt()
      if (!this.#prompt.isPaletteOpen) this.#agentScroll.reset()
      return
    }
    if (this.#activeTab === AGENT && this.#agentScroll.handleInput(data)) return

    if (this.#activeTab === MARKET && (data === "r" || data === "R")) {
      void this.refreshMarket()
      return
    }
    if (this.#activeTab === NEWS && (data === "r" || data === "R")) {
      void this.refreshNews()
      return
    }
    if (data === "\t" || data === "\x1b[C") {
      this.#activeTab = (this.#activeTab + 1) % TAB_COUNT
      return
    }
    if (data === "\x1b[Z" || data === "\x1b[D") {
      this.#activeTab = (this.#activeTab - 1 + TAB_COUNT) % TAB_COUNT
      return
    }
    if (this.#activeTab === NEWS) {
      this.#news.handleInput(data)
      return
    }
    if (this.#activeTab === AGENT) {
      const handled = handlePrompt()
      if (handled && (data === "\r" || data === "\n")) this.#agentScroll.reset()
    }
  }

  #executeCommand(input: string): CommandExecution {
    return executeCommand(input, this.#commandContext())
  }

  #commandContext(): CommandContext {
    return {
      focus: (workspace) => {
        this.#activeTab = WORKSPACE_INDEX[workspace]
      },
      refresh: (target): RefreshReport => {
        const refreshMarket = target === "market" || target === "all"
        const refreshNews = target === "news" || target === "all"
        const market = refreshMarket
          ? this.#marketRefresh === null
            ? "started"
            : "running"
          : "skipped"
        const news = refreshNews ? (this.#newsRefresh === null ? "started" : "running") : "skipped"
        if (refreshMarket) void this.refreshMarket()
        if (refreshNews) void this.refreshNews()
        return { market, news }
      },
      refreshAndWait: (target) => this.#refreshAndWait(target),
      quit: () => this.onQuit(),
      clearAgent: () => this.#agent.clear(),
      status: () => ({
        activeWorkspace: WORKSPACE_NAMES[this.#activeTab] ?? "market",
        market: { state: this.#market.status, source: this.#market.source },
        news: { state: this.#news.status, source: this.#news.source },
        agent: this.#agent.view.status === "completed" ? "completed" : "ready",
      }),
      marketOverview: (refresh = false) =>
        refresh ? this.#marketOverview.refresh() : this.#marketOverview.getOverview(),
      marketSnapshot: () => this.#market.snapshot,
      newsSnapshot: () => this.#news.snapshot,
      portfolio: () => this.#trading.snapshot,
      quote: (code) => this.#watchlist.resolveQuote(code),
      trading: () => this.#trading,
      portfolioChanged: () => {
        this.#portfolio.applySnapshot(this.#trading.snapshot)
        this.#watchlist.syncMarketCodes()
      },
      watchlist: () => this.#watchlist.watchlist,
      changeWatchlist: (action, code) => this.#watchlist.change(action, code),
    }
  }

  async #refreshAndWait(target: "market" | "news" | "all"): Promise<void> {
    await Promise.all([
      target !== "news" ? this.refreshMarket() : undefined,
      target !== "news" ? this.#marketOverview.refresh() : undefined,
      target !== "market" ? this.refreshNews() : undefined,
    ])
  }

  render(width: number): readonly string[] {
    this.#agentScroll.recordRender(width)
    return renderAppFrame(width, {
      activeTab: this.#activeTab,
      viewportRows: this.#agentScroll.viewportRows,
      market: this.#market,
      portfolio: this.#portfolio,
      news: this.#news,
      prompt: this.#prompt.view,
      agent: this.#agent.view,
      agentScrollOffset: this.#agentScroll.offset,
      tradeHistory: this.#tradeHistory,
    })
  }
}
