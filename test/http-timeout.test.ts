import { describe, expect, test } from "bun:test"
import { withTimeout } from "../src/http-timeout"

describe("withTimeout", () => {
  test("按时 resolve 时透传原值", async () => {
    await expect(withTimeout(Promise.resolve(42), 50, "测试")).resolves.toBe(42)
  })

  test("原 promise 拒绝时透传原错误", async () => {
    await expect(withTimeout(Promise.reject(new Error("boom")), 50, "测试")).rejects.toThrow("boom")
  })

  test("永不 settle 的 promise 按毫秒数超时拒绝", async () => {
    const never = new Promise<number>(() => {})
    await expect(withTimeout(never, 20, "行情请求")).rejects.toThrow("行情请求 超时")
  })
})
