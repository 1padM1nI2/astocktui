import type { AgentTool, AgentToolResult } from "@oh-my-pi/pi-agent-core"
import type { TJsonSchema } from "@oh-my-pi/pi-ai"
import type { McpServerConnection, McpToolDefinition } from "./manager"

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
type RemoteResult = { readonly content?: unknown; readonly isError?: unknown }
type RemoteContent = {
  readonly type?: unknown
  readonly text?: unknown
  readonly data?: unknown
  readonly mimeType?: unknown
}

export function bridgeMcpTools(
  server: McpServerConnection,
  definitions: readonly McpToolDefinition[],
): readonly AgentTool<TJsonSchema>[] {
  const names = new Map<string, number>()
  return definitions.map((definition) => {
    const name = uniqueName(sanitizeMcpToolName(server.name, definition.name), names)
    return {
      name,
      label: `MCP · ${server.name} / ${definition.name}`,
      description:
        definition.description ?? `调用 MCP server ${server.name} 的 ${definition.name} 工具。`,
      parameters: definition.inputSchema as TJsonSchema,
      intent: "omit",
      approval: "read",
      execute: async (_id, params, signal) => {
        try {
          return mapResult(
            await server.callTool(definition.name, asArgs(params), signal),
            server.name,
            definition.name,
          )
        } catch {
          return errorResult(server.name, definition.name)
        }
      },
    }
  })
}

export function sanitizeMcpToolName(serverName: string, toolName: string): string {
  return `mcp__${sanitizeSegment(serverName)}_${sanitizeSegment(toolName)}`
}

function uniqueName(base: string, names: Map<string, number>): string {
  const count = names.get(base) ?? 0
  names.set(base, count + 1)
  return count === 0 ? base : `${base}_${count + 1}`
}

function sanitizeSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  return normalized === "" ? "tool" : normalized
}

function asArgs(params: unknown): Record<string, unknown> {
  return typeof params === "object" && params !== null && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : {}
}

function mapResult(result: unknown, server: string, tool: string): AgentToolResult<unknown> {
  if (!isRemoteResult(result) || !Array.isArray(result.content)) return errorResult(server, tool)
  const content = result.content.flatMap(toContentBlock)
  if (content.length === 0) return errorResult(server, tool)
  return {
    content,
    details: { server, tool },
    ...(result.isError === true ? { isError: true } : {}),
  }
}

function toContentBlock(value: unknown): readonly ContentBlock[] {
  if (!isRemoteContent(value)) return []
  if (value.type === "text" && typeof value.text === "string")
    return [{ type: "text", text: value.text }]
  if (
    value.type === "image" &&
    typeof value.data === "string" &&
    typeof value.mimeType === "string"
  ) {
    return [{ type: "image", data: value.data, mimeType: value.mimeType }]
  }
  return []
}

function errorResult(server: string, tool: string): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text: "MCP 工具调用失败" }],
    details: { server, tool },
    isError: true,
  }
}

function isRemoteResult(value: unknown): value is RemoteResult {
  return typeof value === "object" && value !== null
}

function isRemoteContent(value: unknown): value is RemoteContent {
  return typeof value === "object" && value !== null
}
