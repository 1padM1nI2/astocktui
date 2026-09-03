import { describe, expect, test } from "bun:test"
import type { AgentMessage } from "@oh-my-pi/pi-agent-core"
import {
  estimateMessagesTokens,
  estimateTextTokens,
  TEXT_TOKENS_PER_CHAR,
} from "../../src/agent/token-estimate"

function msg(value: unknown): AgentMessage {
  return value as AgentMessage
}

describe("token 字符估算（本地分词器校准）", () => {
  test("系数在实测区间内（0.58~0.70 token/字符）", () => {
    expect(TEXT_TOKENS_PER_CHAR).toBeGreaterThanOrEqual(0.58)
    expect(TEXT_TOKENS_PER_CHAR).toBeLessThan(0.7)
  })

  test("CJK 密集内容不被低估（chars/2 会漏判）", () => {
    const text = "中国平安 58.39 元，涨幅 3.11%，成交 67.3 万手。碳酸锂、锂矿、黄金、电力。".repeat(
      2000,
    )
    const est = estimateTextTokens(text)
    expect(est).toBeGreaterThan(text.length / 2)
    expect(est).toBeGreaterThanOrEqual(text.length * 0.58)
    expect(est).toBeLessThanOrEqual(text.length * 0.7)
  })

  test("空内容为 0", () => {
    expect(estimateTextTokens("")).toBe(0)
    expect(estimateMessagesTokens([])).toBe(0)
  })

  test("消息估算包含系统提示", () => {
    expect(estimateMessagesTokens([], ["x".repeat(100)])).toBe(60)
    expect(
      estimateMessagesTokens([msg({ role: "user", content: "x".repeat(100), timestamp: 1 })], []),
    ).toBeGreaterThan(60)
  })
})
