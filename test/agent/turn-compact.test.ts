import { describe, expect, test } from "bun:test"
import type { AgentMessage } from "@oh-my-pi/pi-agent-core"
import {
  compactCurrentTurn,
  estimateTurnBoundaryTokens,
  shouldCompactAtTurnBoundary,
} from "../../src/agent/turn-compact"

function msg(value: unknown): AgentMessage {
  return value as AgentMessage
}

const systemPrompt = ["你是 AStock 分析助手"]

describe("回合边界上下文估算", () => {
  test("空对话按系统提示字符数粗估", () => {
    expect(estimateTurnBoundaryTokens([], ["x".repeat(200)])).toBe(120)
  })

  test("统计全部消息字符数，不依赖 usage（无回合滞后）", () => {
    const messages = [
      msg({ role: "user", content: "问题", timestamp: 1 }),
      msg({
        role: "tool",
        toolCallId: "t1",
        content: [{ type: "text", text: "y".repeat(1000) }],
        isError: false,
        timestamp: 2,
      }),
    ]
    expect(estimateTurnBoundaryTokens(messages, systemPrompt)).toBeGreaterThan(500)
  })
})

describe("回合边界压缩触发判断", () => {
  test("达到窗口 70% 触发，未达不触发", () => {
    const messages = [
      msg({
        role: "tool",
        toolCallId: "t1",
        content: [{ type: "text", text: "z".repeat(90_000) }],
        isError: false,
        timestamp: 1,
      }),
    ]
    const estimate = estimateTurnBoundaryTokens(messages, systemPrompt)
    expect(shouldCompactAtTurnBoundary(messages, systemPrompt, estimate)).toBe(true)
    // 70% 触发比例：窗口取 floor(estimate/0.7) 即应触发（0.85 比例下不触发）
    expect(
      shouldCompactAtTurnBoundary(messages, systemPrompt, Math.floor(estimate / 0.7)),
    ).toBe(true)
    expect(
      shouldCompactAtTurnBoundary(messages, systemPrompt, Math.ceil(estimate / 0.7) + 2),
    ).toBe(false)
  })

  test("CJK 密集内容达真实窗口 70% 触发（chars/2 会漏判）", () => {
    const messages = [
      msg({
        role: "tool",
        toolCallId: "t1",
        content: [{ type: "text", text: "盘".repeat(95_000) }],
        isError: false,
        timestamp: 1,
      }),
    ]
    expect(shouldCompactAtTurnBoundary(messages, systemPrompt, 65_536)).toBe(true)
  })

  test("上下文窗口未知时不触发", () => {
    const messages = [msg({ role: "user", content: "a".repeat(100_000), timestamp: 1 })]
    expect(shouldCompactAtTurnBoundary(messages, systemPrompt, null)).toBe(false)
    expect(shouldCompactAtTurnBoundary(messages, systemPrompt, undefined)).toBe(false)
  })
})

