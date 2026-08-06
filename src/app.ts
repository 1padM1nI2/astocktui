import type { Component } from "@oh-my-pi/pi-tui"
import type { AgentController } from "./agent-controller"
import { AgentEventDispatcher } from "./agent-event-dispatcher"
import { AgentExtensionRuntime } from "./agent-extensions"
import { AgentScrollState } from "./agent-scroll"
import { buildCommandContext } from "./app-command-context"
import { AppInputHandler } from "./app-input"
import { MARKET, renderAppFrame, WORKSPACE_INDEX } from "./app-render"
import { AutoRefreshController, type RefreshScheduler } from "./auto-refresh"
import { AutomationRuntime, type AutomationRuntimeOptions } from "./automation-runtime"
import {
  applyStartupCaches,
  createCachedMarketDataSource,
  createCachedNewsDataSource,
} from "./cached-sources"
import { CommandPrompt } from "./command-prompt"
import {
  type CommandContext,
  executeCommand,
  type RefreshReport,
  type RefreshTarget,
} from "./commands"
import { HotRankWorkspace } from "./components/hot-rank"
import { MarketWorkspace } from "./components/market"
import { NewsWorkspace } from "./components/news"
import { PortfolioWorkspace } from "./components/portfolio"
import { TradeHistoryWorkspace } from "./components/trade-history"
import { fetchHotRank, type HotRankFetcher } from "./eastmoney-hot-rank"
import type { MarketDataSource } from "./market-data"
import { type MarketOverviewDataSource, MarketOverviewService } from "./market-overview"
import { PublicMarketOverviewDataSource } from "./market-overview-source"
import { MemoryService } from "./memory-service"
import type { NewsDataSource } from "./news-data"
import { createPiAgentController } from "./pi-agent"
import { runResearchTask } from "./research-agent"
import { createScheduledTaskSink } from "./research-task-runner"
import { PaperTradingService } from "./trading"
import { isContinuousAuction } from "./trading-calendar"
import { WatchlistService } from "./watchlist"
import { WatchlistCoordinator } from "./watchlist-coordinator"

type AgentFactory = (context: CommandContext, extensions?: AgentExtensionRuntime) => AgentController

