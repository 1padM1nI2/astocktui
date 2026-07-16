import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createPersistentPaperTradingService, PaperAccountStore } from "../src/paper-account-store"
import type { TradeQuote } from "../src/trading"

const QUOTE: TradeQuote = {
  code: "SZ000938",
  name: "紫光股份",
  price: 20,
}

function temporaryAccountPath(): { readonly directory: string; readonly path: string } {
  const directory = mkdtempSync(join(tmpdir(), "astocktui-account-"))
  return { directory, path: join(directory, "paper-account.json") }
}

describe("模拟账户持久化", () => {
  test("买入后重启恢复现金、持仓、T+1批次和成交记录", () => {
    const temporary = temporaryAccountPath()
    let now = new Date("2026-07-15T02:00:00.000Z")
    try {
      const first = createPersistentPaperTradingService({ path: temporary.path, now: () => now })
      expect(first.execute("buy", QUOTE, 100).ok).toBe(true)

      const second = createPersistentPaperTradingService({ path: temporary.path, now: () => now })
      expect(second.snapshot.cash).toBe(97_994.98)
      expect(second.snapshot.positions[0]).toMatchObject({
        code: "SZ000938",
        quantity: 100,
        sellableQuantity: 0,
      })
      expect(second.trades[0]?.id).toBe("SIM-0001")
      expect(second.execute("sell", QUOTE, "all").message).toContain("T+1")

      now = new Date("2026-07-16T02:00:00.000Z")
      expect(second.execute("sell", { ...QUOTE, price: 22 }, "all").ok).toBe(true)
      const third = createPersistentPaperTradingService({ path: temporary.path, now: () => now })
      expect(third.snapshot.positions).toEqual([])
      expect(third.snapshot.cash).toBe(100_188.86)
      expect(third.trades.map((trade) => trade.id)).toEqual(["SIM-0001", "SIM-0002"])
      expect(JSON.parse(readFileSync(temporary.path, "utf8")).version).toBe(1)
    } finally {
      rmSync(temporary.directory, { recursive: true, force: true })
    }
  })

  test("行情盯市和账户重置都会持久化", () => {
    const temporary = temporaryAccountPath()
    try {
      const first = createPersistentPaperTradingService({ path: temporary.path })
      first.execute("buy", QUOTE, 100)
      first.updatePrices([{ ...QUOTE, price: 25 }])

      const marked = createPersistentPaperTradingService({ path: temporary.path })
      expect(marked.snapshot.positions[0]?.currentPrice).toBe(25)
      marked.reset()

      const reset = createPersistentPaperTradingService({ path: temporary.path })
      expect(reset.snapshot.cash).toBe(100_000)
      expect(reset.snapshot.positions).toEqual([])
      expect(reset.trades).toEqual([])
    } finally {
      rmSync(temporary.directory, { recursive: true, force: true })
    }
  })

  test("损坏的账户文件明确报错而不是静默清空资产", () => {
    const temporary = temporaryAccountPath()
    try {
      writeFileSync(temporary.path, "{not-json", "utf8")
      const store = new PaperAccountStore(temporary.path)

      expect(() => store.load()).toThrow("模拟账户文件损坏")
    } finally {
      rmSync(temporary.directory, { recursive: true, force: true })
    }
  })
})
