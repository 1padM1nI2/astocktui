import { readJsonFile, writeJsonFileAtomically } from "../json-file"
import { isHttpUrl, SERVER_NAME } from "./config"

export interface McpServerDefinition {
  readonly type?: "stdio" | "http" | "sse"
  readonly command?: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly cwd?: string
  readonly url?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly timeout?: number
}

export function upsertMcpServer(
  filePath: string,
  name: string,
  definition: McpServerDefinition,
): void {
  const stored = normalize(name, definition)
  const root = readRoot(filePath) ?? {}
  writeJsonFileAtomically(filePath, {
    ...root,
    mcpServers: { ...readServers(root), [name]: stored },
  })
}

export function removeMcpServer(filePath: string, name: string): boolean {
  const root = readRoot(filePath)
  if (root === undefined) return false
  const servers = readServers(root)
  if (!(name in servers)) return false
  const next = { ...servers }
  delete next[name]
  writeJsonFileAtomically(filePath, { ...root, mcpServers: next })
  return true
}

function normalize(name: string, definition: McpServerDefinition): Record<string, unknown> {
  if (!SERVER_NAME.test(name)) throw new Error(`MCP server 名称无效：${name}`)
  const type = definition.type ?? "stdio"
  if (type !== "stdio" && type !== "http" && type !== "sse") {
    throw new Error("MCP transport 仅支持 stdio、http 或 sse")
  }
  if (definition.command !== undefined && definition.url !== undefined) {
    throw new Error("MCP server 不能同时配置 command 和 url")
  }
  if (type === "stdio" && definition.command === undefined) {
    throw new Error("stdio MCP server 需要 command")
  }
  if (type !== "stdio" && (definition.url === undefined || !isHttpUrl(definition.url))) {
    throw new Error("HTTP/SSE MCP server 需要 HTTP(S) url")
  }
  const timeout = definition.timeout
  if (timeout !== undefined && (!Number.isFinite(timeout) || timeout < 0)) {
    throw new Error("MCP timeout 必须是非负有限数字")
  }
  return {
    type,
    ...(definition.command === undefined ? {} : { command: definition.command }),
    ...(definition.args === undefined ? {} : { args: [...definition.args] }),
    ...(definition.env === undefined ? {} : { env: { ...definition.env } }),
    ...(definition.cwd === undefined ? {} : { cwd: definition.cwd }),
    ...(definition.url === undefined ? {} : { url: definition.url }),
    ...(definition.headers === undefined ? {} : { headers: { ...definition.headers } }),
    ...(timeout === undefined ? {} : { timeout }),
  }
}

function readRoot(filePath: string): Record<string, unknown> | undefined {
  const value = readJsonFile(filePath)
  if (value === null) return undefined
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("MCP 配置根节点必须是对象")
  }
  return value as Record<string, unknown>
}

function readServers(root: Record<string, unknown>): Record<string, unknown> {
  const value = root["mcpServers"]
  if (value === undefined) return {}
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("mcpServers 必须是对象")
  }
  return value as Record<string, unknown>
}
