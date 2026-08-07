import { describe, expect, test } from "bun:test"
import { visibleWidth } from "@oh-my-pi/pi-tui"
import {
  type BatchBacktestHttp,
  renderBatchReport,
  runBatchBacktest,
} from "../../src/backtest/batch"
import { createStrategy } from "../../src/backtest/strategy"

function httpWith(closesByCode: Readonly<Record<string, readonly number[]>>): BatchBacktestHttp {
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

const strategy = createStrategy("ma-cross", { fast: 2, slow: 4 })
if (strategy === null) throw new Error("策略创建失败")

describe("runBatchBacktest", () => {
  test("逐代码回测并按总收益率降序排列", async () => {
    const http = httpWith({
      SH600519: [10, 9, 8, 7, 12, 13, 14, 15],
      SZ000001: [15, 14, 13, 12, 11, 10, 9, 8],
    })
    const rows = await runBatchBacktest(http, 1000, ["SZ000001", "SH600519"], strategy, {
      initialCapital: 100_000,
    })
    expect(rows).toHaveLength(2)
    expect(rows[0]?.code).toBe("SH600519")
    expect(rows[0]?.metrics?.totalReturn ?? 0).toBeGreaterThan(rows[1]?.metrics?.totalReturn ?? 0)
  })

  test("单只失败不影响其他代码", async () => {
    const http = httpWith({ SH600519: [10, 9, 8, 7, 12, 13, 14, 15] })
    const rows = await runBatchBacktest(http, 1000, ["SH600519", "SZ000001"], strategy, {
      initialCapital: 100_000,
    })
    expect(rows).toHaveLength(2)
    const failed = rows.find((row) => row.code === "SZ000001")
    expect(failed?.metrics).toBeNull()
    expect(failed?.error).toContain("404")
    expect(rows.find((row) => row.code === "SH600519")?.metrics).not.toBeNull()
  })

  test("历史数据不足标记为错误", async () => {
    const http = httpWith({ SH600519: [10, 11] })
    const rows = await runBatchBacktest(http, 1000, ["SH600519"], strategy, {})
    expect(rows[0]?.metrics).toBeNull()
    expect(rows[0]?.error).toContain("不足")
  })
})

describe("renderBatchReport", () => {
  test("输出表头与每只代码一行，失败标记原因", async () => {
    const http = httpWith({
      SH600519: [10, 9, 8, 7, 12, 13, 14, 15],
      SZ000001: [15, 14, 13, 12, 11, 10, 9, 8],
    })
    const rows = await runBatchBacktest(http, 1000, ["SH600519", "SZ000001"], strategy, {
      initialCapital: 100_000,
    })
    const lines = renderBatchReport(strategy, 250, rows)
    const text = lines.join("\n")
    expect(text).toContain("代码")
    expect(text).toContain("总收益")
    expect(text).toContain("SH600519")
    expect(text).toContain("SZ000001")
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(80)
  })
})
