import { describe, expect, test } from "bun:test"
import type { Agent, AgentMessage } from "@oh-my-pi/pi-agent-core"
import {
  compactConversation,
  estimatePromptTokens,
  shouldProactiveCompact,
} from "../../src/agent/context-compaction"
import type { AgentDriverEvent } from "../../src/agent/controller"

function msg(value: unknown): AgentMessage {
  return value as AgentMessage
}

function assistantWithUsage(input: number, cacheRead = 0): AgentMessage {
  return msg({
    role: "assistant",
    stopReason: "stop",
    content: [{ type: "text", text: "回答" }],
    usage: {
      input,
      output: 10,
      cacheRead,
      cacheWrite: 0,
      totalTokens: input + cacheRead + 10,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  })
}

describe("prompt token 估算", () => {
  test("优先采用最后一条 assistant 的真实 usage（含缓存命中部分）", () => {
    const tokens = estimatePromptTokens([
      msg({ role: "user", content: "问题" }),
      assistantWithUsage(3000, 5000),
    ])
    expect(tokens).toBe(8000)
  })

  test("没有可用 usage 时按内容字符数粗估", () => {
    const tokens = estimatePromptTokens([
      msg({ role: "user", content: "a".repeat(200), timestamp: 1 }),
    ])
    expect(tokens).toBeGreaterThan(0)
    expect(tokens).toBeLessThanOrEqual(200)
  })

  test("空对话为 0", () => {
    expect(estimatePromptTokens([])).toBe(0)
  })

  test("零 usage 按缺失处理，不把估算钉死在 0（09-03 11:15 400 回归）", () => {
    const zeroUsage = msg({
      role: "assistant",
      stopReason: "stop",
      content: [{ type: "thinking", thinking: "思考" }],
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    })
    const tokens = estimatePromptTokens([
      msg({ role: "user", content: "盘".repeat(95_000), timestamp: 1 }),
      zeroUsage,
    ])
    expect(tokens).toBeGreaterThan(55_705)
  })

  test("usage 滞后于当前上下文时取较大者（09-03 10:45 400 回归）", () => {
    const tokens = estimatePromptTokens([
      assistantWithUsage(50_000),
      msg({ role: "user", content: "盘".repeat(95_000), timestamp: 1 }),
    ])
    expect(tokens).toBeGreaterThan(50_000)
  })
})

describe("主动压缩触发判断", () => {
  test("达到窗口 70% 触发，未达不触发", () => {
    const messages = [assistantWithUsage(8000, 1000)]
    expect(shouldProactiveCompact(messages, 11_000)).toBe(true)
    expect(shouldProactiveCompact(messages, 14_000)).toBe(false)
  })

  test("CJK 密集内容达真实窗口 70% 触发（chars/2 会漏判）", () => {
    const messages = [msg({ role: "user", content: "盘".repeat(95_000), timestamp: 1 })]
    expect(shouldProactiveCompact(messages, 65_536)).toBe(true)
  })

  test("上下文窗口未知时不触发", () => {
    const messages = [assistantWithUsage(9000)]
    expect(shouldProactiveCompact(messages, null)).toBe(false)
    expect(shouldProactiveCompact(messages, undefined)).toBe(false)
  })
})

describe("主动压缩保留最近回合", () => {
  function stubAgent(messages: AgentMessage[]) {
    return {
      state: { messages: [...messages] },
      replaced: undefined as AgentMessage[] | undefined,
      replaceMessages(next: AgentMessage[]) {
        this.replaced = next
        this.state.messages = next
      },
    }
  }

  const older = [
    msg({ role: "user", content: "早先问题", timestamp: 1 }),
    msg({
      role: "assistant",
      stopReason: "stop",
      content: [{ type: "text", text: "早先回答" }],
      timestamp: 2,
    }),
  ]
  const tail = [
    msg({ role: "user", content: "最近问题", timestamp: 3 }),
    msg({
      role: "assistant",
      stopReason: "stop",
      content: [{ type: "text", text: "最近回答" }],
      timestamp: 4,
    }),
  ]

  test("较早对话压缩为摘要，最近回合原文保留", async () => {
    const agent = stubAgent([...older, ...tail])
    const notices: string[] = []
    const compacted = await compactConversation(
      agent as unknown as Agent,
      async () => "较早对话摘要",
      (event: AgentDriverEvent) => {
        if (event.type === "tool_end") notices.push(event.summary)
      },
    )
    expect(compacted).toBe(true)
    expect(agent.state.messages).toHaveLength(3)
    expect(agent.state.messages[0]?.role).toBe("user")
    expect(JSON.stringify(agent.state.messages[0])).toContain("较早对话摘要")
    expect(agent.state.messages[1]).toEqual(tail[0])
    expect(agent.state.messages[2]).toEqual(tail[1])
    expect(notices[0]).toContain("已压缩")
  })

  test("没有更早内容可压缩时不动作", async () => {
    const agent = stubAgent(tail)
    const compacted = await compactConversation(
      agent as unknown as Agent,
      async () => "摘要",
      () => {},
    )
    expect(compacted).toBe(false)
    expect(agent.replaced).toBeUndefined()
  })

  test("摘要不可用时不改动历史（保留超限重试兜底）", async () => {
    const agent = stubAgent([...older, ...tail])
    const compacted = await compactConversation(
      agent as unknown as Agent,
      async () => {
        throw new Error("模型不可用")
      },
      () => {},
    )
    expect(compacted).toBe(false)
    expect(agent.replaced).toBeUndefined()
  })
})
