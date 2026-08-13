import { describe, expect, test } from "bun:test"
import type { AgentToolResult } from "@oh-my-pi/pi-agent-core"
import { jsonToolResult, TOOL_RESULT_TEXT_MAX } from "../../src/agent/tool-result"

function textOf(result: AgentToolResult<unknown>): string {
  const block = result.content[0]
  if (block?.type !== "text") throw new Error("预期文本内容块")
  return block.text
}

describe("工具结果入口约束", () => {
  test("普通结果原样序列化，details 与 content 一致", () => {
    const value = { code: "SH600519", price: 1680 }
    const result = jsonToolResult(value)
    expect(textOf(result)).toBe(JSON.stringify(value))
    expect(result.details).toBe(value)
  })

  test("超过上限的结果在进入上下文前一次性截断并带标记", () => {
    const value = { items: ["x".repeat(TOOL_RESULT_TEXT_MAX)] }
    const result = jsonToolResult(value)
    const text = textOf(result)
    expect(text.length).toBeLessThanOrEqual(TOOL_RESULT_TEXT_MAX + 64)
    expect(text).toContain("已截断")
  })

  test("截断只影响模型可见文本，details 保留完整数据", () => {
    const value = { items: ["x".repeat(TOOL_RESULT_TEXT_MAX)] }
    const result = jsonToolResult(value)
    expect(result.details).toBe(value)
  })

  test("恰好在边界内的结果不截断", () => {
    const value = { data: "y".repeat(100) }
    expect(textOf(jsonToolResult(value))).toBe(JSON.stringify(value))
  })
})
