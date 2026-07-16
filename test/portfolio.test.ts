import { expect, test } from "bun:test"
import { stripVTControlCharacters } from "node:util"
import { visibleWidth } from "@oh-my-pi/pi-tui"
import { PortfolioWorkspace } from "../src/components/portfolio"
import type { PortfolioSnapshot } from "../src/portfolio"

function expectFrameFits(lines: readonly string[], width: number): void {
  for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width)
}

test("模拟持仓计算总资产、持仓市值和浮动盈亏", () => {
  const snapshot: PortfolioSnapshot = {
    initialCapital: 120_000,
    cash: 0,
    positions: [
      {
        code: "600519",
        name: "贵州茅台",
        quantity: 100,
        sellableQuantity: 100,
        averageCost: 1_200,
        currentPrice: 1_210,
      },
    ],
  }
  const portfolio = new PortfolioWorkspace(snapshot)

  const rawFrame = portfolio.render(40)
  const frame = rawFrame.map(stripVTControlCharacters).join("\n")

  expect(frame).toContain("持仓 / 模拟账户")
  expect(frame).toContain("总资产")
  expect(frame).toContain("¥121,000.00")
  expect(frame).toContain("持仓市值")
  expect(frame).toContain("浮动盈亏")
  expect(frame).toContain("+¥1,000.00")
  expect(frame).toContain("累计收益")
  expect(frame).toContain("+0.83%")
  expect(frame).toContain("600519 贵州茅台 100股")
  expect(frame).toContain("可卖100股")
  expect(rawFrame.join("\n")).toContain("\x1b[31m+¥1,000.00")
  expectFrameFits(rawFrame, 40)
})

test("空模拟账户明确显示可用资金和等待交易状态", () => {
  const frame = new PortfolioWorkspace().render(36).map(stripVTControlCharacters).join("\n")

  expect(frame).toContain("¥100,000.00")
  expect(frame).toContain("暂无持仓")
  expect(frame).toContain("等待 Agent 发出模拟交易指令")
})

test("亏损持仓遵循 A 股绿色下跌约定", () => {
  const portfolio = new PortfolioWorkspace({
    initialCapital: 100_000,
    cash: 50_000,
    positions: [
      {
        code: "000001",
        name: "平安银行",
        quantity: 1_000,
        sellableQuantity: 1_000,
        averageCost: 50,
        currentPrice: 49,
      },
    ],
  })

  expect(portfolio.render(40).join("\n")).toContain("\x1b[32m-¥1,000.00")
})

test("带市场前缀的持仓在窄栏仍显示可卖数量和盈亏", () => {
  const portfolio = new PortfolioWorkspace({
    initialCapital: 100_000,
    cash: 89_994.9,
    positions: [
      {
        code: "SH600519",
        name: "贵州茅台",
        quantity: 100,
        sellableQuantity: 0,
        averageCost: 100.051,
        currentPrice: 100,
      },
    ],
  })
  const frame = portfolio.render(37).map(stripVTControlCharacters).join("\n")
  const positionLine = frame.split("\n").find((line) => line.includes("SH600519")) ?? ""
  expect(frame).toContain("可卖0股")
  expect(positionLine).toContain("-¥5.10")
})
