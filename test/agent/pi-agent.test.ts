import { expect, test } from "bun:test"
import { MAX_TEXT_TOOLCALL_RETRIES } from "../../src/agent/context-recovery"
import {
  FALLBACK_RETRY_MS,
  isContextOverflowError,
  isQuotaExhaustedError,
  parseFallbackModelList,
  resolveModelChain,
  withAgentBaseUrl,
} from "../../src/agent/models"
import { resolveAgentModelChain } from "../../src/agent/pi-agent"
import { authorizeAgentTool, PiAgentDriver } from "../../src/agent/pi-agent-driver"

test("模型链解析共用入口解析主模型、备用链与密钥配置", () => {
  const resolved = resolveAgentModelChain({
    provider: "openai",
    model: "gpt-4o-mini",
    apiKey: "sk-test",
    baseUrl: "https://gateway.example.com/v1/",
    fallbackModels: ["openai/gpt-4o"],
  })
  expect(resolved.error).toBeNull()
  expect(resolved.modelLabel).toBe("openai/gpt-4o-mini")
  expect(resolved.chain.map((option) => option.label)).toEqual([
    "openai/gpt-4o-mini",
    "openai/gpt-4o",
  ])
  expect(resolved.chain[0]?.model.baseUrl).toBe("https://gateway.example.com/v1")
  expect(resolved.apiKey).toBe("sk-test")
  expect(resolved.configuredApiKey).toBe("sk-test")
  expect(resolved.configurationError).toBeUndefined()
})

test("模型链解析共用入口对未知模型返回错误且链为空", () => {
  const resolved = resolveAgentModelChain({
    provider: "openai",
    model: "no-such-model",
    apiKey: "sk-test",
  })
  expect(resolved.chain).toEqual([])
  expect(resolved.error).toContain("no-such-model")
})

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

test("备用模型按 provider 应用独立 Base URL，主模型不受他人覆盖影响", () => {
  const resolved = resolveModelChain({
    provider: "deepseek",
    modelId: "deepseek-v4-pro",
    fallbackSpecs: [{ provider: "openai", model: "gpt-4o-mini" }],
    fallbackBaseUrls: { openai: "https://oai-proxy.example.com/v1/" },
  })
  expect(resolved.error).toBeNull()
  expect(resolved.chain[0]?.model.baseUrl).toBe("https://api.deepseek.com")
  expect(resolved.chain[1]?.model.baseUrl).toBe("https://oai-proxy.example.com/v1")
})

test("备用模型的非法 Base URL 返回错误而不是静默回退官方端点", () => {
  const resolved = resolveModelChain({
    provider: "deepseek",
    modelId: "deepseek-v4-pro",
    fallbackSpecs: [{ provider: "openai", model: "gpt-4o-mini" }],
    fallbackBaseUrls: { openai: "not-a-url" },
  })
  expect(resolved.chain).toEqual([])
  expect(resolved.error).toContain("Base URL")
})

test("ASTOCK_AGENT_BASE_URL_<PROVIDER> 优先于全局覆盖且不泄漏给其他 provider", () => {
  process.env["ASTOCK_AGENT_BASE_URL_DEEPSEEK"] = "https://ds-proxy.example.com/v1"
  process.env["ASTOCK_AGENT_BASE_URL"] = "https://global.example.com/v1"
  try {
    const resolved = resolveAgentModelChain({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      apiKey: "sk-test",
      fallbackModels: ["openai/gpt-4o-mini"],
    })
    expect(resolved.error).toBeNull()
    expect(resolved.chain[0]?.model.baseUrl).toBe("https://ds-proxy.example.com/v1")
    expect(resolved.chain[1]?.model.baseUrl).toBe("https://api.openai.com/v1")
  } finally {
    delete process.env["ASTOCK_AGENT_BASE_URL_DEEPSEEK"]
    delete process.env["ASTOCK_AGENT_BASE_URL"]
  }
})

