import { expect, test } from "bun:test"
import { stripVTControlCharacters } from "node:util"
import { visibleWidth } from "@oh-my-pi/pi-tui"
import { MarketWorkspace } from "../src/components/market"
import type { MarketSnapshot } from "../src/market-data"

function visibleTokenStart(line: string, token: string): number {
  const index = line.indexOf(token)
  expect(index).toBeGreaterThanOrEqual(0)
  return visibleWidth(line.slice(0, index))
}

function visibleTokenEnd(line: string, token: string): number {
  return visibleTokenStart(line, token) + visibleWidth(token)
}

test("行情表格按列对齐名称、现价和涨跌幅", () => {
  const snapshot: MarketSnapshot = {
    source: "tencent",
    trend: [],
    quotes: [
      {
        code: "SH600519",
        name: "贵州茅台",
        price: 1214.88,
        changePercent: 0.32,
        source: "tencent",
      },
      {
        code: "SZ000858",
        name: "五粮液",
        price: 73.4,
        changePercent: 0.8,
        source: "tencent",
      },
      {
        code: "SH601318",
        name: "中国平安",
        price: 49.6,
        changePercent: -10.14,
        source: "tencent",
      },
      {
        code: "SZ000001",
        name: "平安银行",
        price: 10.69,
        changePercent: 1.42,
        source: "tencent",
      },
    ],
  }
  const market = new MarketWorkspace()
  market.applySnapshot(snapshot)

  const frame = market.render(50).map(stripVTControlCharacters)
  const header = frame[3] ?? ""
  const rows = frame.slice(4, 8)

  expect(
    rows.map((line) =>
      visibleTokenStart(
        line,
        line.includes("五粮液")
          ? "五粮液"
          : line.includes("贵州茅台")
            ? "贵州茅台"
            : line.includes("中国平安")
              ? "中国平安"
              : "平安银行",
      ),
    ),
  ).toEqual([8, 8, 8, 8])
  expect(
    rows.map((line, index) =>
      visibleTokenEnd(line, ["1214.88", "73.40", "49.60", "10.69"][index] ?? ""),
    ),
  ).toEqual([30, 30, 30, 30])
  expect(
    rows.map((line, index) =>
      visibleTokenEnd(line, ["+0.32%", "+0.80%", "-10.14%", "+1.42%"][index] ?? ""),
    ),
  ).toEqual([41, 41, 41, 41])
  expect(visibleTokenEnd(header, "现价")).toBe(30)
  expect(visibleTokenEnd(header, "涨跌幅")).toBe(41)
})
