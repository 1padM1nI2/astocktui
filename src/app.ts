import type { Component } from "@oh-my-pi/pi-tui"
import type { AgentController } from "./agent-controller"
import { AgentEventDispatcher } from "./agent-event-dispatcher"
import { AgentExtensionRuntime } from "./agent-extensions"
import { AgentScrollState } from "./agent-scroll"
import { AppInputHandler } from "./app-input"
import { refreshAppData } from "./app-refresh"
import { MARKET, renderAppFrame, WORKSPACE_INDEX, WORKSPACE_NAMES } from "./app-render"
import { AutoRefreshController, type RefreshScheduler } from "./auto-refresh"
import { AutomationRuntime } from "./automation-runtime"
import { CommandPrompt } from "./command-prompt"
import { type CommandContext, executeCommand, type RefreshReport } from "./commands"
import { MarketWorkspace } from "./components/market"
import { NewsWorkspace } from "./components/news"
import { PortfolioWorkspace } from "./components/portfolio"
import { TradeHistoryWorkspace } from "./components/trade-history"
import { createDefaultMarketDataSource, type MarketDataSource } from "./market-data"
import { type MarketOverviewDataSource, MarketOverviewService } from "./market-overview"
import { PublicMarketOverviewDataSource } from "./market-overview-source"
import { MemoryService } from "./memory-service"
import type { NewsDataSource } from "./news-data"
import { NewsNowDataSource } from "./news-data"
import { createPiAgentController } from "./pi-agent"
import { PaperTradingService } from "./trading"
import { isContinuousAuction } from "./trading-calendar"
import { WatchlistService } from "./watchlist"
import { WatchlistCoordinator } from "./watchlist-coordinator"

type AgentFactory = (context: CommandContext, extensions?: AgentExtensionRuntime) => AgentController

export class MarketIntelligenceApp implements Component {
  onQuit: () => void = () => process.exit(0)
  #activeTab: number = MARKET
  readonly #prompt: CommandPrompt
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
  readonly #extensions: AgentExtensionRuntime
  readonly #input: AppInputHandler
  readonly #dispatcher: AgentEventDispatcher
  readonly #automation: AutomationRuntime
  readonly #memory = new MemoryService({ trades: () => this.#trading.trades })

  constructor(
    marketSource: MarketDataSource = createDefaultMarketDataSource(),
    newsSource: NewsDataSource = new NewsNowDataSource(),
    viewportRows?: () => number,
    trading: PaperTradingService = new PaperTradingService(),
    refreshScheduler?: RefreshScheduler,
    watchlist: WatchlistService = new WatchlistService(),
    agentFactory: AgentFactory = (context, extensions) =>
      createPiAgentController(context, {}, extensions),
    marketOverviewSource: MarketOverviewDataSource = new PublicMarketOverviewDataSource(),
    extensionFactory: () => AgentExtensionRuntime = () => new AgentExtensionRuntime(),
  ) {
    this.#extensions = extensionFactory()
    this.#prompt = new CommandPrompt(() => this.#extensions.getCommands())
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
    this.#agent = agentFactory(this.#commandContext(), this.#extensions)
    this.#dispatcher = new AgentEventDispatcher(this.#agent)
    this.#automation = new AutomationRuntime({
      sink: this.#dispatcher,
      timer: refreshScheduler,
      lotSize: this.#trading.lotSize,
    })
    this.#input = new AppInputHandler({
      prompt: this.#prompt,
      scroll: this.#agentScroll,
      activeTab: () => this.#activeTab,
      setActiveTab: (tab) => {
        this.#activeTab = tab
      },
      executeCommand: (input) =>
        executeCommand(input, this.#commandContext(), this.#extensions.getCommands()),
      promptAgent: (input) => void this.#agent.prompt(input),
      refreshMarket: () => void this.refreshMarket(),
      refreshNews: () => void this.refreshNews(),
      handleNewsInput: (input) => this.#news.handleInput(input),
      handleMarketInput: (input) => this.#market.handleInput(input),
      handlePortfolioInput: (input) => this.#portfolio.handleInput(input),
      handleTradeInput: (input) => this.#tradeHistory.handleInput(input),
      onQuit: () => this.onQuit(),
      onUpdate: () => this.onUpdate(),
    })
    this.#agent.subscribe(() => this.onUpdate())
    this.#extensions.subscribe(() => this.onUpdate())
    void this.#extensions.initialize().then(() => this.onUpdate())
  }

  refreshMarket(): Promise<void> {
    if (this.#marketRefresh !== null) return this.#marketRefresh

    this.#market.beginRefresh()
    this.onUpdate()
    const refresh = this.#marketSource
      .loadSnapshot([
        ...new Set([...this.#watchlist.codes, ...this.#automation.conditions.activeCodes]),
      ])
      .then((snapshot) => {
        this.#market.applySnapshot(snapshot)
        this.#trading.updatePrices(snapshot.quotes)
        this.#portfolio.applySnapshot(this.#trading.snapshot)
        this.#automation.conditions.handleSnapshot(snapshot, isContinuousAuction(new Date()))
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
    this.#automation.tasks.start()
  }
  stopAutoRefresh(): void {
    this.#autoRefresh.stop()
    this.#automation.tasks.stop()
  }
  async dispose(): Promise<void> {
    this.stopAutoRefresh()
    await this.#dispatcher.dispose()
    await this.#extensions.dispose()
  }
  waitForCommand(): Promise<void> {
    return this.#prompt.whenIdle()
  }
  waitForAgent(): Promise<void> {
    return this.#agent.waitForIdle()
  }

  handleInput(data: string): void {
    this.#input.handle(data)
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
      systemEvents: () => this.#dispatcher,
      conditionalOrders: () => this.#automation.conditions,
      scheduledTasks: () => this.#automation.tasks,
      memory: () => this.#memory,
      refreshAndWait: (target) =>
        refreshAppData(
          target,
          () => this.refreshMarket(),
          () => this.#marketOverview.refresh(),
          () => this.refreshNews(),
        ),
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
      invokeSkill: (name, args) =>
        this.#extensions.invokeSkill(name, args, (input) => void this.#agent.prompt(input)),
      mcpCommand: (args) => this.#extensions.mcpCommand(args),
    }
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
      memoryCount: this.#memory.count,
      scheduledTasks: this.#automation.tasks.summary(),
    })
  }
}
