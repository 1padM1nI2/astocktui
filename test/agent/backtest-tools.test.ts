import { describe, expect, test } from "bun:test"
import { type BacktestToolContext, createBacktestAgentTools } from "../../src/agent/backtest-tools"
import type { BacktestHttp } from "../../src/backtest/data"

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

// 趋势数据：第 5 日金叉后持续上涨 / 持续下跌，用于回测与批量
const httpTrend = httpWith({
  SH600519: [10, 9, 8, 7, 12, 13, 14, 15],
  SZ000001: [15, 14, 13, 12, 11, 10, 9, 8],
})

// 交叉数据：最后一个交易日才发生金叉 / 死叉，用于选股信号
const httpCross = httpWith({
  SH600519: [10, 9, 8, 7, 6, 5, 6, 12],
  SZ000001: [7, 8, 9, 10, 11, 12, 13, 6],
})

const context: BacktestToolContext = {
  watchlist: () => ["SH600519", "SZ000001"],
  hotRank: async () => ({
    source: "东财股吧人气",
    updatedAt: 0,
    items: [
      { code: "SH600519", rank: 1, rankChange: 0, name: "贵州茅台", price: 12, changePercent: 1 },
    ],
  }),
}

const tools = createBacktestAgentTools(context, httpTrend)
const crossTools = createBacktestAgentTools(context, httpCross)

function tool(name: string, source: typeof tools = tools) {
  const found = source.find((item) => item.name === name)
  if (found === undefined) throw new Error(`工具未注册：${name}`)
  return found
}

interface ToolDetails {
  details: unknown
}

async function run(name: string, params: Record<string, unknown>): Promise<unknown> {
  const result = (await tool(name).execute("t1", params)) as ToolDetails
  return result.details
}

async function runCross(name: string, params: Record<string, unknown>): Promise<unknown> {
  const result = (await tool(name, crossTools).execute("t1", params)) as ToolDetails
  return result.details
}

describe("backtest Agent 工具注册", () => {
  test("提供 run_backtest、batch_backtest、screen_stocks", () => {
    expect(tools.map((item) => item.name)).toEqual([
      "run_backtest",
      "batch_backtest",
      "screen_stocks",
    ])
  })
})

describe("run_backtest", () => {
  test("返回指标与最近成交", async () => {
    const details = (await run("run_backtest", {
      code: "600519",
      strategy: "ma-cross",
      params: { fast: 2, slow: 4 },
      days: 60,
    })) as Record<string, unknown>
    expect(details["code"]).toBe("SH600519")
    expect(details["strategy"]).toBe("ma-cross")
    const metrics = details["metrics"] as Record<string, unknown>
    expect(typeof metrics["totalReturn"]).toBe("number")
    expect(details["period"]).toMatchObject({ start: "2024-02-01", days: 8 })
  })

  test("非法代码与未知策略抛出错误", async () => {
    await expect(run("run_backtest", { code: "US:AAPL" })).rejects.toThrow("仅支持 A 股")
    await expect(run("run_backtest", { code: "600519", strategy: "nope" })).rejects.toThrow(
      "ma-cross",
    )
  })
})

describe("batch_backtest", () => {
  test("默认扫描自选股并按收益排序", async () => {
    const details = (await run("batch_backtest", {
      strategy: "ma-cross",
      params: { fast: 2, slow: 4 },
      days: 60,
    })) as { rows: { code: string; totalReturn: number | null }[] }
    expect(details.rows.map((row) => row.code)).toEqual(["SH600519", "SZ000001"])
    expect(details.rows[0]?.totalReturn ?? 0).toBeGreaterThan(details.rows[1]?.totalReturn ?? 0)
  })

  test("显式 codes 优先于自选股", async () => {
    const details = (await run("batch_backtest", {
      codes: ["SZ000001"],
      strategy: "ma-cross",
      params: { fast: 2, slow: 4 },
    })) as { rows: { code: string }[] }
    expect(details.rows).toHaveLength(1)
    expect(details.rows[0]?.code).toBe("SZ000001")
  })
})

describe("screen_stocks", () => {
  test("扫描自选股返回信号分组", async () => {
    const details = (await runCross("screen_stocks", {
      strategy: "ma-cross",
      params: { fast: 2, slow: 4 },
    })) as { hits: { code: string; signal: string }[]; quiet: string[]; scanned: number }
    expect(details.scanned).toBe(2)
    expect(details.hits).toContainEqual(
      expect.objectContaining({ code: "SH600519", signal: "buy" }),
    )
    expect(details.hits).toContainEqual(
      expect.objectContaining({ code: "SZ000001", signal: "sell" }),
    )
  })

  test("source=hot 扫描热榜", async () => {
    const details = (await runCross("screen_stocks", {
      strategy: "ma-cross",
      params: { fast: 2, slow: 4 },
      source: "hot",
    })) as { source: string; hits: { code: string }[] }
    expect(details.source).toBe("hot")
    expect(details.hits.map((hit) => hit.code)).toEqual(["SH600519"])
  })

  test("conditions 条件组合模式按 AND 筛选", async () => {
    const details = (await run("screen_stocks", {
      conditions: ["above_ma(period=3)", "pct_up(min=5)"],
    })) as {
      mode: string
      hits: { code: string }[]
      misses: string[]
    }
    expect(details.mode).toBe("conditions")
    // httpTrend：SH600519 末日 15 > 3 日均线且涨幅 7.1%；SZ000001 持续下跌不满足
    expect(details.hits.map((hit) => hit.code)).toEqual(["SH600519"])
    expect(details.misses).toEqual(["SZ000001"])
  })

  test("未知条件抛出错误并列出可选项", async () => {
    await expect(run("screen_stocks", { conditions: ["nope"] })).rejects.toThrow("rsi_oversold")
  })
})
