import { describe, expect, test } from "bun:test"
import {
  type BacktestHttp,
  eastmoneyDailySecid,
  fetchDailyKlines,
  parseDailyKlines,
} from "../../src/backtest/data"

function klineLine(
  date: string,
  open: number,
  close: number,
  high: number,
  low: number,
  volume: number,
): string {
  return `${date},${open},${close},${high},${low},${volume},0,0,0,0,0`
}

describe("eastmoneyDailySecid", () => {
  test("沪市代码映射到 1 市场", () => {
    expect(eastmoneyDailySecid("SH600519")).toBe("1.600519")
    expect(eastmoneyDailySecid("SH688981")).toBe("1.688981")
  })

  test("深市代码映射到 0 市场", () => {
    expect(eastmoneyDailySecid("SZ000001")).toBe("0.000001")
    expect(eastmoneyDailySecid("SZ300750")).toBe("0.300750")
  })

  test("非 A 股代码返回 null", () => {
    expect(eastmoneyDailySecid("US:AAPL")).toBeNull()
    expect(eastmoneyDailySecid("600519")).toBeNull()
  })
})

describe("parseDailyKlines", () => {
  test("解析日期 OHLC 与成交量", () => {
    const payload = {
      data: {
        klines: [klineLine("2024-01-02", 10, 10.5, 10.6, 9.9, 12345)],
      },
    }
    expect(parseDailyKlines(payload)).toEqual([
      { date: "2024-01-02", open: 10, close: 10.5, high: 10.6, low: 9.9, volume: 12345 },
    ])
  })

  test("丢弃非正价格与畸形行", () => {
    const payload = {
      data: {
        klines: [
          klineLine("2024-01-02", 10, 0, 10.6, 9.9, 100),
          klineLine("2024-01-03", 10, Number.NaN, 10.6, 9.9, 100),
          "bad-row",
          123,
          klineLine("2024-01-04", 10, 10.5, 10.6, 9.9, 100),
        ],
      },
    }
    const bars = parseDailyKlines(payload)
    expect(bars).toHaveLength(1)
    expect(bars[0]?.date).toBe("2024-01-04")
  })

  test("成交量缺失或为零时省略该字段", () => {
    const payload = { data: { klines: ["2024-01-02,10,10.5,10.6,9.9"] } }
    expect(parseDailyKlines(payload)).toEqual([
      { date: "2024-01-02", open: 10, close: 10.5, high: 10.6, low: 9.9 },
    ])
  })

  test("畸形载荷返回空数组", () => {
    expect(parseDailyKlines(null)).toEqual([])
    expect(parseDailyKlines({ data: null })).toEqual([])
    expect(parseDailyKlines({ data: { klines: "nope" } })).toEqual([])
  })
})

describe("fetchDailyKlines", () => {
  function httpWith(payload: unknown, captured?: { url?: string }): BacktestHttp {
    return {
      fetch: async (input) => {
        if (captured !== undefined) captured.url = String(input)
        return new Response(JSON.stringify(payload), { status: 200 })
      },
    }
  }

  test("拼接前复权日K地址并解析结果", async () => {
    const captured: { url?: string } = {}
    const payload = { data: { klines: [klineLine("2024-01-02", 10, 10.5, 10.6, 9.9, 100)] } }
    const bars = await fetchDailyKlines(httpWith(payload, captured), 1000, "SH600519", 250)
    expect(bars).toHaveLength(1)
    expect(captured.url).toContain("secid=1.600519")
    expect(captured.url).toContain("klt=101")
    expect(captured.url).toContain("fqt=1")
    expect(captured.url).toContain("lmt=250")
  })

  test("非 A 股代码抛出错误", async () => {
    await expect(fetchDailyKlines(httpWith({}), 1000, "US:AAPL", 10)).rejects.toThrow("A股")
  })

  test("HTTP 失败抛出带状态码的错误", async () => {
    const http: BacktestHttp = { fetch: async () => new Response("x", { status: 503 }) }
    await expect(fetchDailyKlines(http, 1000, "SZ000001", 10)).rejects.toThrow("503")
  })

  test("响应无 K 线数据时返回空数组", async () => {
    const bars = await fetchDailyKlines(httpWith({ data: null }), 1000, "SZ000001", 10)
    expect(bars).toEqual([])
  })
})
