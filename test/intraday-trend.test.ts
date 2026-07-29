import { expect, test } from "bun:test"
import { parseTencentMinuteTrend } from "../src/intraday-trend"

test("解析腾讯分时数据为当天分钟价格序列", () => {
  const payload = {
    data: {
      date: "20260727",
      data: ["0930 1492.00 1234", "0931 1490.50 2345", "0932 1495.80 1567", "1500 1499.00 9000"],
    },
  }

  expect(parseTencentMinuteTrend(payload)).toEqual([1492, 1490.5, 1495.8, 1499])
})

test("忽略缺失结构和非法价格", () => {
  expect(parseTencentMinuteTrend(undefined)).toEqual([])
  expect(parseTencentMinuteTrend({})).toEqual([])
  expect(parseTencentMinuteTrend({ data: { data: "oops" } })).toEqual([])
  expect(parseTencentMinuteTrend({ data: { data: ["0930 -1 0", "0931 abc 0", 42] } })).toEqual([])
})
