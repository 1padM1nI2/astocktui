import { expect, test } from "bun:test"
import { SYSTEM_PROMPT } from "../src/pi-agent-prompt"

const prompt = SYSTEM_PROMPT.join("\n")

test("系统提示说明全球（美/日/韩）行情代码格式与查询路径", () => {
  expect(prompt).toContain("US:")
  expect(prompt).toContain("JP:")
  expect(prompt).toContain("KR:")
  expect(prompt).toContain("US:AAPL")
  expect(prompt).toContain("manage_watchlist")
  expect(prompt).toContain("get_market_snapshot")
})

test("系统提示限定全球行情仅用于分析，模拟交易仅限 A 股", () => {
  expect(prompt).toMatch(/全球.*(仅|只).*(分析|参考)/u)
  expect(prompt).toMatch(/(模拟交易|买卖).*(仅|只).*A 股/u)
})
