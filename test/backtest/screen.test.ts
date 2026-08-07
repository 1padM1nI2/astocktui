import { describe, expect, test } from "bun:test"
import type { BacktestHttp } from "../../src/backtest/data"
import { screenStocks } from "../../src/backtest/screen"
import { createStrategy } from "../../src/backtest/strategy"

function httpWith(closesByCode: Readonly<Record<string, readonly number[]>>): BacktestHttp {
  return {
    fetch: async (input) => {
      const url = String(input)
      const secid = /secid=[01]\.(\d{6})/u.exec(url)?.[1]
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

describe("screenStocks", () => {
  const strategy = createStrategy("ma-cross", { fast: 2, slow: 4 })
  if (strategy === null) throw new Error("策略创建失败")

  test("识别末日金叉买入与死叉卖出信号", async () => {
    const http = httpWith({
      SH600519: [10, 9, 8, 7, 6, 12], // 末日金叉 → buy
      SZ000001: [7, 8, 9, 10, 11, 6], // 末日死叉 → sell
      SZ300750: [10, 10, 10, 10, 10, 10], // 无交叉 → 无信号
    })
    const result = await screenStocks(http, 1000, ["SH600519", "SZ000001", "SZ300750"], strategy)
    expect(result.failures).toEqual([])
    expect(result.hits).toEqual([
      { code: "SH600519", signal: "buy", close: 12, date: "2024-02-06" },
      { code: "SZ000001", signal: "sell", close: 6, date: "2024-02-06" },
    ])
    expect(result.quiet).toEqual(["SZ300750"])
  })

  test("数据不足或请求失败计入 failures，不影响其他代码", async () => {
    const http = httpWith({ SH600519: [10, 11] })
    const result = await screenStocks(http, 1000, ["SH600519", "SZ000001"], strategy)
    expect(result.hits).toEqual([])
    expect(result.failures).toHaveLength(2)
    expect(result.failures[0]?.code).toBe("SH600519")
    expect(result.failures[0]?.error).toContain("不足")
  })
})
