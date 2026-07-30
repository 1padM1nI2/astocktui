import { expect, test } from "bun:test"
import { createTencentIntradayTrendFetcher, parseTencentMinuteTrend } from "../src/intraday-trend"

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

test("腾讯分时请求超时后该只回退为空而不是永久挂起", async () => {
  // Bun 下 AbortSignal.timeout 的内部定时器是 unref 的；测试进程无其它活跃句柄时
  // 事件循环会休眠导致 abort 不触发，这里用一个引用的定时器保持事件循环运转
  const keepAlive = setInterval(() => {}, 10)
  try {
    const fetcher = createTencentIntradayTrendFetcher({
      fetchImpl: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation timed out", "TimeoutError")),
          )
        }),
      timeoutMs: 20,
    })

    const trends = await fetcher(["SH600519"])

    expect(trends.get("SH600519")).toEqual([])
  } finally {
    clearInterval(keepAlive)
  }
})
