import { describe, expect, test } from "bun:test"
import { AgentController, type AgentDriver, type AgentDriverEvent } from "../src/agent-controller"

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
