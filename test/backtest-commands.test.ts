import { describe, expect, test } from "bun:test"
import { visibleWidth } from "@oh-my-pi/pi-tui"
import {
  createBacktestCommands,
  parseBacktestArgs,
  renderBacktestReport,
} from "../src/backtest-commands"
import type { BacktestHttp } from "../src/backtest-data"
import { runBacktest } from "../src/backtest-engine"
import { computeMetrics } from "../src/backtest-metrics"
import { createStrategy } from "../src/backtest-strategy"
import type { CommandContext } from "../src/command-context"
import type { KlineBar } from "../src/market-data"

function bars(closes: readonly number[]): KlineBar[] {
  return closes.map((close, index) => ({
    date: `2024-02-${String(index + 1).padStart(2, "0")}`,
    open: close,
    close,
    high: close,
    low: close,
  }))
}

describe("parseBacktestArgs", () => {
  test("默认策略 ma-cross、250 天、十万资金", () => {
    expect(parseBacktestArgs(["600519"])).toEqual({
      codes: ["SH600519"],
      strategyName: "ma-cross",
      params: {},
      days: 250,
      cash: 100_000,
    })
  })

  test("逗号分隔多代码并去重", () => {
    const parsed = parseBacktestArgs(["600519,000001,sh600519"])
    expect(parsed).toHaveProperty("codes", ["SH600519", "SZ000001"])
  })

  test("watch 表示整个自选股列表", () => {
    expect(parseBacktestArgs(["watch", "rsi"])).toHaveProperty("codes", "watch")
  })

  test("解析策略与数值参数", () => {
    expect(parseBacktestArgs(["SZ000001", "rsi", "period=10", "days=120", "cash=50000"])).toEqual({
      codes: ["SZ000001"],
      strategyName: "rsi",
      params: { period: 10 },
      days: 120,
      cash: 50_000,
    })
  })

  test("拒绝非 A 股、未知参数与非法数值", () => {
    expect(parseBacktestArgs(["US:AAPL"])).toHaveProperty("error")
    expect(parseBacktestArgs(["600519", "ma-cross", "foo=1"])).toHaveProperty("error")
    expect(parseBacktestArgs(["600519", "rsi", "period=abc"])).toHaveProperty("error")
    expect(parseBacktestArgs(["600519", "ma-cross", "days=0"])).toHaveProperty("error")
    expect(parseBacktestArgs([])).toHaveProperty("error")
  })
})

describe("renderBacktestReport", () => {
  const data = bars([10, 9, 8, 7, 12, 13, 12, 11, 10, 9, 8, 7, 6])
  const strategy = createStrategy("ma-cross", { fast: 2, slow: 4 })
  if (strategy === null) throw new Error("策略创建失败")
  const result = runBacktest(data, strategy, { initialCapital: 100_000 })
  const metrics = computeMetrics(result)
  const lines = renderBacktestReport(strategy, data, result, metrics)

  test("包含区间、收益、回撤、胜率与基准", () => {
    const text = lines.join("\n")
    expect(text).toContain("2024-02-01")
    expect(text).toContain("2024-02-13")
    expect(text).toContain("总收益")
    expect(text).toContain("最大回撤")
    expect(text).toContain("买入持有")
  })

  test("每行宽度不超过 80 列", () => {
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(80)
    }
  })

  test("亏损卖出显示负号", () => {
    const losing = {
      ...result,
      trades: [
        {
          side: "sell" as const,
          date: "2024-02-13",
          price: 9,
          quantity: 100,
          grossAmount: 900,
          fees: 5,
          realizedProfit: -123.45,
        },
      ],
    }
    const report = renderBacktestReport(strategy, data, losing, metrics)
    expect(report.join("\n")).toContain("-¥123.45")
  })
})

describe("/backtest 命令", () => {
  function httpWith(closes: readonly number[]): BacktestHttp {
    return {
      fetch: async () =>
        new Response(
          JSON.stringify({
            data: {
              klines: bars(closes).map((bar) =>
                [bar.date, bar.open, bar.close, bar.high, bar.low, 1000].join(","),
              ),
            },
          }),
          { status: 200 },
        ),
    }
  }

  const command = createBacktestCommands(
    httpWith(Array.from({ length: 60 }, (_, i) => 10 + (i % 7))),
  )[0]
  const context = {} as CommandContext

  if (command === undefined) throw new Error("命令未注册")

  test("输出回测报告", async () => {
    const result = await command.execute(context, ["600519", "ma-cross", "fast=2", "slow=4"])
    expect(result.title).toContain("回测")
    expect(result.lines.join("\n")).toContain("总收益")
  })

  test("历史数据不足时给出明确错误", async () => {
    const short = createBacktestCommands(httpWith([10, 11, 12]))[0]
    if (short === undefined) throw new Error("命令未注册")
    const result = await short.execute(context, ["600519"])
    expect(result.title).toBe("回测失败")
    expect(result.lines.join("\n")).toContain("不足")
  })

  test("未知策略列出可用策略", async () => {
    const result = await command.execute(context, ["600519", "nope"])
    expect(result.title).toBe("回测失败")
    expect(result.lines.join("\n")).toContain("ma-cross")
  })

  test("网络错误转为失败输出", async () => {
    const down = createBacktestCommands({
      fetch: async () => new Response("x", { status: 500 }),
    })[0]
    if (down === undefined) throw new Error("命令未注册")
    const result = await down.execute(context, ["600519"])
    expect(result.title).toBe("回测失败")
    expect(result.lines.join("\n")).toContain("500")
  })

  test("逗号多代码走批量对比表", async () => {
    const result = await command.execute(context, ["600519,000001", "ma-cross", "fast=2", "slow=4"])
    expect(result.title).toContain("批量回测")
    const text = result.lines.join("\n")
    expect(text).toContain("SH600519")
    expect(text).toContain("SZ000001")
    expect(text).toContain("总收益")
  })

  test("watch 模式回测整个自选股列表", async () => {
    const watchContext = { watchlist: () => ["SH600519", "SZ000001"] } as unknown as CommandContext
    const result = await command.execute(watchContext, ["watch", "ma-cross", "fast=2", "slow=4"])
    expect(result.title).toContain("批量回测")
    expect(result.lines.join("\n")).toContain("2 只标的")
  })

  test("watch 模式空自选股报错", async () => {
    const emptyContext = { watchlist: () => [] } as unknown as CommandContext
    const result = await command.execute(emptyContext, ["watch"])
    expect(result.title).toBe("回测失败")
    expect(result.lines.join("\n")).toContain("自选股")
  })
})
