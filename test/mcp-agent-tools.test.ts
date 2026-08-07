import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentTool } from "@oh-my-pi/pi-agent-core"
import type { McpServerConfig, McpServerStatus } from "../src/agent/agent-extension-types"
import { AgentExtensionRuntime } from "../src/agent/agent-extensions"
import { createMcpAgentTools } from "../src/agent/mcp-agent-tools"
import { SkillRegistry } from "../src/agent/skills"
import { loadMcpConfigs } from "../src/mcp/config"
import type { McpServerConnection } from "../src/mcp/manager"

class FakeManager {
  statuses: McpServerStatus[] = []
  async connect(): Promise<void> {}
  async reload(configs: readonly McpServerConfig[]): Promise<void> {
    this.statuses = configs.map((server) => ({
      name: server.name,
      state: "connected",
      origin: server.origin,
      toolCount: 0,
    }))
  }
  async reconnect(): Promise<void> {}
  getStatuses(): readonly McpServerStatus[] {
    return this.statuses
  }
  getConnections(): readonly McpServerConnection[] {
    return []
  }
  async dispose(): Promise<void> {}
}

async function setup(): Promise<{ root: string; tool: AgentTool; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "astock-mcp-tool-"))
  const manager = new FakeManager()
  const runtime = new AgentExtensionRuntime({
    cwd: root,
    home: join(root, "home"),
    discoverSkills: async () => new SkillRegistry([], []),
    loadMcpConfigs: (options) => loadMcpConfigs(options),
    managerFactory: () => manager,
  })
  const tool = createMcpAgentTools(runtime)[0] as AgentTool
  return { root, tool, cleanup: () => rm(root, { recursive: true, force: true }) }
}

function text(result: { content: readonly { type: string; text?: string }[] }): string {
  return result.content[0]?.text ?? ""
}

test("manage_mcp_server add 写盘并即时连接，list 反映状态", async () => {
  const { root, tool, cleanup } = await setup()
  try {
    const added = await tool.execute("t1", {
      action: "add",
      name: "quote",
      command: "bun",
      args: ["run", "server.ts"],
    })
    expect(JSON.parse(text(added))).toMatchObject({ ok: true, action: "add", name: "quote" })
    const written = JSON.parse(await readFile(join(root, "mcp.json"), "utf8")) as {
      mcpServers: Record<string, unknown>
    }
    expect(written.mcpServers["quote"]).toEqual({
      type: "stdio",
      command: "bun",
      args: ["run", "server.ts"],
    })

    const listed = await tool.execute("t2", { action: "list" })
    expect(JSON.parse(text(listed))).toEqual({
      servers: [expect.objectContaining({ name: "quote", state: "connected" })],
    })

    const removed = await tool.execute("t3", { action: "remove", name: "quote" })
    expect(JSON.parse(text(removed))).toMatchObject({ ok: true, action: "remove" })
    expect(JSON.parse(await readFile(join(root, "mcp.json"), "utf8"))).toEqual({ mcpServers: {} })
  } finally {
    await cleanup()
  }
})

test("manage_mcp_server 拒绝非法输入并要求审批", async () => {
  const { tool, cleanup } = await setup()
  try {
    await expect(tool.execute("t4", { action: "add", name: "httpMissing" })).rejects.toThrow(
      "command",
    )
    await expect(tool.execute("t5", { action: "add" })).rejects.toThrow("name")
    await expect(tool.execute("t6", { action: "remove", name: "missing" })).rejects.toThrow(
      "不存在",
    )
    const approval = tool.approval
    expect(typeof approval).toBe("function")
    if (typeof approval !== "function") return
    expect(approval({ action: "list" })).toBe("read")
    expect(approval({ action: "add", name: "quote", command: "bun" })).toMatchObject({
      tier: "exec",
    })
    expect(approval({ action: "remove", name: "quote" })).toMatchObject({ tier: "exec" })
  } finally {
    await cleanup()
  }
})
