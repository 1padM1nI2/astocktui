import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { visibleWidth } from "@oh-my-pi/pi-tui"
import {
  AgentController,
  type AgentDriver,
  type AgentDriverEvent,
} from "../src/agent/agent-controller"
import type { McpServerConfig, McpServerStatus } from "../src/agent/agent-extension-types"
import { AgentExtensionRuntime, type McpManagerFactory } from "../src/agent/agent-extensions"
import { type DiscoveredSkill, SkillRegistry } from "../src/agent/skills"
import { MarketIntelligenceApp } from "../src/app/app"
import { loadMcpConfigs } from "../src/mcp/config"
import type { McpServerConnection } from "../src/mcp/manager"

const skill: DiscoveredSkill = {
  name: "valuation",
  description: "估值流程",
  body: "先核验估值数据。",
  filePath: "/skills/valuation/SKILL.md",
  baseDir: "/skills/valuation",
  source: "omp-project",
  hide: false,
  disableModelInvocation: false,
  alwaysApply: true,
}
const config: McpServerConfig = {
  name: "market",
  type: "http",
  url: "https://mcp.example.com",
  timeout: 100,
  origin: { source: "omp-project", path: "/project/.omp/mcp.json" },
}

class FakeManager {
  readonly connection: McpServerConnection = {
    name: "market",
    config,
    tools: [{ name: "quote", description: "读取报价", inputSchema: { type: "object" } }],
    async callTool() {
      return { content: [{ type: "text", text: "ok" }] }
    },
  }
  reloads: readonly McpServerConfig[] | null = null
  reconnects: string[] = []
  disposed = false
  async connect(): Promise<void> {}
  async reload(configs: readonly McpServerConfig[]): Promise<void> {
    this.reloads = configs
  }
  async reconnect(name: string): Promise<void> {
    this.reconnects.push(name)
  }
  getStatuses(): readonly McpServerStatus[] {
    return [{ name: "market", state: "connected", origin: config.origin, toolCount: 1 }]
  }
  getConnections(): readonly McpServerConnection[] {
    return [this.connection]
  }
  async dispose(): Promise<void> {
    this.disposed = true
  }
}

test("扩展运行时合并 Skill/MCP 工具并提供状态命令", async () => {
  const manager = new FakeManager()
  const factory: McpManagerFactory = () => manager
  const runtime = new AgentExtensionRuntime({
    discoverSkills: async () => new SkillRegistry([skill], []),
    loadMcpConfigs: async () => ({ servers: [config], diagnostics: [] }),
    managerFactory: factory,
  })

  await runtime.initialize()

  expect(runtime.getTools().map((tool) => tool.name)).toEqual(["read_skill", "mcp__market_quote"])
  expect(runtime.getSystemPromptSupplement().join("\n")).toContain("Skill · valuation")
  expect(runtime.getCommands().map((command) => command.name)).toEqual(["skill:valuation"])
  const status = await runtime.mcpCommand(["list"])
  expect(status.title).toBe("MCP 状态")
  expect(status.lines.join("\n")).toContain("market")
  expect(status.lines.join("\n")).toContain("已连接")

  await runtime.mcpCommand(["reconnect", "market"])
  expect(manager.reconnects).toEqual(["market"])
  await runtime.mcpCommand(["reload"])
  expect(manager.reloads).toEqual([config])
  await runtime.dispose()
  expect(manager.disposed).toBe(true)
})

class CapturingDriver implements AgentDriver {
  readonly inputs: string[] = []
  async run(input: string, emit: (event: AgentDriverEvent) => void): Promise<void> {
    this.inputs.push(input)
    emit({ type: "text_delta", delta: "扩展请求已提交" })
  }
  clear(): void {}
  abort(): void {}
}

test("应用通过命令窗口提交 Skill、显示 MCP 状态并在退出时销毁扩展", async () => {
  const manager = new FakeManager()
  const runtime = new AgentExtensionRuntime({
    discoverSkills: async () => new SkillRegistry([skill], []),
    loadMcpConfigs: async () => ({ servers: [config], diagnostics: [] }),
    managerFactory: () => manager,
  })
  const driver = new CapturingDriver()
  const app = new MarketIntelligenceApp(
    undefined,
    undefined,
    () => 16,
    undefined,
    undefined,
    undefined,
    () => new AgentController(driver, "test/model"),
    undefined,
    () => runtime,
  )
  await runtime.initialize()

  submit(app, "/skill:valuation 低估值筛选")
  await app.waitForAgent()
  expect(driver.inputs).toEqual(["Skill · valuation\n先核验估值数据。\n\n用户参数：低估值筛选"])

  submit(app, "/mcp list")
  await app.waitForCommand()
  const frame = app.render(79).join("\n")
  expect(frame).toContain("MCP 状态")
  expect(frame).toContain("market")
  for (const line of app.render(79)) expect(visibleWidth(line)).toBeLessThanOrEqual(79)

  submit(app, "/mcp reconnect market")
  await app.waitForCommand()
  expect(manager.reconnects).toEqual(["market"])
  await app.dispose()
  expect(manager.disposed).toBe(true)
})

function submit(app: MarketIntelligenceApp, input: string): void {
  for (const character of input) app.handleInput(character)
  app.handleInput("\r")
}

test("扩展运行时写入项目 mcp.json 并触发热更新", async () => {
  const root = await mkdtemp(join(tmpdir(), "astock-mcp-ext-"))
  try {
    const manager = new FakeManager()
    const runtime = new AgentExtensionRuntime({
      cwd: root,
      home: join(root, "home"),
      discoverSkills: async () => new SkillRegistry([], []),
      loadMcpConfigs: (options) => loadMcpConfigs(options),
      managerFactory: () => manager,
    })

    await runtime.addMcpServer("quote", { type: "http", url: "https://mcp.example.com" })
    const written = JSON.parse(await readFile(join(root, "mcp.json"), "utf8")) as {
      mcpServers: Record<string, { url?: string }>
    }
    expect(written.mcpServers["quote"]?.url).toBe("https://mcp.example.com")
    expect(manager.reloads?.map((server) => server.name)).toEqual(["quote"])

    await runtime.removeMcpServer("quote")
    expect(manager.reloads).toEqual([])
    await expect(runtime.removeMcpServer("quote")).rejects.toThrow("不存在")
    await expect(runtime.addMcpServer("bad name", { command: "x" })).rejects.toThrow("名称无效")
    await runtime.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
