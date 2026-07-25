import { expect, test } from "bun:test"
import {
  isQuotaExhaustedError,
  parseFallbackModelList,
  withAgentBaseUrl,
} from "../src/agent-models"
import { authorizeAgentTool, PiAgentDriver } from "../src/pi-agent-driver"

test("Pi Agent 对任意分析文本均允许自主模拟交易", () => {
  for (const input of [
    "只分析贵州茅台，不要交易",
    "analysis only, do not trade",
    "确认一下今天的行情",
    "帮我分析持仓",
    "市场关闭且数据不足",
  ]) {
    expect(authorizeAgentTool("execute_trade", input)).toBe(true)
  }
  expect(authorizeAgentTool("get_market_snapshot", "只分析，不要交易")).toBe(true)
})

test("重置账户需要单独明确授权，读取和刷新工具不受交易门禁影响", () => {
  expect(authorizeAgentTool("reset_paper_account", "帮我分析持仓")).toBe(false)
  expect(authorizeAgentTool("reset_paper_account", "确认重置模拟账户")).toBe(true)
  expect(authorizeAgentTool("get_market_snapshot", "只分析，不要交易")).toBe(true)
  expect(authorizeAgentTool("refresh_data", "刷新全部数据")).toBe(true)
})

test("自定义 Base URL 覆盖模型端点且不修改模型目录对象", () => {
  const bundled = { id: "gpt-4o-mini", baseUrl: "https://api.openai.com/v1" }

  const configured = withAgentBaseUrl(bundled, "https://gateway.example.com/v1/")

  expect(configured.baseUrl).toBe("https://gateway.example.com/v1")
  expect(bundled.baseUrl).toBe("https://api.openai.com/v1")
  expect(() => withAgentBaseUrl(bundled, "not-a-url")).toThrow("Base URL")
})

test("解析备用模型列表，忽略无效条目", () => {
  expect(parseFallbackModelList("deepseek/deepseek-chat, zhipu/glm-4-flash")).toEqual([
    { provider: "deepseek", model: "deepseek-chat" },
    { provider: "zhipu", model: "glm-4-flash" },
  ])
  expect(parseFallbackModelList(" openai/gpt-4o-mini ,,,bad-entry,/nope,")).toEqual([
    { provider: "openai", model: "gpt-4o-mini" },
  ])
  expect(parseFallbackModelList(undefined)).toEqual([])
})

test("识别额度耗尽错误，排除鉴权与瞬时限流", () => {
  expect(isQuotaExhaustedError("429 insufficient_quota: You exceeded your current quota")).toBe(
    true,
  )
  expect(isQuotaExhaustedError("Google API error (429): resource_exhausted")).toBe(true)
  expect(isQuotaExhaustedError("usage_limit_reached: try again tomorrow")).toBe(true)
  expect(
    isQuotaExhaustedError(
      "429 已达到 Token Plan 用量上限：请升级 Token Plan 套餐或购买积分补充用量。 (2056)",
    ),
  ).toBe(true)
  expect(isQuotaExhaustedError("429 账户余额不足，请充值后重试")).toBe(true)
  expect(isQuotaExhaustedError("401 invalid_api_key: Incorrect API key provided")).toBe(false)
  expect(isQuotaExhaustedError("500 internal server error")).toBe(false)
  expect(isQuotaExhaustedError("400 请求超过最大上下文长度")).toBe(false)
})

interface StubMessage {
  readonly role: string
  readonly stopReason?: string
  readonly errorMessage?: string
}

class StubAgent {
  readonly state: { messages: StubMessage[] } = { messages: [] }
  model: unknown
  continued = 0
  readonly failWith: string | null
  constructor(failWith: string | null) {
    this.failWith = failWith
  }
  subscribe(): void {}
  setSystemPrompt(): void {}
  setTools(tools: { name: string }[]): void {
    this.tools = tools
  }
  tools: { name: string }[] = []
  beforeToolCall: unknown
  async prompt(input: string): Promise<void> {
    this.state.messages.push({ role: "user" })
    this.#respond(input)
  }
  async continue(): Promise<void> {
    this.continued++
    this.#respond("continue")
  }
  #respond(_input: string): void {
    if (this.failWith !== null && this.continued === 0) {
      this.state.messages.push({
        role: "assistant",
        stopReason: "error",
        errorMessage: this.failWith,
      })
      return
    }
    this.state.messages.push({ role: "assistant", stopReason: "stop" })
  }
  replaceMessages(messages: StubMessage[]): void {
    this.state.messages = messages
  }
  setModel(model: unknown): void {
    this.model = model
  }
  clearMessages(): void {}
  abort(): void {}
}

