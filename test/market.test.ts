import { expect, test } from "bun:test"
import { stripVTControlCharacters } from "node:util"
import { visibleWidth } from "@oh-my-pi/pi-tui"
import { ANSI } from "../src/colors"
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

test("宽屏个股行内显示迷你走势，无走势数据时占位", () => {
  const market = new MarketWorkspace(["SH600519", "SZ000858"])
  market.applySnapshot({
    source: "tencent",
    trend: [],
    quotes: [
      {
        code: "SH600519",
        name: "贵州茅台",
        price: 110,
        changePercent: 1,
        source: "tencent",
        trend: [100, 105, 110],
      },
      { code: "SZ000858", name: "五粮液", price: 73.4, changePercent: 0.8, source: "tencent" },
    ],
  })

  const frame = market.render(80)
  const header = frame.find((line) => line.includes("状态")) ?? ""
  const maotai = frame.find((line) => line.includes("SH600519")) ?? ""
  const wuliang = frame.find((line) => line.includes("SZ000858")) ?? ""
  const maotaiPlain = stripVTControlCharacters(maotai)

  expect(stripVTControlCharacters(header)).toContain("走势")
  expect(maotaiPlain).toContain("▁")
  expect(maotaiPlain).toContain("█")
  expect(maotai).toContain(ANSI.red)
  expect(stripVTControlCharacters(wuliang)).toContain("--")
})

test("走势火花线用方块高度呈现曲线形状，按整体涨跌着色", () => {
  const quote = {
    code: "SH600519",
    name: "贵州茅台",
    price: 110,
    changePercent: 1,
    source: "tencent",
  }
  const render = (trend: readonly number[]): string => {
    const market = new MarketWorkspace()
    market.applySnapshot({ source: "tencent", trend, quotes: [quote] })
    return market.render(60).find((line) => line.includes("走势")) ?? ""
  }

  const rising = render([100, 102, 101, 106, 110])
  const risingPlain = stripVTControlCharacters(rising)
  expect(risingPlain).toContain("走势 100.00")
  expect(risingPlain).toContain("110.00")
  expect(risingPlain).toContain("▁") // 最低点
  expect(risingPlain).toContain("█") // 最高点
  expect(risingPlain).not.toContain("|")
  expect(rising).toContain(ANSI.red) // 整体上涨为红
  expect(visibleWidth(risingPlain)).toBeLessThanOrEqual(60)

  const falling = render([110, 108, 109, 103, 100])
  expect(falling).toContain(ANSI.green) // 整体下跌为绿
  expect(falling).not.toContain(ANSI.red)
})

test("焦点股在走势图下方展示今开高低昨收与成交量", () => {
  const market = new MarketWorkspace(["SH600519", "SZ000858"])
  market.applySnapshot({
    source: "tencent",
    trend: [100, 105, 110],
    quotes: [
      {
        code: "SH600519",
        name: "贵州茅台",
        price: 110,
        changePercent: 1,
        source: "tencent",
        open: 105,
        high: 112,
        low: 104,
        previousClose: 108,
        volume: 65_181,
        detail: {
          code: "SH600519",
          turnover: 462_224,
          turnoverRate: 0.29,
          amplitude: 1.78,
          peTtm: 19.61,
          totalMarketCap: 16_218.68,
          limitUp: 1421.21,
          limitDown: 1162.81,
        },
      },
      { code: "SZ000858", name: "五粮液", price: 73.4, changePercent: 0.8, source: "tencent" },
    ],
  })

  const frame = market.render(80).map(stripVTControlCharacters)
  const stats = frame.find((line) => line.includes("今开")) ?? ""
  expect(stats).toContain("今开 105.00")
  expect(stats).toContain("最高 112.00")
  expect(stats).toContain("最低 104.00")
  expect(stats).toContain("昨收 108.00")
  expect(stats).toContain("量 6.5万手")

  const detail = frame.find((line) => line.includes("成交额")) ?? ""
  expect(detail).toContain("成交额 46.2亿")
  expect(detail).toContain("换手 0.29%")
  expect(detail).toContain("振幅 1.78%")
  expect(detail).toContain("PE 19.6")
  expect(detail).toContain("总市值 1.62万亿")

  const sparse = new MarketWorkspace(["SZ000858"])
  sparse.applySnapshot({
    source: "tencent",
    trend: [],
    quotes: [
      { code: "SZ000858", name: "五粮液", price: 73.4, changePercent: 0.8, source: "tencent" },
    ],
  })
  expect(
    sparse
      .render(80)
      .map(stripVTControlCharacters)
      .some((line) => line.includes("今开")),
  ).toBe(false)
})

test("跨市场报价在宽屏显示市场、币种和状态，窄屏保留交易代码与涨跌", () => {
  const market = new MarketWorkspace(["US:AAPL", "JP:7203", "KR:005930"])
  market.applySnapshot({
    source: "Yahoo Finance",
    trend: [209, 210],
    quotes: [
      {
        code: "US:AAPL",
        name: "Apple",
        price: 210,
        changePercent: 1.25,
        source: "yahoo",
        market: "US",
        currency: "USD",
        marketState: "open",
      },
      {
        code: "JP:7203",
        name: "Toyota",
        price: 2_500,
        changePercent: -0.5,
        source: "yahoo",
        market: "JP",
        currency: "JPY",
        marketState: "closed",
      },
      {
        code: "KR:005930",
        name: "Samsung",
        price: 70_000,
        changePercent: 0.75,
        source: "yahoo",
        market: "KR",
        currency: "KRW",
        marketState: "delayed",
      },
    ],
  })

  const wide = market.render(80)
  const wideText = wide.map(stripVTControlCharacters).join("\n")
  expect(wideText).toContain("全球股票")
  expect(wideText).toContain("US USD")
  expect(wideText).toContain("JP JPY")
  expect(wideText).toContain("已收盘")
  expect(wide.join("\n")).toContain(ANSI.red)
  expect(wide.join("\n")).toContain(ANSI.green)
  for (const line of wide) expect(visibleWidth(line)).toBeLessThanOrEqual(80)

  const narrow = market.render(50).map(stripVTControlCharacters).join("\n")
  expect(narrow).toContain("AAPL")
  expect(narrow).toContain("+1.25%")
  expect(narrow).not.toContain("US USD")
})
