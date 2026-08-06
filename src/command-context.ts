import type { AgentModelSwitcher, AgentThinkingControl } from "./agent-controller"
import type { AgentEventSink } from "./agent-event-dispatcher"
import type { CommandExecution } from "./commands"
import type { ConditionalOrderService } from "./conditional-order-service"
import type { HotRankSnapshot } from "./eastmoney-hot-rank"
import type { MarketSnapshot } from "./market-data"
import type { MarketOverviewSnapshot } from "./market-overview"
import type { MemoryService } from "./memory-service"
import type { FinancialNewsSnapshot } from "./news-data"
import type { PortfolioSnapshot } from "./portfolio"
import type { ScheduledTaskService } from "./scheduled-task-service"
import type { StockDetail } from "./stock-detail"
import type { StockSearchMatch } from "./stock-search"
import type { PaperTradingService, TradeQuote } from "./trading"
import type { WatchlistChange } from "./watchlist"

export type WorkspaceName = "market" | "portfolio" | "news" | "agent" | "trade"
export type RefreshTarget = "market" | "news" | "all"
export type RefreshDisposition = "started" | "running" | "skipped"

export interface RefreshReport {
  readonly market: RefreshDisposition
  readonly news: RefreshDisposition
}

export type DataState = "idle" | "loading" | "ready" | "error"

export interface DataStatus {
  readonly state: DataState
  readonly source: string | null
}

export interface AppStatus {
  readonly activeWorkspace: WorkspaceName
  readonly market: DataStatus
  readonly news: DataStatus
  readonly agent: "ready" | "completed"
}

export interface CommandContext {
  focus(workspace: WorkspaceName): void
  refresh(target: RefreshTarget): RefreshReport
  refreshAndWait(target: RefreshTarget): Promise<void>
  quit(): void
  clearAgent(): void
  marketOverview(refresh?: boolean): Promise<MarketOverviewSnapshot>
  status(): AppStatus
  marketSnapshot(): MarketSnapshot | null
  newsSnapshot(): FinancialNewsSnapshot | null
  hotRank?(refresh?: boolean): Promise<HotRankSnapshot | null>
  portfolio(): PortfolioSnapshot
  quote(code: string): Promise<TradeQuote | undefined>
  quoteDetail?(code: string): Promise<StockDetail | undefined>
  searchStocks?(query: string): Promise<readonly StockSearchMatch[]>
  trading(): PaperTradingService
  portfolioChanged(): void
  watchlist(): readonly string[]
  changeWatchlist(action: "add" | "remove", code: string): Promise<WatchlistChange>
  systemEvents?(): AgentEventSink
  agentModel?(): AgentModelSwitcher | undefined
  agentThinking?(): AgentThinkingControl | undefined
  conditionalOrders?(): ConditionalOrderService
  scheduledTasks?(): ScheduledTaskService
  memory?(): MemoryService
  invokeSkill?(name: string, args: readonly string[]): CommandExecution
  mcpCommand?(args: readonly string[]): CommandExecution
}
