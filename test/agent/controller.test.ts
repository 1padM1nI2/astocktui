import { describe, expect, test } from "bun:test"
import {
  AgentController,
  type AgentDriver,
  type AgentDriverEvent,
} from "../../src/agent/controller"

class FakeAgentDriver implements AgentDriver {
  readonly prompts: string[] = []
  cleared = 0
  error: Error | null = null

  async run(input: string, emit: (event: AgentDriverEvent) => void): Promise<void> {
    this.prompts.push(input)
    if (this.error !== null) throw this.error
    emit({ type: "text_delta", delta: "贵州茅台当前走势偏强。" })
    emit({ type: "tool_start", id: "tool-1", name: "get_market_snapshot", label: "读取实时行情" })
    emit({
      type: "tool_end",
      id: "tool-1",
      name: "get_market_snapshot",
      label: "读取实时行情",
      summary: "返回 4 只股票",
      isError: false,
    })
    emit({ type: "text_delta", delta: "仍需关注成交量。" })
  }

  clear(): void {
    this.cleared++
  }

  abort(): void {}
}

class AutonomousTradeDriver implements AgentDriver {
  async run(_input: string, emit: (event: AgentDriverEvent) => void): Promise<void> {
    emit({ type: "tool_start", id: "trade-1", name: "execute_trade", label: "执行模拟交易" })
    emit({
      type: "tool_end",
      id: "trade-1",
      name: "execute_trade",
      label: "执行模拟交易",
      summary: "模拟买入成交",
      isError: false,
    })
    emit({ type: "text_delta", delta: "已基于分析完成本地模拟调仓。" })
  }
  clear(): void {}
  abort(): void {}
}

describe("Pi Agent 会话控制器", () => {
  test("流式汇总回答、工具状态并通知界面重绘", async () => {
    const driver = new FakeAgentDriver()
    const controller = new AgentController(driver, "openai/gpt-4o-mini")
    let updates = 0
    controller.subscribe(() => {
      updates++
    })

    await controller.prompt("分析贵州茅台")

    expect(controller.view.status).toBe("completed")
    expect(controller.view.userInput).toBe("分析贵州茅台")
    expect(controller.view.answer).toBe("贵州茅台当前走势偏强。仍需关注成交量。")
    expect(controller.view.tools).toEqual([
      {
        id: "tool-1",
        name: "get_market_snapshot",
        label: "读取实时行情",
        status: "completed",
        summary: "返回 4 只股票",
      },
    ])
    expect(updates).toBeGreaterThan(3)
  })

  test("普通分析请求可呈现自主模拟交易结果而不需要确认步骤", async () => {
    const controller = new AgentController(new AutonomousTradeDriver(), "test/model")

    await controller.prompt("分析持仓风险")

    expect(controller.view.status).toBe("completed")
    expect(controller.view.answer).toContain("本地模拟调仓")
    expect(controller.view.tools).toEqual([
      expect.objectContaining({
        name: "execute_trade",
        status: "completed",
        summary: "模拟买入成交",
      }),
    ])
  })

  test("模型错误显示在会话状态且不会遗留运行中状态", async () => {
    const driver = new FakeAgentDriver()
    driver.error = new Error("模型服务不可用")
    const controller = new AgentController(driver, "openai/gpt-4o-mini")

    await controller.prompt("分析市场")

    expect(controller.view.status).toBe("error")
    expect(controller.view.error).toContain("模型服务不可用")
  })

  test("缺少模型凭据时明确提示配置项且不发起请求", async () => {
    const driver = new FakeAgentDriver()
    const controller = new AgentController(driver, "openai/gpt-4o-mini", "未配置 OPENAI_API_KEY")

    await controller.prompt("分析市场")

    expect(controller.view.status).toBe("unconfigured")
    expect(controller.view.error).toBe("未配置 OPENAI_API_KEY")
    expect(driver.prompts).toEqual([])
  })

  test("新一轮提问将上一轮问答归档到历史视图", async () => {
    const driver = new FakeAgentDriver()
    const controller = new AgentController(driver, "test/model")

    await controller.prompt("第一问")
    await controller.prompt("第二问")

    expect(controller.view.userInput).toBe("第二问")
    expect(controller.view.history).toEqual([
      {
        user: "第一问",
        answer: "贵州茅台当前走势偏强。仍需关注成交量。",
        tools: [
          {
            id: "tool-1",
            name: "get_market_snapshot",
            label: "读取实时行情",
            status: "completed",
            summary: "返回 4 只股票",
          },
        ],
      },
    ])
  })

  test("构造时恢复历史问答并在清理时一并清除", async () => {
    const controller = new AgentController(new FakeAgentDriver(), "test/model", undefined, [
      { user: "旧问题", answer: "旧回答", tools: [] },
    ])
    expect(controller.view.history).toEqual([{ user: "旧问题", answer: "旧回答", tools: [] }])

    controller.clear()
    expect(controller.view.history).toEqual([])
  })

  test("清理会话同时清除 Pi 上下文和界面内容", async () => {
    const driver = new FakeAgentDriver()
    const controller = new AgentController(driver, "test/model")
    await controller.prompt("分析市场")

    controller.clear()

    expect(driver.cleared).toBe(1)
    expect(controller.view.status).toBe("idle")
    expect(controller.view.answer).toBe("")
    expect(controller.view.tools).toEqual([])
  })
})
