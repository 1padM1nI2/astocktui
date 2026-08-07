import type { AgentController } from "../agent/agent-controller"
import type { AgentEventDispatcher } from "../agent/agent-event-dispatcher"
import type { AgentExtensionRuntime } from "../agent/agent-extensions"
import type { MemoryService } from "../agent/memory-service"
import { refreshAppData } from "../app/app-refresh"
import { WORKSPACE_NAMES } from "../app/app-render"
import type { AutomationRuntime } from "../app/automation-runtime"
import type { WatchlistCoordinator } from "../app/watchlist-coordinator"
import type { HotRankWorkspace } from "../components/hot-rank"
import type { MarketWorkspace } from "../components/market"
import type { NewsWorkspace } from "../components/news"
import type { PortfolioWorkspace } from "../components/portfolio"
import type { MarketOverviewService } from "../market/market-overview"
import { fetchTencentStockDetails } from "../market/stock-detail"
import { createEastmoneyStockSearcher } from "../market/stock-search"
import type { PaperTradingService } from "../trading/trading"
import type { CommandContext, RefreshReport, RefreshTarget, WorkspaceName } from "./commands"

export interface AppCommandContextDeps {
  readonly focus: (workspace: WorkspaceName) => void
  readonly refresh: (target: RefreshTarget) => RefreshReport
  readonly dispatcher: () => AgentEventDispatcher
  readonly agent: () => AgentController
  readonly automation: () => AutomationRuntime
  readonly memory: MemoryService
  readonly marketOverview: MarketOverviewService
  readonly market: MarketWorkspace
  readonly news: NewsWorkspace
  readonly hotRank: HotRankWorkspace
  readonly trading: PaperTradingService
  readonly watchlist: WatchlistCoordinator
  readonly portfolio: PortfolioWorkspace
  readonly extensions: AgentExtensionRuntime
  readonly activeTab: () => number
  readonly refreshMarket: () => Promise<void>
  readonly refreshNews: () => Promise<void>
  readonly refreshHotRank: () => Promise<void>
  readonly quit: () => void
}

const searchAshareStocks = createEastmoneyStockSearcher()

export function buildCommandContext(deps: AppCommandContextDeps): CommandContext {
  return {
    focus: deps.focus,
    refresh: deps.refresh,
    systemEvents: () => deps.dispatcher(),
    agentModel: () => deps.agent().modelSwitcher,
    agentThinking: () => deps.agent().thinkingControl,
    conditionalOrders: () => deps.automation().conditions,
    scheduledTasks: () => deps.automation().tasks,
    memory: () => deps.memory,
    refreshAndWait: (target) =>
      refreshAppData(
        target,
        deps.refreshMarket,
        () => deps.marketOverview.refresh(),
        deps.refreshNews,
      ),
    quit: deps.quit,
    clearAgent: () => deps.agent().clear(),
    status: () => ({
      activeWorkspace: WORKSPACE_NAMES[deps.activeTab()] ?? "market",
      market: { state: deps.market.status, source: deps.market.source },
      news: { state: deps.news.status, source: deps.news.source },
      agent: deps.agent().view.status === "completed" ? "completed" : "ready",
    }),
    marketOverview: (refresh = false) =>
      refresh ? deps.marketOverview.refresh() : deps.marketOverview.getOverview(),
    marketSnapshot: () => deps.market.snapshot,
    newsSnapshot: () => deps.news.snapshot,
    hotRank: async (refresh = false) => {
      if (refresh || deps.hotRank.status === "idle") await deps.refreshHotRank()
      return deps.hotRank.snapshot
    },
    portfolio: () => deps.trading.snapshot,
    quote: (code) => deps.watchlist.resolveQuote(code),
    quoteDetail: async (code) => (await fetchTencentStockDetails([code])).get(code),
    searchStocks: (query) => searchAshareStocks(query),
    trading: () => deps.trading,
    portfolioChanged: () => {
      deps.portfolio.applySnapshot(deps.trading.snapshot)
      deps.watchlist.syncMarketCodes()
    },
    watchlist: () => deps.watchlist.watchlist,
    changeWatchlist: (action, code) => deps.watchlist.change(action, code),
    invokeSkill: (name, args) =>
      deps.extensions.invokeSkill(name, args, (input) => void deps.agent().prompt(input)),
    mcpCommand: (args) => deps.extensions.mcpCommand(args),
  }
}
