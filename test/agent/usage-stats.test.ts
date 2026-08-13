import { describe, expect, test } from "bun:test"
import type { AgentMessage } from "@oh-my-pi/pi-agent-core"
import {
  createUsageStats,
  formatUsageSummary,
  recordStepUsage,
  type UsageStats,
  usageFromMessage,
} from "../../src/agent/usage-stats"

function usage(input: number, output: number, cacheRead = 0, cacheWrite = 0) {
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

describe("Agent usage 统计", () => {
  test("初始为零且命中率为 null", () => {
    const stats = createUsageStats()
    expect(stats.steps).toBe(0)
    expect(stats.promptTokens).toBe(0)
    expect(stats.outputTokens).toBe(0)
    expect(stats.cacheReadTokens).toBe(0)
    expect(stats.cacheHitRate).toBeNull()
  })

  test("累计多步的输入、输出与缓存命中 token", () => {
    let stats: UsageStats = createUsageStats()
    stats = recordStepUsage(stats, usage(1000, 200, 4000))
    stats = recordStepUsage(stats, usage(500, 100, 5000, 300))
    expect(stats.steps).toBe(2)
    expect(stats.promptTokens).toBe(1000 + 4000 + 500 + 5000 + 300)
    expect(stats.outputTokens).toBe(300)
    expect(stats.cacheReadTokens).toBe(9000)
  })

  test("缓存命中率按 cacheRead / prompt 总量计算", () => {
    let stats = recordStepUsage(createUsageStats(), usage(1000, 100, 3000))
    expect(stats.cacheHitRate).toBeCloseTo(0.75)
    stats = recordStepUsage(stats, usage(4000, 100))
    expect(stats.cacheHitRate).toBeCloseTo(3000 / 8000)
  })

  test("不可变：record 不修改原对象", () => {
    const before = createUsageStats()
    recordStepUsage(before, usage(100, 10))
    expect(before.steps).toBe(0)
  })
})

describe("usage 摘要格式化", () => {
  test("无数据时返回空串", () => {
    expect(formatUsageSummary(createUsageStats())).toBe("")
  })

  test("展示命中率、输入、输出与步数", () => {
    let stats = recordStepUsage(createUsageStats(), usage(2000, 500, 6000))
    stats = recordStepUsage(stats, usage(2000, 500, 6000))
    const summary = formatUsageSummary(stats)
    expect(summary).toContain("缓存命中 75%")
    expect(summary).toContain("输入 16.0k")
    expect(summary).toContain("输出 1.0k")
    expect(summary).toContain("2 步")
  })

  test("命中率四舍五入到整数百分比", () => {
    const stats = recordStepUsage(createUsageStats(), usage(666, 1, 333))
    expect(formatUsageSummary(stats)).toContain("缓存命中 33%")
  })
})

describe("从消息提取 usage", () => {
  test("正常结束的 assistant 消息返回 usage", () => {
    const message = {
      role: "assistant",
      stopReason: "stop",
      usage: usage(100, 20, 300),
    } as unknown as AgentMessage
    expect(usageFromMessage(message)).toMatchObject({ input: 100, output: 20, cacheRead: 300 })
  })

  test("工具调用收尾的 assistant 消息同样计入", () => {
    const message = {
      role: "assistant",
      stopReason: "toolUse",
      usage: usage(50, 10),
    } as unknown as AgentMessage
    expect(usageFromMessage(message)).toBeDefined()
  })

  test("错误或中止的 assistant 消息不计入", () => {
    for (const stopReason of ["error", "aborted"]) {
      const message = {
        role: "assistant",
        stopReason,
        usage: usage(50, 10),
      } as unknown as AgentMessage
      expect(usageFromMessage(message)).toBeUndefined()
    }
  })

  test("非 assistant 消息返回 undefined", () => {
    const message = { role: "user", content: "你好" } as unknown as AgentMessage
    expect(usageFromMessage(message)).toBeUndefined()
  })
})