test("额度耗尽时切换到下一个模型并重试", async () => {
  const agent = new StubAgent("429 insufficient_quota: quota exceeded")
  const labels: string[] = []
  const debug: { readonly kind: string; readonly fields: Record<string, unknown> }[] = []
  const driver = new PiAgentDriver(
    agent as never,
    [
      { model: { id: "m1" } as never, label: "openai/m1" },
      { model: { id: "m2" } as never, label: "deepseek/m2" },
    ],
    new Map(),
    () => [],
    undefined,
    () => labels.push(driver.modelLabel),
    (kind, fields) => debug.push({ kind, fields }),
  )
  await driver.run("分析一下", () => {})
  expect(agent.continued).toBe(1)
  expect(agent.model).toEqual({ id: "m2" })
  expect(driver.modelLabel).toBe("deepseek/m2")
  expect(labels).toEqual(["deepseek/m2"])
  expect(agent.state.messages.map((message) => message.role)).toEqual(["user", "assistant"])
  expect(agent.state.messages[1]?.stopReason).toBe("stop")
  expect(debug.map((entry) => entry.kind)).toEqual([
    "agent_prompt",
    "agent_fallback",
    "agent_run_end",
  ])
  expect(debug[1]?.fields).toMatchObject({
    from: "openai/m1",
    to: "deepseek/m2",
    reason: "429 insufficient_quota: quota exceeded",
  })
})

test("非额度错误不切换模型，且错误抛出给控制器", async () => {
  const agent = new StubAgent("401 invalid_api_key")
  const driver = new PiAgentDriver(
    agent as never,
    [
      { model: { id: "m1" } as never, label: "openai/m1" },
      { model: { id: "m2" } as never, label: "deepseek/m2" },
    ],
    new Map(),
    () => [],
  )
  await expect(driver.run("分析一下", () => {})).rejects.toThrow("401 invalid_api_key")
  expect(agent.continued).toBe(0)
  expect(agent.model).toBeUndefined()
  expect(driver.modelLabel).toBe("openai/m1")
})

test("备用模型全部额度耗尽时抛出最后一个错误", async () => {
  class AlwaysQuotaAgent extends StubAgent {
    override async continue(): Promise<void> {
      this.continued++
      this.state.messages.push({
        role: "assistant",
        stopReason: "error",
        errorMessage: "402 insufficient balance",
      })
    }
  }
  const agent = new AlwaysQuotaAgent("429 insufficient_quota: quota exceeded")
  const driver = new PiAgentDriver(
    agent as never,
    [
      { model: { id: "m1" } as never, label: "openai/m1" },
      { model: { id: "m2" } as never, label: "deepseek/m2" },
    ],
    new Map(),
    () => [],
  )
  await expect(driver.run("分析一下", () => {})).rejects.toThrow("402 insufficient balance")
  expect(agent.continued).toBe(1)
})

test("装配扩展工具时按名去重并记录调试事件", () => {
  const agent = new StubAgent(null)
  const debug: string[] = []
  const driver = new PiAgentDriver(
    agent as never,
    [{ model: { id: "m1" } as never, label: "openai/m1" }],
    new Map(),
    () => [],
    undefined,
    undefined,
    (kind) => debug.push(kind),
  )
  const makeTool = (name: string) => ({ name, label: name }) as never
  driver.setExtensions([makeTool("read"), makeTool("write")], {
    getTools: () => [makeTool("read"), makeTool("read_skill")],
    getSystemPromptSupplement: () => [],
  } as never)
  expect(agent.tools.map((tool) => tool.name)).toEqual(["read", "write", "read_skill"])
  expect(debug).toContain("agent_tools_deduped")
})

test("手动切换模型：按序号、标签或链外 provider/model", () => {
  const agent = new StubAgent(null)
  const labels: string[] = []
  const driver = new PiAgentDriver(
    agent as never,
    [
      { model: { id: "m1" } as never, label: "openai/m1" },
      { model: { id: "m2" } as never, label: "deepseek/m2" },
    ],
    new Map(),
    () => [],
    undefined,
    () => labels.push(driver.modelLabel),
  )
  expect(driver.modelLabels()).toEqual(["openai/m1", "deepseek/m2"])

  expect(driver.selectModel("2")).toBe("deepseek/m2")
  expect(agent.model).toEqual({ id: "m2" })
  expect(labels).toEqual(["deepseek/m2"])

  expect(driver.selectModel("openai/m1")).toBe("openai/m1")
  expect(agent.model).toEqual({ id: "m1" })

  const added = driver.selectModel("deepseek/deepseek-v4-pro")
  expect(added).toBe("deepseek/deepseek-v4-pro")
  expect(driver.modelLabels()).toContain("deepseek/deepseek-v4-pro")
  expect(driver.modelLabel).toBe("deepseek/deepseek-v4-pro")

  expect(() => driver.selectModel("not-a-model")).toThrow()
  expect(() => driver.selectModel("openai/no-such-model-xyz")).toThrow()
})
