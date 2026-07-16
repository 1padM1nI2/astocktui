import { expect, test } from "bun:test"
import { stripVTControlCharacters } from "node:util"
import { visibleWidth } from "@oh-my-pi/pi-tui"
import { ANSI } from "../src/colors"
import { TradeHistoryWorkspace } from "../src/components/trade-history"
import { PaperTradingService } from "../src/trading"

const QUOTE = { code: "SH600519", name: "贵州茅台", price: 10 }

function expectLinesFit(lines: readonly string[], width: number): void {
  for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width)
}

test("交易记录窗口显示空状态和操作提示", () => {
  const frame = new TradeHistoryWorkspace(new PaperTradingService())
    .render(42)
    .map(stripVTControlCharacters)
    .join("\n")

  expect(frame).toContain("交易记录 / 最近成交 [0笔]")
  expect(frame).toContain("暂无成交")
  expect(frame).toContain("/buy")
  expect(frame).toContain("/sell")
})

test("交易记录窗口按时间倒序显示买卖和卖出盈亏", () => {
  let now = new Date("2026-07-15T02:00:00.000Z")
  const trading = new PaperTradingService({ now: () => now })
  trading.execute("buy", QUOTE, 100)
  now = new Date("2026-07-16T02:00:00.000Z")
  trading.execute("sell", { ...QUOTE, price: 12 }, 100)

  const rawFrame = new TradeHistoryWorkspace(trading).render(52)
  const frame = rawFrame.map(stripVTControlCharacters).join("\n")

  expect(frame.indexOf("SIM-0002")).toBeLessThan(frame.indexOf("SIM-0001"))
  expect(frame).toContain("卖出 SH600519 100股")
  expect(frame).toContain("买入 SH600519 100股")
  expect(frame).toContain("+¥189.38")
  expect(rawFrame.join("\n")).toContain(`${ANSI.red}+¥189.38${ANSI.reset}`)
})

test("交易记录窗口在不同栏宽下不溢出", () => {
  const trading = new PaperTradingService()
  trading.execute("buy", QUOTE, 100)
  const workspace = new TradeHistoryWorkspace(trading)

  for (const width of [18, 32, 52]) expectLinesFit(workspace.render(width), width)
})