describe("当前回合压缩", () => {
  const pendingUser = msg({ role: "user", content: "分析今天行情", timestamp: 1 })
  const assistantTurn = msg({
    role: "assistant",
    stopReason: "stop",
    content: [{ type: "toolCall", id: "c1", name: "query", arguments: {} }],
    timestamp: 2,
  })
  const toolResult = msg({
    role: "tool",
    toolCallId: "c1",
    content: [{ type: "text", text: "z".repeat(50_000) }],
    isError: false,
    timestamp: 3,
  })

  test("压缩当前回合工具结果为摘要，保留 [摘要, 待处理用户消息]", async () => {
    const messages = [pendingUser, assistantTurn, toolResult]
    const notices: Record<string, unknown>[] = []
    const compacted = await compactCurrentTurn({
      messages,
      summarize: async (target) => {
        expect(target).toHaveLength(2)
        expect(target).toEqual([assistantTurn, toolResult])
        return "摘要：已查询行情数据"
      },
      onDebug: (_kind, fields) => notices.push(fields),
    })
    expect(compacted).toBe(true)
    expect(messages).toHaveLength(2)
    expect(messages[1]).toEqual(pendingUser)
    expect(messages[0]?.role).toBe("user")
    expect(JSON.stringify(messages[0])).toContain("摘要：已查询行情数据")
    expect(notices[0]?.["summarizedMessages"]).toBe(2)
    expect(Number(notices[0]?.["releasedChars"])).toBeGreaterThan(0)
  })

  test("较早回合与当前回合一起纳入摘要目标", async () => {
    const older = [
      msg({ role: "user", content: "早先问题", timestamp: 0 }),
      msg({
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: "早先回答" }],
        timestamp: 1,
      }),
    ]
    const messages = [...older, pendingUser, assistantTurn, toolResult]
    let target: readonly AgentMessage[] = []
    const compacted = await compactCurrentTurn({
      messages,
      summarize: async (value) => {
        target = value
        return "整体摘要"
      },
    })
    expect(compacted).toBe(true)
    expect(target).toHaveLength(4)
    expect(messages).toHaveLength(2)
    expect(messages[0]?.role).toBe("user")
    expect(JSON.stringify(messages[0])).toContain("整体摘要")
    expect(messages[1]).toEqual(pendingUser)
  })

  test("没有待处理用户消息时不动作", async () => {
    const messages = [assistantTurn, toolResult]
    const compacted = await compactCurrentTurn({
      messages,
      summarize: async () => {
        throw new Error("不应被调用")
      },
    })
    expect(compacted).toBe(false)
    expect(messages).toHaveLength(2)
  })

  test("用户消息后没有新内容时不动作", async () => {
    const messages = [pendingUser]
    const compacted = await compactCurrentTurn({
      messages,
      summarize: async () => {
        throw new Error("不应被调用")
      },
    })
    expect(compacted).toBe(false)
    expect(messages).toHaveLength(1)
  })

  test("摘要失败时不改动数组（保留超限重试兜底）", async () => {
    const messages = [pendingUser, assistantTurn, toolResult]
    const compacted = await compactCurrentTurn({
      messages,
      summarize: async () => {
        throw new Error("模型不可用")
      },
    })
    expect(compacted).toBe(false)
    expect(messages).toHaveLength(3)
  })

  test("摘要为空时不改动数组", async () => {
    const messages = [pendingUser, assistantTurn, toolResult]
    const compacted = await compactCurrentTurn({
      messages,
      summarize: async () => "  ",
    })
    expect(compacted).toBe(false)
    expect(messages).toHaveLength(3)
  })

  test("跳过临时续写指令，保留真正的用户消息", async () => {
    const transient = msg({
      role: "user",
      content: [{ type: "text", text: "[系统] 续写指令" }],
      timestamp: 3,
      transientContinuation: true,
    })
    const messages = [pendingUser, assistantTurn, toolResult, transient]
    const compacted = await compactCurrentTurn({
      messages,
      summarize: async () => "摘要",
    })
    expect(compacted).toBe(true)
    expect(messages).toHaveLength(2)
    expect(messages[1]).toEqual(pendingUser)
  })
})

describe("摘要目标超窗收缩", () => {
  const pendingUser = msg({ role: "user", content: "分析今天行情", timestamp: 1 })
  const bigToolResult = msg({
    role: "tool",
    toolCallId: "c1",
    content: [{ type: "text", text: "z".repeat(130_000) }],
    isError: false,
    timestamp: 3,
  })

  test("摘要目标自身超窗口时收缩可见文本再摘要（摘要请求装得下）", async () => {
    const messages = [pendingUser, bigToolResult]
    let seen: readonly AgentMessage[] = []
    const compacted = await compactCurrentTurn({
      messages,
      contextWindow: 65_536,
      summarize: async (target) => {
        seen = target
        return "摘要：已查询行情数据"
      },
    })
    expect(compacted).toBe(true)
    expect(seen).toHaveLength(1)
    const part = (seen[0] as { content: { type?: string; text?: string }[] })?.content?.[0]
    expect(part?.text).toBeDefined()
    // 收缩到能装进窗口：远小于原文 130000，但保留了前缀与截断标记
    expect(part?.text?.length ?? 0).toBeLessThan(20_000)
    expect(part?.text?.length ?? 0).toBeGreaterThan(10_000)
    expect(part?.text?.startsWith("z".repeat(10_000))).toBe(true)
    expect(part?.text).toContain("[摘要前截断]")
    // 原消息对象不被改写（实时数组被替换后原对象仍保持完整）
    expect(JSON.stringify(bigToolResult).length).toBeGreaterThan(120_000)
  })

  test("摘要目标装得进窗口时不截断（完整交给摘要器）", async () => {
    const smallToolResult = msg({
      role: "tool",
      toolCallId: "c1",
      content: [{ type: "text", text: "z".repeat(50_000) }],
      isError: false,
      timestamp: 3,
    })
    const messages = [pendingUser, smallToolResult]
    let seen: readonly AgentMessage[] = []
    const compacted = await compactCurrentTurn({
      messages,
      contextWindow: 65_536,
      summarize: async (target) => {
        seen = target
        return "摘要：已查询行情数据"
      },
    })
    expect(compacted).toBe(true)
    const part = (seen[0] as { content: { type?: string; text?: string }[] })?.content?.[0]
    expect(part?.text).toBe("z".repeat(50_000))
  })
})
