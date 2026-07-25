import { describe, expect, test } from "bun:test"
import { stripVTControlCharacters } from "node:util"
import { visibleWidth } from "@oh-my-pi/pi-tui"
import { ANSI } from "../src/colors"
import { MarketWorkspace } from "../src/components/market"
import type { MarketSnapshot } from "../src/market-data"

function makeSnapshot(): MarketSnapshot {
  return {
    source: "tencent",
    trend: [1200, 1205, 1210, 1214.88],
    quotes: [
      { code: "SH600519", name: "贵州茅台", price: 1214.88, changePercent: 0.32, source: "tencent" },
      { code: "SZ000858", name: "五粮液", price: 73.4, changePercent: 0.8, source: "tencent" },
      { code: "SH601318", name: "中国平安", price: 49.6, changePercent: -10.14, source: "tencent" },
      { code: "SZ000001", name: "平安银行", price: 10.69, changePercent: 1.42, source: "tencent" },
    ],
  }
}

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
    const raw = frame.join("\n")
    expect(raw).toContain(ANSI.reverse)
    // 第一行数据行（贵州茅台）应包含反色高亮
    const firstDataRow = frame[4] ?? ""
    expect(firstDataRow).toContain(ANSI.reverse)
  })

  test("空格键未加载行情时不进入选中模式", () => {
    const market = new MarketWorkspace()
    const handled = market.handleInput(" ")
    expect(handled).toBe(true)
    const frame = market.render(50)
    const raw = frame.join("\n")
    expect(raw).not.toContain(ANSI.reverse)
  })

  test("↑↓ 键在选中模式移动光标并在边界夹紧", () => {
    const market = new MarketWorkspace()
    market.applySnapshot(makeSnapshot())
    market.handleInput(" ")

    expect(market.handleInput("\x1b[B")).toBe(true)
    expect(market.handleInput("\x1b[B")).toBe(true)
    // 光标在 index 2（中国平安）
    const frameAt2 = market.render(50)
    const thirdRow = frameAt2[6] ?? ""
    expect(thirdRow).toContain(ANSI.reverse)

    expect(market.handleInput("\x1b[A")).toBe(true)
    const frameAt1 = market.render(50)
    const secondRow = frameAt1[5] ?? ""
    expect(secondRow).toContain(ANSI.reverse)

    // 夹紧到顶部
    market.handleInput("\x1b[A") // 到 0
    market.handleInput("\x1b[A") // 仍在 0
    const frameAt0 = market.render(50)
    const firstRow = frameAt0[4] ?? ""
    expect(firstRow).toContain(ANSI.reverse)

    // 夹紧到底部
    for (let i = 0; i < 10; i++) market.handleInput("\x1b[B")
    const frameAtEnd = market.render(50)
    const lastRow = frameAtEnd[7] ?? ""
    expect(lastRow).toContain(ANSI.reverse)
  })

  test("Esc 在选中模式退出选中回到滚动模式", () => {
    const market = new MarketWorkspace()
    market.applySnapshot(makeSnapshot())
    market.handleInput(" ")

    const handled = market.handleInput("\x1b")
    expect(handled).toBe(true)

    const frame = market.render(50)
    const raw = frame.join("\n")
    expect(raw).not.toContain(ANSI.reverse)
  })

  test("空格在选中股票上打开详情视图", () => {
    const market = new MarketWorkspace()
    market.applySnapshot(makeSnapshot())
    market.handleInput(" ") // 进入选中模式
    market.handleInput("\x1b[B") // 选第二个（五粮液）

    const handled = market.handleInput(" ") // 打开详情
    expect(handled).toBe(true)

    const frame = market.render(50)
    const raw = frame.join("\n")
    expect(raw).toContain("五粮液")
    expect(raw).toContain("73.40")
  })

  test("Esc 在详情视图返回选中模式，再按 Esc 回到滚动模式", () => {
    const market = new MarketWorkspace()
    market.applySnapshot(makeSnapshot())
    market.handleInput(" ")
    market.handleInput(" ") // 打开详情

    // Esc 从详情退出到选中模式
    expect(market.handleInput("\x1b")).toBe(true)
    const frameSelected = market.render(50)
    expect(frameSelected.join("\n")).toContain(ANSI.reverse)

    // Esc 从选中退出到滚动模式
    expect(market.handleInput("\x1b")).toBe(true)
    const frameScroll = market.render(50)
    expect(frameScroll.join("\n")).not.toContain(ANSI.reverse)
  })

  test("详情模式下 ↑↓ 切换股票并保持详情视图", () => {
    const market = new MarketWorkspace()
    market.applySnapshot(makeSnapshot())
    market.handleInput(" ") // 进入选中
    market.handleInput(" ") // 打开详情（当前选中贵州茅台）

    // ↓ 切换到下一只股票
    expect(market.handleInput("\x1b[B")).toBe(true)
    const frame1 = market.render(50)
    expect(frame1.join("\n")).toContain("五粮液")

    // ↓ 再切到再下一只
    expect(market.handleInput("\x1b[B")).toBe(true)
    const frame2 = market.render(50)
    expect(frame2.join("\n")).toContain("中国平安")
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
    market.handleInput(" ") // 打开详情

    const frame = market.render(50)
    const raw = frame.join("\n")
    expect(raw).toContain("1214.88")
    expect(raw).toContain("+0.32%")
    for (const line of frame) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(50)
    }
  })

  test("详情视图按选中股票显示各自的开盘价与K线", () => {
    const market = new MarketWorkspace()
    market.applySnapshot({
      source: "tencent",
      trend: [1210, 1214.88],
      quotes: [
        { code: "SH600519", name: "贵州茅台", price: 1214.88, changePercent: 0.32, source: "tencent" },
        { code: "SZ000858", name: "五粮液", price: 73.4, changePercent: 0.8, source: "tencent" },
      ],
      klines: [
        { date: "2026-07-21", open: 1200, close: 1210, high: 1215, low: 1195 },
        { date: "2026-07-22", open: 1211.5, close: 1214.88, high: 1218, low: 1208 },
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
    market.handleInput("\x1b[B") // 选中五粮液
    market.handleInput(" ") // 打开详情

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
        { code: "SH600519", name: "贵州茅台", price: 1214.88, changePercent: 0.32, source: "tencent" },
        { code: "SZ000858", name: "五粮液", price: 73.4, changePercent: 0.8, source: "tencent" },
      ],
      klines: [
        { date: "2026-07-21", open: 1200, close: 1210, high: 1215, low: 1195 },
        { date: "2026-07-22", open: 1211.5, close: 1214.88, high: 1218, low: 1208 },
      ],
      klinesByCode: {
        SH600519: [
          { date: "2026-07-21", open: 1200, close: 1210, high: 1215, low: 1195 },
          { date: "2026-07-22", open: 1211.5, close: 1214.88, high: 1218, low: 1208 },
        ],
      },
    })
    market.handleInput(" ")
    market.handleInput("\x1b[B") // 选中五粮液（无 K 线数据）
    market.handleInput(" ") // 打开详情

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
          prevClose: 1210,
          high: 1218,
          low: 1208,
          volume: 128_258,
        },
      ],
      klinesByCode: {
        SH600519: [
          { date: "2026-07-20", open: 1200, close: 1210, high: 1215, low: 1195, volume: 90_000 },
          { date: "2026-07-21", open: 1210, close: 1211, high: 1216, low: 1205, volume: 110_000 },
          { date: "2026-07-22", open: 1211.5, close: 1214.88, high: 1218, low: 1208, volume: 128_258 },
        ],
      },
    })
    market.handleInput(" ")
    market.handleInput(" ") // 打开详情

    const frame = market.render(56)
    const plain = frame.map(stripVTControlCharacters)
    const raw = plain.join("\n")

    // 主价格行：现价、涨跌幅、涨跌额在同一行
    const hero = plain.find((line) => line.includes("1214.88")) ?? ""
    expect(hero).toContain("+0.40%")
    expect(hero).toContain("+4.88")

    // 双列信息栏：今开/最高、最低/昨收同行且第二列对齐
    const rowOpen = plain.find((line) => line.includes("今开")) ?? ""
    const rowLow = plain.find((line) => line.includes("最低")) ?? ""
    expect(rowOpen).toContain("1211.50")
    expect(rowOpen).toContain("最高")
    expect(rowOpen).toContain("1218.00")
    expect(rowLow).toContain("1208.00")
    expect(rowLow).toContain("昨收")
    expect(visibleTokenStart(rowOpen, "最高")).toBe(visibleTokenStart(rowLow, "昨收"))

    // K线图：价格刻度、基线、日期范围、均线图例、成交量
    expect(raw).toContain("1195.00")
    expect(raw).toContain("└")
    expect(raw).toContain("07-20")
    expect(raw).toContain("07-22")
    expect(raw).toContain("MA5")
    expect(raw).toContain("成交量")

    // A股配色：涨为红、跌为绿
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
          prevClose: 1210,
          high: 1218,
          low: 1208,
        },
      ],
      klinesByCode: {
        SH600519: [
          { date: "2026-07-21", open: 1200, close: 1210, high: 1215, low: 1195, volume: 90_000 },
          { date: "2026-07-22", open: 1211.5, close: 1214.88, high: 1218, low: 1208, volume: 128_258 },
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
