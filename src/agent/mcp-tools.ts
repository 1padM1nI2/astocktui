import type { AgentTool, AgentToolResult } from "@oh-my-pi/pi-agent-core"
import { z } from "@oh-my-pi/pi-ai"
import type { McpServerDefinition } from "../mcp/config-writer"
import type { AgentExtensionRuntime } from "./extensions"

interface ManageMcpInput {
  readonly action: "list" | "add" | "remove"
  readonly name?: string
  readonly type?: "stdio" | "http" | "sse"
  readonly command?: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly cwd?: string
  readonly url?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly timeout?: number
}

function result(value: unknown): AgentToolResult<unknown> {
  return { content: [{ type: "text", text: JSON.stringify(value) }], details: value }
}

function definitionOf(input: ManageMcpInput): McpServerDefinition {
  return {
    ...(input.type === undefined ? {} : { type: input.type }),
    ...(input.command === undefined ? {} : { command: input.command }),
    ...(input.args === undefined ? {} : { args: input.args }),
    ...(input.env === undefined ? {} : { env: input.env }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    ...(input.url === undefined ? {} : { url: input.url }),
    ...(input.headers === undefined ? {} : { headers: input.headers }),
    ...(input.timeout === undefined ? {} : { timeout: input.timeout }),
  }
}

export function createMcpAgentTools(extensions: AgentExtensionRuntime): readonly AgentTool[] {
  return [
    {
      name: "manage_mcp_server",
      label: "管理 MCP server",
      description:
        "查看、添加或删除 MCP server。add 把定义写入项目根 mcp.json 并立即连接，其工具即时可用；remove 同步断开。stdio 需要 command（可带 args/env/cwd），http/sse 需要 url（可带 headers），timeout 单位毫秒。",
      parameters: z.object({
        action: z.enum(["list", "add", "remove"]),
        name: z.string().optional(),
        type: z.enum(["stdio", "http", "sse"]).optional(),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string(), z.string()).optional(),
        cwd: z.string().optional(),
        url: z.string().optional(),
        headers: z.record(z.string(), z.string()).optional(),
        timeout: z.number().optional(),
      }),
      intent: "omit",
      approval: (params) =>
        typeof params === "object" && params !== null && Reflect.get(params, "action") === "list"
          ? "read"
          : { tier: "exec", reason: "将修改项目 mcp.json 并连接外部 MCP server", override: true },
      execute: async (_id, params) => {
        const input = params as ManageMcpInput
        if (input.action === "list") return result({ servers: extensions.mcpStatuses() })
        if (input.name === undefined || input.name.length === 0) {
          throw new Error(`${input.action} 操作需要 name`)
        }
        if (input.action === "remove") {
          await extensions.removeMcpServer(input.name)
          return result({ ok: true, action: "remove", name: input.name })
        }
        await extensions.addMcpServer(input.name, definitionOf(input))
        return result({ ok: true, action: "add", name: input.name })
      },
    },
  ]
}
