import { describe, expect, test } from "bun:test"
import { visibleWidth } from "@oh-my-pi/pi-tui"
import type { BacktestHttp } from "../../src/backtest/data"
import type { CommandContext } from "../../src/commands/command-context"
import { createScreenCommands, parseScreenArgs } from "../../src/commands/screen"

function httpWith(closesByCode: Readonly<Record<string, readonly number[]>>): BacktestHttp {
  return {
    fetch: async (input) => {
      const secid = /secid=[01]\.(\d{6})/u.exec(String(input))?.[1]
      const entry = Object.entries(closesByCode).find(([code]) => code.endsWith(secid ?? ""))
      if (entry === undefined) return new Response("x", { status: 404 })
      const klines = entry[1].map(
        (close, index) =>
          `2024-02-${String(index + 1).padStart(2, "0")},${close},${close},${close},${close},1000`,
      )
      return new Response(JSON.stringify({ data: { klines } }), { status: 200 })
    },
  }
}

describe("parseScreenArgs", () => {
  test("默认 ma-cross 策略与 watch 来源", () => {
    expect(parseScreenArgs([])).toEqual({ strategyName: "ma-cross", params: {}, source: "watch" })
  })

  test("解析策略、参数与来源", () => {
    expect(parseScreenArgs(["rsi", "period=10", "source=hot"])).toEqual({
      strategyName: "rsi",
      params: { period: 10 },
      source: "hot",
    })
  })

  test("拒绝非法来源与未知参数", () => {
    expect(parseScreenArgs(["source=nowhere"])).toHaveProperty("error")
    expect(parseScreenArgs(["ma-cross", "days=100"])).toHaveProperty("error")
  })
})

describe("/screen 命令", () => {
  const http = httpWith({
    SH600519: [10, 9, 8, 7, 6, 12], // 金叉
    SZ000001: [7, 8, 9, 10, 11, 6], // 死叉
    SZ300750: [10, 10, 10, 10, 10, 10], // 无信号
  })
  const command = createScreenCommands(http)[0]
  if (command === undefined) throw new Error("命令未注册")
  const context = {
    watchlist: () => ["SH600519", "SZ000001", "SZ300750"],
  } as unknown as CommandContext

  test("自选股来源输出买卖信号与统计", async () => {
    const result = await command.execute(context, ["ma-cross", "fast=2", "slow=4"])
    expect(result.title).toContain("选股")
    const text = result.lines.join("\n")
    expect(text).toContain("SH600519")
    expect(text).toContain("SZ000001")
    expect(text).toContain("无信号 1 只")
    for (const line of result.lines) expect(visibleWidth(line)).toBeLessThanOrEqual(80)
  })

  test("热榜来源读取 hotRank 快照", async () => {
    const hotContext = {
      hotRank: async () => ({
        source: "东财股吧人气",
        updatedAt: 0,
        items: [
          {
            code: "SH600519",
            rank: 1,
            rankChange: 0,
            name: "贵州茅台",
            price: 12,
            changePercent: 1,
          },
        ],
      }),
    } as unknown as CommandContext
    const result = await command.execute(hotContext, ["ma-cross", "fast=2", "slow=4", "source=hot"])
    expect(result.title).toContain("热榜")
    expect(result.lines.join("\n")).toContain("SH600519")
  })

  test("空自选股给出明确错误", async () => {
    const empty = { watchlist: () => [] } as unknown as CommandContext
    const result = await command.execute(empty, [])
    expect(result.title).toBe("选股失败")
    expect(result.lines.join("\n")).toContain("自选股")
  })

  test("未知策略报错并列出可选项", async () => {
    const result = await command.execute(context, ["nope"])
    expect(result.title).toBe("选股失败")
    expect(result.lines.join("\n")).toContain("ma-cross")
  })
})
