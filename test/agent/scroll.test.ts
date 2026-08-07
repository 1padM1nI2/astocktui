import { expect, test } from "bun:test"
import { AgentScrollState } from "../../src/agent/scroll"

test("Agent 翻页支持应用光标模式的上下键", () => {
  const scroll = new AgentScrollState(() => 16)
  scroll.recordRender(80)

  expect(scroll.handleInput("\x1bOA")).toBe(true)
  expect(scroll.offset).toBe(1)

  expect(scroll.handleInput("\x1bOB")).toBe(true)
  expect(scroll.offset).toBe(0)
})
