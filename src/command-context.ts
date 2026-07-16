import type { MarketSnapshot } from "./market-data"
import type { MarketOverviewSnapshot } from "./market-overview"
import type { FinancialNewsSnapshot } from "./news-data"
import type { PortfolioSnapshot } from "./portfolio"
import type { PaperTradingService, TradeQuote } from "./trading"
import type { WatchlistChange } from "./watchlist"

export type WorkspaceName = "market" | "portfolio" | "news" | "agent"
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
  portfolio(): PortfolioSnapshot
  quote(code: string): Promise<TradeQuote | undefined>
  trading(): PaperTradingService
  portfolioChanged(): void
  watchlist(): readonly string[]
  changeWatchlist(action: "add" | "remove", code: string): Promise<WatchlistChange>
}
