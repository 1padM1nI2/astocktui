import { describe, expect, test } from "bun:test"
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

function makeSnapshot(): MarketSnapshot {
  return {
    source: "tencent",
    trend: [1200, 1205, 1210, 1214.88],
    quotes: [
      {
        code: "SH600519",
        name: "贵州茅台",
        price: 1214.88,
        changePercent: 0.32,
        source: "tencent",
      },
      { code: "SZ000858", name: "五粮液", price: 73.4, changePercent: 0.8, source: "tencent" },
      { code: "SH601318", name: "中国平安", price: 49.6, changePercent: -10.14, source: "tencent" },
      { code: "SZ000001", name: "平安银行", price: 10.69, changePercent: 1.42, source: "tencent" },
    ],
  }
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

test("迷你走势按当日涨跌幅着色，且末端反映最新收盘价", () => {
  const market = new MarketWorkspace(["SH600519"])
  market.applySnapshot({
    source: "tencent",
    trend: [],
    quotes: [
      {
        code: "SH600519",
        name: "贵州茅台",
        price: 90,
        changePercent: -9.99,
        source: "tencent",
        // 60 日趋势整体走高，但最新一个交易日暴跌
        trend: [...Array.from({ length: 59 }, () => 100), 90],
      },
    ],
  })

  const row = market.render(80).find((line) => line.includes("SH600519")) ?? ""
  // 当日 -9.99%，行内不能出现红色
  expect(row).not.toContain(ANSI.red)
  const spark = stripVTControlCharacters(row).match(/[▁▂▃▄▅▆▇█]+/)?.[0] ?? ""
  expect(spark.length).toBeGreaterThan(0)
  // 最新收盘价（最低点）必须出现在走势末端
  expect(spark.endsWith("▁")).toBe(true)
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

// ── 键盘选中与详情交互 ──

describe("行情选中与详情", () => {
  test("空格键进入选中模式并高亮第一行股票", () => {
    const market = new MarketWorkspace()
    market.applySnapshot(makeSnapshot())

    const handled = market.handleInput(" ")
    expect(handled).toBe(true)

    const frame = market.render(50)
    const firstDataRow = frame[4] ?? ""
    expect(firstDataRow).toContain(ANSI.reverse)
  })

  test("空格键未加载行情时不进入选中模式", () => {
    const market = new MarketWorkspace()
    const handled = market.handleInput(" ")
    expect(handled).toBe(true)
    const frame = market.render(50)
    expect(frame.join("\n")).not.toContain(ANSI.reverse)
  })

  test("↑↓ 键在选中模式移动光标并在边界夹紧", () => {
    const market = new MarketWorkspace()
    market.applySnapshot(makeSnapshot())
    market.handleInput(" ")

    market.handleInput("\x1b[B")
    market.handleInput("\x1b[B")
    expect(market.render(50)[6] ?? "").toContain(ANSI.reverse)

    market.handleInput("\x1b[A")
    expect(market.render(50)[5] ?? "").toContain(ANSI.reverse)

    market.handleInput("\x1b[A")
    market.handleInput("\x1b[A")
    expect(market.render(50)[4] ?? "").toContain(ANSI.reverse)

    for (let i = 0; i < 10; i++) market.handleInput("\x1b[B")
    expect(market.render(50)[7] ?? "").toContain(ANSI.reverse)
  })

  test("Esc 在选中模式退出选中回到滚动模式", () => {
    const market = new MarketWorkspace()
    market.applySnapshot(makeSnapshot())
    market.handleInput(" ")

    expect(market.handleInput("\x1b")).toBe(true)
    expect(market.render(50).join("\n")).not.toContain(ANSI.reverse)
  })

  test("空格在选中股票上打开详情视图", () => {
    const market = new MarketWorkspace()
    market.applySnapshot(makeSnapshot())
    market.handleInput(" ")
    market.handleInput("\x1b[B")

    expect(market.handleInput(" ")).toBe(true)

    const raw = market.render(50).join("\n")
    expect(raw).toContain("五粮液")
    expect(raw).toContain("73.40")
  })

  test("Esc 在详情视图返回选中模式，再按 Esc 回到滚动模式", () => {
    const market = new MarketWorkspace()
    market.applySnapshot(makeSnapshot())
    market.handleInput(" ")
    market.handleInput(" ")

    expect(market.handleInput("\x1b")).toBe(true)
    expect(market.render(50).join("\n")).toContain(ANSI.reverse)

    expect(market.handleInput("\x1b")).toBe(true)
    expect(market.render(50).join("\n")).not.toContain(ANSI.reverse)
  })

  test("详情模式下 ↑↓ 切换股票并保持详情视图", () => {
    const market = new MarketWorkspace()
    market.applySnapshot(makeSnapshot())
    market.handleInput(" ")
    market.handleInput(" ")

    expect(market.handleInput("\x1b[B")).toBe(true)
    expect(market.render(50).join("\n")).toContain("五粮液")

    expect(market.handleInput("\x1b[B")).toBe(true)
    expect(market.render(50).join("\n")).toContain("中国平安")
  })

  test("选中模式下滚动键(PageUp/PageDown/Home/End)仍正常工作", () => {
    const market = new MarketWorkspace()
    market.applySnapshot(makeSnapshot())
    market.handleInput(" ")

    expect(market.handleInput("\x1b[6~")).toBe(true)
    expect(market.handleInput("\x1b[5~")).toBe(true)
    expect(market.handleInput("\x1b[H")).toBe(true)
    expect(market.handleInput("\x1b[F")).toBe(true)
  })

  test("详情视图内容包含现价与涨跌幅且不超宽", () => {
    const market = new MarketWorkspace()
    market.applySnapshot(makeSnapshot())
    market.handleInput(" ")
    market.handleInput(" ")

    const frame = market.render(50)
    const raw = frame.join("\n")
    expect(raw).toContain("1214.88")
    expect(raw).toContain("+0.32%")
    for (const line of frame) expect(visibleWidth(line)).toBeLessThanOrEqual(50)
  })

  test("详情视图按选中股票显示各自的开盘价与K线", () => {
    const market = new MarketWorkspace()
    market.applySnapshot({
      source: "tencent",
      trend: [1210, 1214.88],
      quotes: [
        {
          code: "SH600519",
          name: "贵州茅台",
          price: 1214.88,
          changePercent: 0.32,
          source: "tencent",
        },
        { code: "SZ000858", name: "五粮液", price: 73.4, changePercent: 0.8, source: "tencent" },
      ],
      klinesByCode: {
        SH600519: [
          { date: "2026-07-21", open: 1200, close: 1210, high: 1215, low: 1195 },
          { date: "2026-07-22", open: 1211.5, close: 1214.88, high: 1218, low: 1208 },
        ],
        SZ000858: [
          { date: "2026-07-21", open: 72.8, close: 73.1, high: 73.5, low: 72.5 },
          { date: "2026-07-22", open: 73.02, close: 73.4, high: 73.6, low: 72.9 },
        ],
      },
    })
    market.handleInput(" ")
    market.handleInput("\x1b[B")
    market.handleInput(" ")

    const raw = market.render(50).map(stripVTControlCharacters).join("\n")
    expect(raw).toContain("五粮液")
    expect(raw).toContain("今开 73.02")
    expect(raw).not.toContain("1211.50")
  })

  test("详情视图缺少该股票K线数据时不渲染图表", () => {
    const market = new MarketWorkspace()
    market.applySnapshot({
      source: "tencent",
      trend: [1210, 1214.88],
      quotes: [
        {
          code: "SH600519",
          name: "贵州茅台",
          price: 1214.88,
          changePercent: 0.32,
          source: "tencent",
        },
        { code: "SZ000858", name: "五粮液", price: 73.4, changePercent: 0.8, source: "tencent" },
      ],
      klinesByCode: {
        SH600519: [
          { date: "2026-07-21", open: 1200, close: 1210, high: 1215, low: 1195 },
          { date: "2026-07-22", open: 1211.5, close: 1214.88, high: 1218, low: 1208 },
        ],
      },
    })
    market.handleInput(" ")
    market.handleInput("\x1b[B")
    market.handleInput(" ")

    const raw = market.render(50).map(stripVTControlCharacters).join("\n")
    expect(raw).not.toContain("日K线图")
    expect(raw).not.toContain("1211.50")
  })

  test("详情视图排版：主价格行、对齐信息栏与带刻度的K线", () => {
    const market = new MarketWorkspace()
    market.applySnapshot({
      source: "tencent",
      trend: [],
      quotes: [
        {
          code: "SH600519",
          name: "贵州茅台",
          price: 1214.88,
          changePercent: 0.4024,
          source: "tencent",
          previousClose: 1210,
          high: 1218,
          low: 1208,
          volume: 128_258,
        },
      ],
      klinesByCode: {
        SH600519: [
          { date: "2026-07-20", open: 1200, close: 1210, high: 1215, low: 1195, volume: 90_000 },
          { date: "2026-07-21", open: 1210, close: 1211, high: 1216, low: 1205, volume: 110_000 },
          {
            date: "2026-07-22",
            open: 1211.5,
            close: 1214.88,
            high: 1218,
            low: 1208,
            volume: 128_258,
          },
        ],
      },
    })
    market.handleInput(" ")
    market.handleInput(" ")

    const frame = market.render(56)
    const plain = frame.map(stripVTControlCharacters)
    const raw = plain.join("\n")

    const hero = plain.find((line) => line.includes("1214.88")) ?? ""
    expect(hero).toContain("+0.40%")
    expect(hero).toContain("+4.88")

    const rowOpen = plain.find((line) => line.includes("今开")) ?? ""
    const rowLow = plain.find((line) => line.includes("最低")) ?? ""
    expect(rowOpen).toContain("1211.50")
    expect(rowOpen).toContain("最高")
    expect(rowOpen).toContain("1218.00")
    expect(rowLow).toContain("1208.00")
    expect(rowLow).toContain("昨收")
    expect(visibleTokenStart(rowOpen, "最高")).toBe(visibleTokenStart(rowLow, "昨收"))

    expect(raw).toContain("1195.00")
    expect(raw).toContain("└")
    expect(raw).toContain("07-20")
    expect(raw).toContain("07-22")
    expect(raw).toContain("MA5")
    expect(raw).toContain("成交量")

    const rawColored = frame.join("\n")
    expect(rawColored).toContain(ANSI.red)
    expect(rawColored).toContain(ANSI.green)

    for (const line of frame) expect(visibleWidth(line)).toBeLessThanOrEqual(56)
  })

  test("详情视图在窄宽与宽屏下均不超宽", () => {
    const market = new MarketWorkspace()
    market.applySnapshot({
      source: "tencent",
      trend: [],
      quotes: [
        {
          code: "SH600519",
          name: "贵州茅台",
          price: 1214.88,
          changePercent: 0.4024,
          source: "tencent",
          previousClose: 1210,
          high: 1218,
          low: 1208,
        },
      ],
      klinesByCode: {
        SH600519: [
          { date: "2026-07-21", open: 1200, close: 1210, high: 1215, low: 1195, volume: 90_000 },
          {
            date: "2026-07-22",
            open: 1211.5,
            close: 1214.88,
            high: 1218,
            low: 1208,
            volume: 128_258,
          },
        ],
      },
    })
    market.handleInput(" ")
    market.handleInput(" ")

    for (const width of [36, 44, 72]) {
      for (const line of market.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width)
      }
    }
  })
})
