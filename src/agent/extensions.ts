import { join } from "node:path"
import type { AgentTool } from "@oh-my-pi/pi-agent-core"
import type { AppCommand, CommandResult } from "../commands/commands"
import { loadMcpConfigs, type McpConfigLoadOptions, type McpConfigLoadResult } from "../mcp/config"
import { type McpServerDefinition, removeMcpServer, upsertMcpServer } from "../mcp/config-writer"
import { McpManager, type McpManagerOptions, type McpServerConnection } from "../mcp/manager"
import { bridgeMcpTools } from "../mcp/tool-bridge"
import type { ExtensionDiagnostic, McpServerConfig, McpServerStatus } from "./extension-types"
import { buildSkillPrompt, createSkillCommands, createSkillReadTool } from "./skill-tool"
import { discoverSkills, type SkillDiscoveryOptions, SkillRegistry } from "./skills"

export interface McpManagerLike {
  connect(): Promise<void>
  reload(configs: readonly McpServerConfig[]): Promise<void>
  reconnect(name: string): Promise<void>
  getStatuses(): readonly McpServerStatus[]
  getConnections(): readonly McpServerConnection[]
  dispose(): Promise<void>
}

export type McpManagerFactory = (options: McpManagerOptions) => McpManagerLike

export interface AgentExtensionRuntimeOptions {
  readonly cwd?: string
  readonly home?: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly discoverSkills?: (options: SkillDiscoveryOptions) => Promise<SkillRegistry>
  readonly loadMcpConfigs?: (options: McpConfigLoadOptions) => Promise<McpConfigLoadResult>
  readonly managerFactory?: McpManagerFactory
}

export class AgentExtensionRuntime {
  readonly #options: AgentExtensionRuntimeOptions
  readonly #listeners = new Set<() => void>()
  #registry = new SkillRegistry([], [])
  #manager: McpManagerLike | undefined
  #mcpDiagnostics: readonly ExtensionDiagnostic[] = []
  #initializing: Promise<void> | undefined
  #disposed = false

  constructor(options: AgentExtensionRuntimeOptions = {}) {
    this.#options = options
  }