test("主模型未设专属变量时退回全局覆盖，openai 备用链读 OPENAI_BASE_URL", () => {
  process.env["ASTOCK_AGENT_BASE_URL"] = "https://global.example.com/v1"
  process.env["OPENAI_BASE_URL"] = "https://oai-legacy.example.com/v1"
  try {
    const globalOnly = resolveAgentModelChain({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      apiKey: "sk-test",
    })
    expect(globalOnly.chain[0]?.model.baseUrl).toBe("https://global.example.com/v1")
    const fallback = resolveAgentModelChain({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      apiKey: "sk-test",
      fallbackModels: ["openai/gpt-4o-mini"],
    })
    expect(fallback.chain[1]?.model.baseUrl).toBe("https://oai-legacy.example.com/v1")
  } finally {
    delete process.env["ASTOCK_AGENT_BASE_URL"]
    delete process.env["OPENAI_BASE_URL"]
  }
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

test("识别上下文超限错误，排除额度与鉴权错误", () => {
  expect(isContextOverflowError("400 invalid params, context window exceeds limit (2013)")).toBe(
    true,
  )
  expect(isContextOverflowError("This model's maximum context length is 8192 tokens")).toBe(true)
  expect(isContextOverflowError("400 请求超过最大上下文长度")).toBe(true)
  expect(isContextOverflowError("too many tokens in request")).toBe(true)
  expect(isContextOverflowError("429 insufficient_quota: You exceeded your current quota")).toBe(
    false,
  )
  expect(isContextOverflowError("401 invalid_api_key")).toBe(false)
  expect(isContextOverflowError("500 internal server error")).toBe(false)
})

interface StubMessage {
  readonly role: string
  readonly stopReason?: string
  readonly errorMessage?: string
  readonly content?: unknown
  readonly usage?: unknown
}

class StubAgent {
  readonly state: { messages: StubMessage[] } = { messages: [] }
  model: unknown
  continued = 0
  readonly failWith: string | null
  lengthStops: number
  #listener: ((event: unknown) => void) | undefined
  constructor(failWith: string | null, lengthStops = 0) {
    this.failWith = failWith
    this.lengthStops = lengthStops
  }
  subscribe(listener: (event: unknown) => void): void {
    this.#listener = listener
  }
  emitEvent(event: unknown): void {
    this.#listener?.(event)
  }
  setSystemPrompt(): void {}
  setTools(tools: { name: string }[]): void {
    this.tools = tools
  }
  tools: { name: string }[] = []
  beforeToolCall: unknown
  thinkingLevel: unknown
  setThinkingLevel(level: unknown): void {
    this.thinkingLevel = level
  }
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
    if (this.lengthStops > 0) {
      this.lengthStops--
      this.state.messages.push({ role: "assistant", stopReason: "length" })
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

test("额度回退超过重试间隔后，下次运行切回主模型", async () => {
  const realNow = Date.now
  let now = realNow()
  Date.now = () => now
  try {
    const agent = new StubAgent("429 insufficient_quota: quota exceeded")
    const labels: string[] = []
    const debug: string[] = []
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
      (kind) => debug.push(kind),
    )
    await driver.run("分析一下", () => {})
    expect(driver.modelLabel).toBe("deepseek/m2")
    now += FALLBACK_RETRY_MS + 1
    await driver.run("再看看", () => {})
    expect(agent.model).toEqual({ id: "m1" })
    expect(driver.modelLabel).toBe("openai/m1")
    expect(labels).toEqual(["deepseek/m2", "openai/m1"])
    expect(debug).toContain("agent_fallback_retry")
  } finally {
    Date.now = realNow
  }
})

test("额度回退未到重试间隔时保持备用模型", async () => {
  const realNow = Date.now
  let now = realNow()
  Date.now = () => now
  try {
    const agent = new StubAgent("429 insufficient_quota: quota exceeded")
    const debug: string[] = []
    const driver = new PiAgentDriver(
      agent as never,
      [
        { model: { id: "m1" } as never, label: "openai/m1" },
        { model: { id: "m2" } as never, label: "deepseek/m2" },
      ],
      new Map(),
      () => [],
      undefined,
      undefined,
      (kind) => debug.push(kind),
    )
    await driver.run("分析一下", () => {})
    now += FALLBACK_RETRY_MS - 1
    await driver.run("再看看", () => {})
    expect(driver.modelLabel).toBe("deepseek/m2")
    expect(debug).not.toContain("agent_fallback_retry")
  } finally {
    Date.now = realNow
  }
})

test("手动切换模型后不再自动回切", async () => {
  const realNow = Date.now
  let now = realNow()
  Date.now = () => now
  try {
    const agent = new StubAgent("429 insufficient_quota: quota exceeded")
    const driver = new PiAgentDriver(
      agent as never,
      [
        { model: { id: "m1" } as never, label: "openai/m1" },
        { model: { id: "m2" } as never, label: "deepseek/m2" },
      ],
      new Map(),
      () => [],
    )
    await driver.run("分析一下", () => {})
    driver.selectModel("deepseek/m2")
    now += FALLBACK_RETRY_MS + 1
    await driver.run("再看看", () => {})
    expect(driver.modelLabel).toBe("deepseek/m2")
  } finally {
    Date.now = realNow
  }
})

test("模型把工具调用写成正文标记时自动移除并纠正重试", async () => {
  class TextToolCallAgent extends StubAgent {
    override async prompt(_input: string): Promise<void> {
      this.state.messages.push({ role: "user" })
      this.state.messages.push({
        role: "assistant",
        stopReason: "stop",
        content: [
          { type: "text", text: '先看大盘 <function_calls><invoke name="get_market_overview">' },
        ],
      } as never)
    }
    override async continue(): Promise<void> {
      this.continued++
      this.state.messages.push({
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: "好的，改用原生工具调用。" }],
      } as never)
    }
  }
  const agent = new TextToolCallAgent(null)
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
  await driver.run("分析一下", () => {})
  expect(agent.continued).toBe(1)
  expect(debug).toContain("agent_text_toolcall_retry")
  const assistantTexts = agent.state.messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) =>
      ((message as { content?: { text?: string }[] }).content ?? []).map((part) => part.text ?? ""),
    )
  expect(assistantTexts.some((text) => text.includes("function_calls"))).toBe(false)
  expect(assistantTexts.at(-1)).toBe("好的，改用原生工具调用。")
})

