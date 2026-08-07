import { expect, test } from "bun:test"
import type { CommandContext, CommandResult } from "../../src/commands/commands"
import { QUOTE_COMMANDS } from "../../src/commands/quote"
import type { StockDetail } from "../../src/market/stock-detail"

const DETAIL: StockDetail = {
  code: "SH600519",
  name: "贵州茅台",
  open: 1305,
  volume: 35_699,
  turnover: 462_224,
  turnoverRate: 0.29,
  amplitude: 1.78,
  peTtm: 19.61,
  pb: 6.96,
  circMarketCap: 16_218.68,
  totalMarketCap: 16_218.68,
  limitUp: 1421.21,
  limitDown: 1162.81,
  volumeRatio: 0.52,
  averagePrice: 1294.79,
  week52High: 1539.98,
  week52Low: 1151.01,
  bids: [
    { price: 1296.0, volume: 1 },
    { price: 1295.6, volume: 2 },
  ],
  asks: [
    { price: 1297.41, volume: 21 },
    { price: 1297.57, volume: 3 },
  ],
}

function contextWith(options: {
  readonly quotePrice?: number
  readonly detail?: StockDetail
}): CommandContext {
  return {
    focus: () => {},
    refresh: () => ({ market: "skipped", news: "skipped" }),
    refreshAndWait: async () => {},
    quit: () => {},
    clearAgent: () => {},
    marketOverview: async () => {
      throw new Error("未实现")
    },
    status: () => ({
      activeWorkspace: "agent",
      market: { state: "idle", source: null },
      news: { state: "idle", source: null },
      agent: "ready",
    }),
    marketSnapshot: () => null,
    newsSnapshot: () => null,
    portfolio: () => ({ initialCapital: 100_000, cash: 100_000, positions: [] }),
    quote: async () =>
      options.quotePrice === undefined
        ? undefined
        : { code: "SH600519", name: "贵州茅台", price: options.quotePrice },
    quoteDetail: async () => options.detail,
    trading: () => {
      throw new Error("未实现")
    },
    portfolioChanged: () => {},
    watchlist: () => [],
    changeWatchlist: async () => ({ ok: false, code: "", message: "未实现" }),
  }
}

async function run(context: CommandContext, input: string): Promise<CommandResult> {
  const command = QUOTE_COMMANDS[0]
  if (command === undefined) throw new Error("命令未注册")
  return command.execute(context, input.split(/\s+/).slice(1))
}

test("/quote 展示估值、52 周与五档", async () => {
  const result = await run(contextWith({ quotePrice: 1297.41, detail: DETAIL }), "/quote 600519")
  expect(result.title).toBe("贵州茅台 SH600519 · 1297.41")
  const body = result.lines.join("\n")
  expect(body).toContain("52周 1151.01 ~ 1539.98")
  expect(body).toContain("成交额 46.2亿")
  expect(body).toContain("PE 19.6")
  expect(body).toContain("总市值 1.62万亿")
  expect(body).toContain("涨停 1421.21 · 跌停 1162.81")
  expect(body.indexOf("卖一 1297.41 ×21手")).toBeLessThan(body.indexOf("买一 1296.00 ×1手"))
  expect(body).toContain("—— 现价 1297.41 ——")
})

test("/quote 非 A 股与无效代码报错", async () => {
  expect((await run(contextWith({}), "/quote US:AAPL")).lines[0]).toContain("仅支持 A 股")
  expect((await run(contextWith({}), "/quote xxx")).title).toBe("命令错误")
  expect((await run(contextWith({}), "/quote")).lines[0]).toContain("用法")
})

test("/quote 行情与详情都不可用时提示失败", async () => {
  const result = await run(contextWith({}), "/quote 600519")
  expect(result.title).toBe("命令错误")
  expect(result.lines[0]).toContain("无法获取")
})
