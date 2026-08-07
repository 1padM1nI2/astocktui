import { describe, expect, test } from "bun:test"
import type { AgentMessage } from "@oh-my-pi/pi-agent-core"
import { messagesToExchanges } from "../src/agent/agent-history"

function msg(value: unknown): AgentMessage {
  return value as AgentMessage
}

describe("历史消息转换为问答视图", () => {
  test("用户提问、助手回答与工具调用聚合为一轮问答", () => {
    const exchanges = messagesToExchanges([
      msg({ role: "user", content: "分析贵州茅台", timestamp: 1 }),
      msg({
        role: "assistant",
        content: [
          { type: "text", text: "先读取行情。" },
          { type: "toolCall", id: "c1", name: "get_market_snapshot", arguments: {} },
        ],
        timestamp: 2,
      }),
      msg({
        role: "toolResult",
        toolCallId: "c1",
        toolName: "get_market_snapshot",
        content: [{ type: "text", text: "行情数据" }],
        isError: false,
        timestamp: 3,
      }),
      msg({
        role: "assistant",
        content: [{ type: "text", text: "贵州茅台偏强。" }],
        timestamp: 4,
      }),
    ])

    expect(exchanges).toEqual([
      {
        user: "分析贵州茅台",
        answer: "先读取行情。\n\n贵州茅台偏强。",
        tools: [
          {
            id: "c1",
            name: "get_market_snapshot",
            label: "get_market_snapshot",
            status: "completed",
            summary: "行情数据",
          },
        ],
      },
    ])
  })

  test("工具标签使用中文名且失败工具保留错误状态", () => {
    const exchanges = messagesToExchanges(
      [
        msg({ role: "user", content: "创建任务", timestamp: 1 }),
        msg({
          role: "assistant",
          content: [{ type: "toolCall", id: "c1", name: "manage_scheduled_task", arguments: {} }],
          timestamp: 2,
        }),
        msg({
          role: "toolResult",
          toolCallId: "c1",
          toolName: "manage_scheduled_task",
          content: [{ type: "text", text: "Validation failed" }],
          isError: true,
          timestamp: 3,
        }),
      ],
      (name) => (name === "manage_scheduled_task" ? "管理定时任务" : name),
    )

    expect(exchanges[0]?.tools).toEqual([
      {
        id: "c1",
        name: "manage_scheduled_task",
        label: "管理定时任务",
        status: "error",
        summary: "Validation failed",
      },
    ])
  })

  test("多轮问答按用户消息切分且数组内容拼接文本块", () => {
    const exchanges = messagesToExchanges([
      msg({ role: "user", content: [{ type: "text", text: "第一问" }], timestamp: 1 }),
      msg({ role: "assistant", content: [{ type: "text", text: "第一答" }], timestamp: 2 }),
      msg({ role: "user", content: "第二问", timestamp: 3 }),
      msg({ role: "assistant", content: [{ type: "text", text: "第二答" }], timestamp: 4 }),
    ])

    expect(exchanges).toEqual([
      { user: "第一问", answer: "第一答", tools: [] },
      { user: "第二问", answer: "第二答", tools: [] },
    ])
  })

  test("空提问与非对话消息不产生问答", () => {
    const exchanges = messagesToExchanges([
      msg({ role: "developer", content: "系统注入", timestamp: 1 }),
      msg({ role: "assistant", content: [{ type: "text", text: "没有用户的回答" }], timestamp: 2 }),
      msg({ role: "user", content: "   ", timestamp: 3 }),
    ])

    expect(exchanges).toEqual([])
  })
})
