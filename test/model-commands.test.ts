import { expect, test } from "bun:test"
import type { AgentModelSwitcher, AgentThinkingControl } from "../src/agent/agent-controller"
import type { CommandContext, CommandResult } from "../src/commands/commands"
import { MODEL_COMMANDS } from "../src/commands/model-commands"

function contextWith(
  switcher: AgentModelSwitcher | undefined,
  thinking?: AgentThinkingControl,
): CommandContext {
  return {
    focus: () => {},
    refresh: () => ({ market: "skipped", news: "skipped" }),
    refreshAndWait: async () => {},
    quit: () => {},
    clearAgent: () => {},
    marketOverview: async () => {
      throw new Error("未实现")
    },
    status: () => ({
      activeWorkspace: "agent",
      market: { state: "idle", source: null },
      news: { state: "idle", source: null },
      agent: "ready",
    }),
    marketSnapshot: () => null,
    newsSnapshot: () => null,
    portfolio: () => ({ initialCapital: 100_000, cash: 100_000, positions: [] }),
    quote: async () => undefined,
    trading: () => {
      throw new Error("未实现")
    },
    portfolioChanged: () => {},
    watchlist: () => [],
    changeWatchlist: async () => ({ ok: false, code: "", message: "未实现" }),
    agentModel: () => switcher,
    agentThinking: () => thinking,
  }
}

function run(context: CommandContext, input: string): CommandResult {
  const name = input.split(/\s+/)[0]?.slice(1)
  const command = MODEL_COMMANDS.find((candidate) => candidate.name === name)
  if (command === undefined) throw new Error(`命令未注册：${input}`)
  const result = command.execute(context, input.split(/\s+/).slice(1))
  if (result instanceof Promise) throw new Error("预期同步命令")
  return result
}

test("/model 列出链上模型并标记当前", () => {
  const switcher: AgentModelSwitcher = {
    current: () => "openai/m1",
    list: () => ["openai/m1", "deepseek/m2"],
    select: () => {
      throw new Error("不应调用")
    },
  }
  const result = run(contextWith(switcher), "/model")
  expect(result.title).toBe("模型")
  expect(result.lines.join("\n")).toContain("1. openai/m1（当前）")
  expect(result.lines.join("\n")).toContain("2. deepseek/m2")
})

test("/model 2 切换到第二个模型，无效目标报错", () => {
  const selected: string[] = []
  const switcher: AgentModelSwitcher = {
    current: () => (selected.length === 0 ? "openai/m1" : "deepseek/m2"),
    list: () => ["openai/m1", "deepseek/m2"],
    select: (target) => {
      if (target === "bad") throw new Error("无效模型：bad")
      selected.push(target)
      return "deepseek/m2"
    },
  }
  const context = contextWith(switcher)
  expect(run(context, "/model 2").lines.join("\n")).toContain("已切换 → deepseek/m2")
  expect(selected).toEqual(["2"])
  expect(run(context, "/model bad").title).toBe("命令错误")
})

test("模型不可用时给出提示", () => {
  expect(run(contextWith(undefined), "/model").lines).toEqual(["模型不可用或未配置"])
})

function thinkingControl(selected: string[]): AgentThinkingControl {
  return {
    current: () => (selected.length === 0 ? "default" : (selected.at(-1) ?? "default")),
    list: () => ["default", "minimal", "low", "medium", "high", "xhigh", "max"],
    select: (target) => {
      if (target === "bad") throw new Error("无效思考等级：bad")
      selected.push(target)
      return target
    },
  }
}

test("/think 列出思考等级并标记当前", () => {
  const result = run(contextWith(undefined, thinkingControl([])), "/think")
  expect(result.title).toBe("思考等级")
  expect(result.lines.join("\n")).toContain("default（当前）")
  expect(result.lines.join("\n")).toContain("high")
})

test("/think high 调整思考等级，无效等级报错", () => {
  const selected: string[] = []
  const context = contextWith(undefined, thinkingControl(selected))
  expect(run(context, "/think high").lines.join("\n")).toContain("已调整 → high")
  expect(selected).toEqual(["high"])
  expect(run(context, "/think bad").title).toBe("命令错误")
})

test("思考等级不可用时给出提示", () => {
  expect(run(contextWith(undefined, undefined), "/think").lines).toEqual(["思考等级不可用或未配置"])
})