  initialize(): Promise<void> {
    this.#initializing ??= this.#load()
    return this.#initializing
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  getTools(): readonly AgentTool[] {
    const skillTools =
      this.#registry.skills.length === 0 ? [] : [createSkillReadTool(this.#registry)]
    const mcpTools =
      this.#manager?.getConnections().flatMap((server) => bridgeMcpTools(server, server.tools)) ??
      []
    return [...skillTools, ...mcpTools]
  }

  getSystemPromptSupplement(): readonly string[] {
    return buildSkillPrompt(this.#registry.skills)
  }

  getCommands(): readonly AppCommand[] {
    return createSkillCommands(this.#registry.skills)
  }

  skillPrompt(name: string, args: readonly string[]): string {
    const skill = this.#registry.find(name)
    if (skill === undefined || skill.hide || skill.disableModelInvocation)
      throw new Error(`Skill 不可调用：${name}`)
    const suffix = args.length === 0 ? "" : `\n\n用户参数：${args.join(" ")}`
    return `Skill · ${skill.name}\n${skill.body}${suffix}`
  }

  invokeSkill(
    name: string,
    args: readonly string[],
    submit: (input: string) => void,
  ): CommandResult {
    try {
      submit(this.skillPrompt(name, args))
      return { kind: "clear", title: "", lines: [] }
    } catch (error) {
      return {
        kind: "output",
        title: "Skill 命令错误",
        lines: [error instanceof Error ? error.message : "Skill 调用失败"],
      }
    }
  }

  async addMcpServer(name: string, definition: McpServerDefinition): Promise<void> {
    await this.initialize()
    upsertMcpServer(this.#projectConfigPath(), name, definition)
    await this.#reload()
  }

  async removeMcpServer(name: string): Promise<void> {
    await this.initialize()
    if (!removeMcpServer(this.#projectConfigPath(), name)) {
      throw new Error(`MCP server 不存在：${name}`)
    }
    await this.#reload()
  }

  mcpStatuses(): readonly McpServerStatus[] {
    return this.#manager?.getStatuses() ?? []
  }

  async mcpCommand(args: readonly string[]): Promise<CommandResult> {
    await this.initialize()
    const action = args[0]?.toLowerCase() ?? "list"
    if (action === "list") return this.#statusResult()
    if (action === "reload") {
      await this.#reload()
      return this.#statusResult("MCP 已重新加载")
    }
    if (action === "reconnect") {
      const name = args[1]
      if (name === undefined || name.length === 0)
        return commandError("用法 /mcp reconnect <server>")
      try {
        await this.#manager?.reconnect(name)
        return this.#statusResult(`MCP ${name} 已重新连接`)
      } catch {
        return commandError(`MCP server 不存在或无法重连：${name}`)
      }
    }
    return commandError("用法 /mcp [list|reload|reconnect <server>]")
  }

  async dispose(): Promise<void> {
    this.#disposed = true
    await this.#initializing
    await this.#manager?.dispose()
  }

  async #load(): Promise<void> {
    const cwd = this.#options.cwd ?? process.cwd()
    const home = homeDirectory(this.#options.home, cwd)
    const skills = this.#options.discoverSkills ?? discoverSkills
    try {
      this.#registry = await skills({ cwd, home })
    } catch {
      this.#registry = new SkillRegistry(
        [],
        [{ scope: "skill", subject: "skills", message: "Skill 加载失败" }],
      )
    }
    const configs = await this.#loadConfigs(cwd, home)
    if (this.#disposed) return
    const managerFactory =
      this.#options.managerFactory ?? ((options: McpManagerOptions) => new McpManager(options))
    this.#manager = managerFactory({ configs, onChange: () => this.#notify() })
    this.#notify()
    void this.#manager.connect().then(
      () => this.#notify(),
      () => this.#notify(),
    )
  }

  async #reload(): Promise<void> {
    if (this.#disposed) return
    const cwd = this.#options.cwd ?? process.cwd()
    const home = homeDirectory(this.#options.home, cwd)
    const configs = await this.#loadConfigs(cwd, home)
    await this.#manager?.reload(configs)
    this.#notify()
  }

  #projectConfigPath(): string {
    return join(this.#options.cwd ?? process.cwd(), "mcp.json")
  }

  async #loadConfigs(cwd: string, home: string): Promise<readonly McpServerConfig[]> {
    const loader = this.#options.loadMcpConfigs ?? loadMcpConfigs
    try {
      const loaded = await loader({ cwd, home, env: this.#options.env ?? Bun.env })
      this.#mcpDiagnostics = loaded.diagnostics
      return loaded.servers
    } catch {
      this.#mcpDiagnostics = [{ scope: "mcp", subject: "mcp", message: "MCP 配置加载失败" }]
      return []
    }
  }

  #statusResult(prefix?: string): CommandResult {
    const statuses = this.#manager?.getStatuses() ?? []
    const lines = [
      ...(prefix === undefined ? [] : [prefix]),
      ...(statuses.length === 0 ? ["未配置 MCP server"] : statuses.map(statusLine)),
      ...this.#mcpDiagnostics.map(
        (diagnostic) => `诊断 ${diagnostic.subject}：${diagnostic.message}`,
      ),
    ]

    return { kind: "output", title: "MCP 状态", lines }
  }

  #notify(): void {
    for (const listener of this.#listeners) listener()
  }
}

function homeDirectory(preferred: string | undefined, cwd: string): string {
  const userProfile = "USERPROFILE"
  const home = "HOME"
  return preferred ?? Bun.env[userProfile] ?? Bun.env[home] ?? cwd
}

function statusLine(status: McpServerStatus): string {
  const state =
    status.state === "connected"
      ? "已连接"
      : status.state === "connecting"
        ? "连接中"
        : status.state === "error"
          ? "错误"
          : "已断开"
  return `${status.name} · ${status.origin.source} · ${state} · ${status.toolCount} 工具${status.error === undefined ? "" : ` · ${status.error}`}`
}

function commandError(message: string): CommandResult {
  return { kind: "output", title: "MCP 命令错误", lines: [message] }
}
