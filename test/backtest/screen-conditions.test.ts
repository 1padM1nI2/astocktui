import { describe, expect, test } from "bun:test"
import { createCondition } from "../../src/backtest/conditions"
import type { BacktestHttp } from "../../src/backtest/data"
import { screenByConditions } from "../../src/backtest/screen"

function httpWith(
  rowsByCode: Readonly<Record<string, readonly (readonly [number, number?])[]>>,
): BacktestHttp {
  return {
    fetch: async (input) => {
      const secid = /secid=[01]\.(\d{6})/u.exec(String(input))?.[1]
      const entry = Object.entries(rowsByCode).find(([code]) => code.endsWith(secid ?? ""))
      if (entry === undefined) return new Response("x", { status: 404 })
      const klines = entry[1].map(([close, volume], index) =>
        [
          `2024-02-${String(index + 1).padStart(2, "0")}`,
          close,
          close,
          close,
          close,
          volume ?? 0,
        ].join(","),
      )
      return new Response(JSON.stringify({ data: { klines } }), { status: 200 })
    },
  }
}

function mustConditions(specs: readonly [string, Record<string, number>?][]) {
  return specs.map(([name, params]) => {
    const condition = createCondition(name, params ?? {})
    if (condition === null) throw new Error(`条件创建失败：${name}`)
    return condition
  })
}

describe("screenByConditions", () => {
  test("AND 语义：全部条件满足才入选", async () => {
    const http = httpWith({
      // 站上 3 日均线且放量 → 入选
      SH600519: [
        [10, 100],
        [10, 100],
        [13, 300],
      ],
      // 站上均线但未放量 → 落选
      SZ000001: [
        [10, 100],
        [10, 100],
        [13, 120],
      ],
      // 放量但未站上均线 → 落选
      SZ300750: [
        [13, 100],
        [13, 100],
        [10, 300],
      ],
    })
    const result = await screenByConditions(
      http,
      1000,
      ["SH600519", "SZ000001", "SZ300750"],
      mustConditions([
        ["above_ma", { period: 3 }],
        ["volume_surge", { period: 2, ratio: 2 }],
      ]),
    )
    expect(result.failures).toEqual([])
    expect(result.hits).toEqual([{ code: "SH600519", close: 13, date: "2024-02-03" }])
    expect(result.misses).toEqual(["SZ000001", "SZ300750"])
  })

  test("单只数据失败不影响其他标的", async () => {
    const http = httpWith({
      SH600519: [
        [10, 100],
        [10, 100],
        [13, 300],
      ],
    })
    const result = await screenByConditions(
      http,
      1000,
      ["SH600519", "SZ000001"],
      mustConditions([["pct_up", { min: 5 }]]),
    )
    expect(result.hits.map((hit) => hit.code)).toEqual(["SH600519"])
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]?.code).toBe("SZ000001")
  })
})
