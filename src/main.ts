import { ProcessTerminal, TUI } from "@oh-my-pi/pi-tui"
import { MarketIntelligenceApp } from "./app"
import type { MarketDataSource } from "./market-data"
import type { NewsDataSource } from "./news-data"
import { createPersistentPaperTradingService } from "./paper-account-store"
import { PaperTradingService } from "./trading"
import { WatchlistService } from "./watchlist"
import { createPersistentWatchlistService } from "./watchlist-store"

export function createDemo(
  tui: TUI,
  marketSource?: MarketDataSource,
  newsSource?: NewsDataSource,
  trading: PaperTradingService = new PaperTradingService(),
  watchlist: WatchlistService = new WatchlistService(),
): MarketIntelligenceApp {
  const app = new MarketIntelligenceApp(
    marketSource,
    newsSource,
    () => tui.terminal.rows,
    trading,
    undefined,
    watchlist,
  )
  app.onQuit = () => {
    app.stopAutoRefresh()
    tui.stop()
    tui.terminal.clearScreen()
    process.exit(0)
  }
  app.onUpdate = () => tui.requestComponentRender(app)
  tui.addChild(app)
  tui.setFocus(app)
  tui.addStartListener(() => app.startAutoRefresh())
  return app
}

if (import.meta.main) {
  const terminal = new ProcessTerminal()
  const tui = new TUI(terminal)
  createDemo(
    tui,
    undefined,
    undefined,
    createPersistentPaperTradingService(),
    createPersistentWatchlistService(),
  )
  tui.start()
}