test("正文伪工具调用纠正达到上限后停止重试", async () => {
  class AlwaysTextToolCallAgent extends StubAgent {
    override async prompt(_input: string): Promise<void> {
      this.state.messages.push({ role: "user" })
      this.#fakeToolCall()
    }
    override async continue(): Promise<void> {
      this.continued++
      this.#fakeToolCall()
    }
    #fakeToolCall(): void {
      this.state.messages.push({
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: '<function_calls><invoke name="get_market_overview">' }],
      } as never)
    }
  }
  const agent = new AlwaysTextToolCallAgent(null)
  const driver = new PiAgentDriver(
    agent as never,
    [{ model: { id: "m1" } as never, label: "openai/m1" }],
    new Map(),
    () => [],
  )
  await driver.run("分析一下", () => {})
  expect(agent.continued).toBe(MAX_TEXT_TOOLCALL_RETRIES)
})

test("工具调用中途撞上上下文超限时立即压缩重试，而不是静默断掉", async () => {
  class MidTurnOverflowAgent extends StubAgent {
    override async prompt(_input: string): Promise<void> {
      this.state.messages.push({ role: "user" })
      // 多步回合：前一步成功，下一步才撞上上下文超限
      this.state.messages.push({ role: "assistant", stopReason: "stop" })
      this.state.messages.push({
        role: "assistant",
        stopReason: "error",
        errorMessage: "400 invalid params, context window exceeds limit (2013)",
      })
    }
    override async continue(): Promise<void> {
      this.continued++
      this.state.messages.push({ role: "assistant", stopReason: "stop" })
    }
  }
  const agent = new MidTurnOverflowAgent(null)
  agent.state.messages.push(
    { role: "user" },
    { role: "assistant", stopReason: "stop" },
    { role: "user" },
    { role: "assistant", stopReason: "stop" },
  )
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
  await driver.run("分析一下", () => {})
  expect(agent.continued).toBe(1)
  expect(debug).toContain("agent_context_trim")
  expect(agent.state.messages.map((message) => message.role)).toEqual(["user", "assistant"])
  expect(agent.state.messages.at(-1)?.stopReason).toBe("stop")
})