function defaultAutomation(options: AutomationRuntimeOptions): AutomationRuntime {
  return new AutomationRuntime(options)
}

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
  readonly #hotRank = new HotRankWorkspace()
  readonly #hotRankSource: HotRankFetcher
  #hotRankRefresh: Promise<void> | null = null
  #marketPanel: "quotes" | "hotRank" = "quotes"
  readonly #agentScroll: AgentScrollState
  readonly #extensions: AgentExtensionRuntime
  readonly #input: AppInputHandler
  readonly #dispatcher: AgentEventDispatcher
  readonly #automation: AutomationRuntime
  readonly #memory = new MemoryService({ trades: () => this.#trading.trades })

  constructor(
    marketSource: MarketDataSource = createCachedMarketDataSource(),
    newsSource: NewsDataSource = createCachedNewsDataSource(),
    viewportRows?: () => number,
    trading: PaperTradingService = new PaperTradingService(),
    refreshScheduler?: RefreshScheduler,
    watchlist: WatchlistService = new WatchlistService(),
    agentFactory: AgentFactory = (context, extensions) =>
      createPiAgentController(context, {}, extensions),
    marketOverviewSource: MarketOverviewDataSource = new PublicMarketOverviewDataSource(),
    extensionFactory: () => AgentExtensionRuntime = () => new AgentExtensionRuntime(),
    automation?: AutomationRuntime,
    hotRankSource: HotRankFetcher = fetchHotRank,
  ) {
    this.#extensions = extensionFactory()
    this.#prompt = new CommandPrompt(() => this.#extensions.getCommands())
    this.#marketSource = marketSource
    this.#newsSource = newsSource
    this.#hotRankSource = hotRankSource
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
    this.#automation =
      automation ??
      defaultAutomation({
        sink: createScheduledTaskSink({
          context: this.#commandContext(),
          dispatcher: this.#dispatcher,
          tasks: () => this.#automation.tasks,
          runResearch: runResearchTask,
        }),
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
      refreshMarket: () =>
        this.#marketPanel === "hotRank" ? void this.refreshHotRank() : void this.refreshMarket(),
      refreshNews: () => void this.refreshNews(),
      toggleMarketPanel: () => this.toggleMarketPanel(),
      handleNewsInput: (input) => {
        const handled = this.#news.handleInput(input)
        void this.#news.loadSelectedArticle().then(() => this.onUpdate())
        return handled
      },
      handleMarketInput: (input) =>
        this.#marketPanel === "hotRank"
          ? this.#hotRank.handleInput(input)
          : this.#market.handleInput(input),
      handlePortfolioInput: (input) => this.#portfolio.handleInput(input),
      handleTradeInput: (input) => this.#tradeHistory.handleInput(input),
      onQuit: () => this.onQuit(),
      onUpdate: () => this.onUpdate(),
    })
    this.#agent.subscribe(() => this.onUpdate())
    this.#extensions.subscribe(() => this.onUpdate())
    void this.#extensions.initialize().then(() => this.onUpdate())
    applyStartupCaches(this.#market, this.#news)
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

  /** 行情面板在自选股与人气榜之间切换；首次进入人气榜时懒加载 */
  toggleMarketPanel(): void {
    this.#marketPanel = this.#marketPanel === "hotRank" ? "quotes" : "hotRank"
    if (this.#marketPanel === "hotRank" && this.#hotRank.status === "idle") {
      void this.refreshHotRank()
    }
    this.onUpdate()
  }

  refreshHotRank(): Promise<void> {
    if (this.#hotRankRefresh !== null) return this.#hotRankRefresh

    this.#hotRank.beginRefresh()
    this.onUpdate()
    const refresh = this.#hotRankSource()
      .then((snapshot) => this.#hotRank.applySnapshot(snapshot))
      .catch(() => this.#hotRank.failRefresh())
      .finally(() => {
        this.#hotRankRefresh = null
        this.onUpdate()
      })
    this.#hotRankRefresh = refresh
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
    return buildCommandContext({
      focus: (workspace) => {
        this.#activeTab = WORKSPACE_INDEX[workspace]
      },
      refresh: (target) => this.#refreshReport(target),
      dispatcher: () => this.#dispatcher,
      agent: () => this.#agent,
      automation: () => this.#automation,
      memory: this.#memory,
      marketOverview: this.#marketOverview,
      market: this.#market,
      news: this.#news,
      hotRank: this.#hotRank,
      trading: this.#trading,
      watchlist: this.#watchlist,
      portfolio: this.#portfolio,
      extensions: this.#extensions,
      activeTab: () => this.#activeTab,
      refreshMarket: () => this.refreshMarket(),
      refreshNews: () => this.refreshNews(),
      refreshHotRank: () => this.refreshHotRank(),
      quit: () => this.onQuit(),
    })
  }

  #refreshReport(target: RefreshTarget): RefreshReport {
    const refreshMarket = target === "market" || target === "all"
    const refreshNews = target === "news" || target === "all"
    const market =
      refreshMarket && this.#marketRefresh !== null
        ? "running"
        : refreshMarket
          ? "started"
          : "skipped"
    const news =
      refreshNews && this.#newsRefresh !== null ? "running" : refreshNews ? "started" : "skipped"
    if (refreshMarket) void this.refreshMarket()
    if (refreshNews) void this.refreshNews()
    return { market, news }
  }

  render(width: number): readonly string[] {
    this.#agentScroll.recordRender(width)
    return renderAppFrame(width, {
      activeTab: this.#activeTab,
      viewportRows: this.#agentScroll.viewportRows,
      market: this.#marketPanel === "hotRank" ? this.#hotRank : this.#market,
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
