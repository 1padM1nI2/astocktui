import { expect, test } from "bun:test"
import type { AgentModelSwitcher } from "../src/agent-controller"
import type { CommandContext, CommandResult } from "../src/commands"
import { MODEL_COMMANDS } from "../src/model-commands"

function contextWith(switcher: AgentModelSwitcher | undefined): CommandContext {
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
  }
}

function run(context: CommandContext, input: string): CommandResult {
  const command = MODEL_COMMANDS[0]
  if (command === undefined) throw new Error("模型命令未注册")
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