test("工具调用中途额度耗尽时立即切换备用模型重试", async () => {
  class MidTurnQuotaAgent extends StubAgent {
    override async prompt(_input: string): Promise<void> {
      this.state.messages.push({ role: "user" })
      this.state.messages.push({ role: "assistant", stopReason: "stop" })
      this.state.messages.push({
        role: "assistant",
        stopReason: "error",
        errorMessage: "429 insufficient_quota: quota exceeded",
      })
    }
    override async continue(): Promise<void> {
      this.continued++
      this.state.messages.push({ role: "assistant", stopReason: "stop" })
    }
  }
  const agent = new MidTurnQuotaAgent(null)
  const labels: string[] = []
  const debug: string[] = []
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
    (kind) => debug.push(kind),
  )
  await driver.run("分析一下", () => {})
  expect(agent.continued).toBe(1)
  expect(agent.model).toEqual({ id: "m2" })
  expect(labels).toEqual(["deepseek/m2"])
  expect(debug).toContain("agent_fallback")
  expect(agent.state.messages.map((message) => message.role)).toEqual(["user", "assistant"])
  expect(agent.state.messages.at(-1)?.stopReason).toBe("stop")
})

test("工具调用中途备用模型也耗尽时抛出错误而不是静默断掉", async () => {
  class MidTurnAlwaysQuotaAgent extends StubAgent {
    override async prompt(_input: string): Promise<void> {
      this.state.messages.push({ role: "user" })
      this.state.messages.push({ role: "assistant", stopReason: "stop" })
      this.#quotaError()
    }
    override async continue(): Promise<void> {
      this.continued++
      this.#quotaError()
    }
    #quotaError(): void {
      this.state.messages.push({
        role: "assistant",
        stopReason: "error",
        errorMessage: "429 insufficient_quota: quota exceeded",
      })
    }
  }
  const agent = new MidTurnAlwaysQuotaAgent(null)
  const driver = new PiAgentDriver(
    agent as never,
    [
      { model: { id: "m1" } as never, label: "openai/m1" },
      { model: { id: "m2" } as never, label: "deepseek/m2" },
    ],
    new Map(),
    () => [],
  )
  await expect(driver.run("分析一下", () => {})).rejects.toThrow(
    "429 insufficient_quota: quota exceeded",
  )
  expect(agent.continued).toBe(1)
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

test("上下文超限时清空历史重试并提示", async () => {
  const agent = new StubAgent("400 invalid params, context window exceeds limit (2013)")
  agent.state.messages.push(
    { role: "user" },
    { role: "assistant", stopReason: "stop" },
    { role: "user" },
    { role: "assistant", stopReason: "stop" },
  )
  const events: { readonly type: string; readonly name?: string; readonly summary?: string }[] = []
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

  await driver.run("分析一下", (event) => events.push(event))

  expect(agent.continued).toBe(1)
  // 仅保留最新一条用户消息，重试后得到正常回复
  expect(agent.state.messages.map((message) => message.role)).toEqual(["user", "assistant"])
  expect(agent.state.messages[1]?.stopReason).toBe("stop")
  expect(
    events.some(
      (event) =>
        event.type === "tool_end" &&
        event.name === "context_trim" &&
        event.summary?.includes("上下文") === true,
    ),
  ).toBe(true)
  expect(debug).toContain("agent_context_trim")
})

test("上下文超限时优先压缩为摘要再重试", async () => {
  const agent = new StubAgent("400 invalid params, context window exceeds limit (2013)")
  agent.state.messages.push(
    { role: "user" },
    { role: "assistant", stopReason: "stop" },
    { role: "user" },
    { role: "assistant", stopReason: "stop" },
  )
  const summarized: string[][] = []
  const events: { readonly type: string; readonly name?: string; readonly summary?: string }[] = []
  const driver = new PiAgentDriver(
    agent as never,
    [{ model: { id: "m1" } as never, label: "openai/m1" }],
    new Map(),
    () => [],
    undefined,
    undefined,
    undefined,
    async (messages) => {
      summarized.push(messages.map((message) => message.role))
      return "早前讨论了贵州茅台与五粮液的行情走势"
    },
  )

  await driver.run("分析一下", (event) => events.push(event))

  // 摘要请求覆盖全部历史消息
  expect(summarized).toEqual([["user", "assistant", "user", "assistant"]])
  // 历史被替换为「摘要消息 + 当前提问 + 新回复」
  const roles = agent.state.messages.map((message) => message.role)
  expect(roles).toEqual(["user", "user", "assistant"])
  const summaryMessage = agent.state.messages[0] as {
    readonly content?: readonly { readonly text?: string }[]
  }
  expect(summaryMessage.content?.[0]?.text).toContain("早前讨论了贵州茅台与五粮液的行情走势")
  expect(agent.state.messages[2]?.stopReason).toBe("stop")
  expect(
    events.some(
      (event) =>
        event.type === "tool_end" &&
        event.name === "context_trim" &&
        event.summary?.includes("压缩") === true,
    ),
  ).toBe(true)
})

test("摘要生成失败时回退为清空历史重试", async () => {
  const agent = new StubAgent("400 invalid params, context window exceeds limit (2013)")
  agent.state.messages.push({ role: "user" }, { role: "assistant", stopReason: "stop" })
  const driver = new PiAgentDriver(
    agent as never,
    [{ model: { id: "m1" } as never, label: "openai/m1" }],
    new Map(),
    () => [],
    undefined,
    undefined,
    undefined,
    async () => {
      throw new Error("摘要接口不可用")
    },
  )

  await driver.run("分析一下", () => {})

  expect(agent.continued).toBe(1)
  expect(agent.state.messages.map((message) => message.role)).toEqual(["user", "assistant"])
  expect(agent.state.messages[1]?.stopReason).toBe("stop")
})

test("清空历史重试后仍超限则抛出错误", async () => {
  class AlwaysOverflowAgent extends StubAgent {
    override async continue(): Promise<void> {
      this.continued++
      this.state.messages.push({
        role: "assistant",
        stopReason: "error",
        errorMessage: "400 invalid params, context window exceeds limit (2013)",
      })
    }
  }
  const agent = new AlwaysOverflowAgent("400 invalid params, context window exceeds limit (2013)")
  const driver = new PiAgentDriver(
    agent as never,
    [{ model: { id: "m1" } as never, label: "openai/m1" }],
    new Map(),
    () => [],
  )

  await expect(driver.run("分析一下", () => {})).rejects.toThrow("context window exceeds limit")
  expect(agent.continued).toBe(1)
})

test("输出被 max tokens 截断时自动续写至完成", async () => {
  const agent = new StubAgent(null, 2)
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

  await driver.run("分析一下", () => {})

  expect(agent.continued).toBe(2)
  const stops = agent.state.messages
    .filter((message) => message.role === "assistant")
    .map((message) => message.stopReason)
  expect(stops).toEqual(["length", "length", "stop"])
  expect(debug).toContain("agent_length_continue")
})

test("截断续写达到上限后收尾，避免无限生成", async () => {
  const agent = new StubAgent(null, 99)
  const driver = new PiAgentDriver(
    agent as never,
    [{ model: { id: "m1" } as never, label: "openai/m1" }],
    new Map(),
    () => [],
  )

  await driver.run("分析一下", () => {})

  expect(agent.continued).toBe(3)
})

test("思考等级：设置、查看并随会话持久化", () => {
  const agent = new StubAgent(null)
  const saved: ({ readonly thinkingLevel?: string } | undefined)[] = []
  const sessionStore = {
    save: (_messages: unknown, extras?: { readonly thinkingLevel?: string }) => {
      saved.push(extras)
    },
  }
  const driver = new PiAgentDriver(
    agent as never,
    [{ model: { id: "m1" } as never, label: "openai/m1" }],
    new Map(),
    () => [],
    sessionStore as never,
  )

  expect(driver.thinkingLevel).toBe("default")
  expect(driver.thinkingLevels()).toContain("high")

  expect(driver.setThinkingLevel("HIGH")).toBe("high")
  expect(agent.thinkingLevel).toBe("high")
  expect(driver.thinkingLevel).toBe("high")
  expect(saved.at(-1)).toEqual({ thinkingLevel: "high" })

  expect(driver.setThinkingLevel("default")).toBe("default")
  expect(agent.thinkingLevel).toBeUndefined()

  expect(() => driver.setThinkingLevel("extreme")).toThrow("无效思考等级")
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

test("记录每步 token 用量并汇总缓存命中率", () => {
  const agent = new StubAgent(null)
  const debug: { readonly kind: string; readonly fields: Record<string, unknown> }[] = []
  const driver = new PiAgentDriver(
    agent as never,
    [{ model: { id: "m1" } as never, label: "deepseek/m1" }],
    new Map(),
    () => [],
    undefined,
    undefined,
    (kind, fields) => debug.push({ kind, fields }),
  )
  const message = (input: number, cacheRead: number) => ({
    role: "assistant",
    stopReason: "stop",
    usage: {
      input,
      output: 100,
      cacheRead,
      cacheWrite: 0,
      totalTokens: input + cacheRead + 100,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  })
  agent.emitEvent({ type: "message_end", message: message(1000, 3000) })
  agent.emitEvent({ type: "message_end", message: message(1000, 3000) })
  agent.emitEvent({
    type: "message_end",
    message: { role: "assistant", stopReason: "error", errorMessage: "boom" },
  })

  expect(debug.map((entry) => entry.kind)).toEqual(["agent_usage", "agent_usage"])
  expect(debug[0]?.fields).toMatchObject({ input: 1000, cacheRead: 3000, hitRate: 0.75 })
  expect(driver.usageSummary()).toContain("缓存命中 75%")
  expect(driver.usageSummary()).toContain("2 步")

  driver.clear()
  expect(driver.usageSummary()).toBe("")
})

test("上下文达到窗口阈值时在下轮前主动压缩", async () => {
  const agent = new StubAgent(null)
  const oldTurn = [
    { role: "user", content: "早先问题" },
    { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "早先回答" }] },
  ]
  const recentTurn = [
    { role: "user", content: "最近问题" },
    {
      role: "assistant",
      stopReason: "stop",
      content: [{ type: "text", text: "最近回答" }],
      usage: {
        input: 900,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 910,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    },
  ]
  agent.state.messages.push(...oldTurn, ...recentTurn)
  const debug: string[] = []
  const driver = new PiAgentDriver(
    agent as never,
    [{ model: { id: "m1", contextWindow: 1000 } as never, label: "deepseek/m1" }],
    new Map(),
    () => [],
    undefined,
    undefined,
    (kind) => debug.push(kind),
    async () => "较早对话摘要",
  )
  await driver.run("继续分析", () => {})
  expect(debug).toContain("agent_context_compact")
  // 压缩后：摘要 + 最近回合 + 本轮 user/assistant
  expect(agent.state.messages).toHaveLength(5)
  expect(JSON.stringify(agent.state.messages[0])).toContain("较早对话摘要")
  expect(agent.state.messages[1]).toMatchObject({ role: "user", content: "最近问题" })
})

test("上下文未达阈值时不主动压缩", async () => {
  const agent = new StubAgent(null)
  agent.state.messages.push(
    { role: "user", content: "问题" },
    {
      role: "assistant",
      stopReason: "stop",
      usage: {
        input: 100,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 110,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    },
  )
  const debug: string[] = []
  const driver = new PiAgentDriver(
    agent as never,
    [{ model: { id: "m1", contextWindow: 1000 } as never, label: "deepseek/m1" }],
    new Map(),
    () => [],
    undefined,
    undefined,
    (kind) => debug.push(kind),
    async () => "摘要",
  )
  await driver.run("继续", () => {})
  expect(debug).not.toContain("agent_context_compact")
  expect(agent.state.messages[0]).toMatchObject({ role: "user", content: "问题" })
})
