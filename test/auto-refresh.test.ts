import { describe, expect, test } from "bun:test"
import {
  AutoRefreshController,
  MARKET_REFRESH_INTERVAL_MS,
  NEWS_REFRESH_INTERVAL_MS,
  type RefreshScheduler,
} from "../src/app/auto-refresh"

describe("自动定时刷新", () => {
  test("启动时立即刷新并按独立周期刷新行情和新闻", () => {
    const callbacks = new Map<number, () => void>()
    const cleared: unknown[] = []
    const scheduler: RefreshScheduler = {
      setInterval(callback, intervalMs): unknown {
        callbacks.set(intervalMs, callback)
        return intervalMs
      },
      clearInterval(handle): void {
        cleared.push(handle)
      },
    }
    let marketRefreshes = 0
    let newsRefreshes = 0
    const controller = new AutoRefreshController({
      refreshMarket: () => {
        marketRefreshes++
      },
      refreshNews: () => {
        newsRefreshes++
      },
      scheduler,
    })

    controller.start()
    controller.start()
    expect(marketRefreshes).toBe(1)
    expect(newsRefreshes).toBe(1)
    expect(callbacks.has(MARKET_REFRESH_INTERVAL_MS)).toBe(true)
    expect(callbacks.has(NEWS_REFRESH_INTERVAL_MS)).toBe(true)

    callbacks.get(MARKET_REFRESH_INTERVAL_MS)?.()
    callbacks.get(NEWS_REFRESH_INTERVAL_MS)?.()
    expect(marketRefreshes).toBe(2)
    expect(newsRefreshes).toBe(2)

    controller.stop()
    expect(cleared).toEqual([MARKET_REFRESH_INTERVAL_MS, NEWS_REFRESH_INTERVAL_MS])
    expect(controller.running).toBe(false)
  })
})
