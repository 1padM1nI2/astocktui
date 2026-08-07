import { ProcessTerminal, TUI } from "@oh-my-pi/pi-tui"
import { MarketIntelligenceApp } from "./app/app"
import { acquireInstanceLock } from "./app/instance-lock"
import type { MarketDataSource } from "./market/data"
import type { NewsDataSource } from "./news/data"
import { createPersistentPaperTradingService } from "./trading/paper-account-store"
import { PaperTradingService } from "./trading/trading"
import { WatchlistService } from "./trading/watchlist"
import { createPersistentWatchlistService } from "./trading/watchlist-store"

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
  let quitting = false
  app.onQuit = () => {
    if (quitting) return
    quitting = true
    void app.dispose().finally(() => {
      tui.stop()
      tui.terminal.clearScreen()
      process.exit(0)
    })
  }
  app.onUpdate = () => tui.requestComponentRender(app)
  tui.addChild(app)
  tui.setFocus(app)
  tui.addStartListener(() => app.startAutoRefresh())
  return app
}

if (import.meta.main) {
  const acquired = acquireInstanceLock()
  if (!acquired.ok) {
    console.error(
      `AStockTUI 已在运行（PID ${acquired.pid}）。多实例会互相覆盖持仓与聊天数据，请先关闭已有实例。`,
    )
    process.exit(1)
  }
  process.on("exit", () => acquired.lock.release())
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
