import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type {
  ExtensionDiagnostic,
  McpConfigSource,
  McpServerConfig,
  McpTransportKind,
} from "../agent-extension-types"

export interface McpConfigLoadOptions {
  readonly cwd: string
  readonly home: string
  readonly env: Readonly<Record<string, string | undefined>>
}

export interface McpConfigLoadResult {
  readonly servers: readonly McpServerConfig[]
  readonly diagnostics: readonly ExtensionDiagnostic[]
}

interface ConfigDocument {
  readonly source: McpConfigSource
  readonly path: string
  readonly value: Record<string, unknown>
}

export const SERVER_NAME = /^[A-Za-z0-9_.-]{1,100}$/u
const DEFAULT_TIMEOUT = 30_000

export async function loadMcpConfigs(options: McpConfigLoadOptions): Promise<McpConfigLoadResult> {
  const diagnostics: ExtensionDiagnostic[] = []
  const documents = await loadDocuments(options, diagnostics)
  const disabled = disabledServers(documents)
  const names = new Set<string>()
  const servers: McpServerConfig[] = []
  for (const document of documents) {
    const definitions = asRecord(document.value["mcpServers"])
    if (definitions === undefined) continue
    for (const [name, raw] of Object.entries(definitions)) {
      if (disabled.has(name) || names.has(name)) continue
      const server = validateServer(name, raw, document, options.env, diagnostics)
      if (server === undefined) continue
      names.add(name)
      servers.push(server)
    }
  }
  return { servers, diagnostics }
}

async function loadDocuments(
  options: McpConfigLoadOptions,
  diagnostics: ExtensionDiagnostic[],
): Promise<readonly ConfigDocument[]> {
  const paths: readonly { readonly source: McpConfigSource; readonly path: string }[] = [
    { source: "omp-project", path: join(options.cwd, ".omp", "mcp.json") },
    { source: "root-mcp", path: join(options.cwd, "mcp.json") },
    { source: "root-dot-mcp", path: join(options.cwd, ".mcp.json") },
    { source: "omp-user", path: join(options.home, ".omp", "agent", "mcp.json") },
  ]
  const documents: ConfigDocument[] = []
  for (const item of paths) {
    try {
      const parsed: unknown = JSON.parse(await readFile(item.path, "utf8"))
      const value = asRecord(parsed)
      if (value === undefined) throw new Error("MCP 配置根节点必须是对象")
      documents.push({ ...item, value })
    } catch (error) {
      if (isMissingFile(error)) continue
      diagnostics.push({
        scope: "mcp",
        subject: item.path,
        source: item.path,
        message: error instanceof Error ? error.message : "MCP 配置无效",
      })
    }
  }
  return documents
}

function disabledServers(documents: readonly ConfigDocument[]): ReadonlySet<string> {
  const user = documents.find((document) => document.source === "omp-user")
  const values = user?.value["disabledServers"]
  if (!Array.isArray(values)) return new Set()
  return new Set(values.filter((value): value is string => typeof value === "string"))
}

function validateServer(
  name: string,
  raw: unknown,
  document: ConfigDocument,
  env: Readonly<Record<string, string | undefined>>,
  diagnostics: ExtensionDiagnostic[],
): McpServerConfig | undefined {
  if (!SERVER_NAME.test(name)) return invalid(name, document, diagnostics, "MCP server 名称无效")
  const config = asRecord(raw)
  if (config === undefined) return invalid(name, document, diagnostics, "MCP server 配置必须是对象")
  if (config["enabled"] === false) return undefined
  const type = config["type"] ?? "stdio"
  if (type !== "stdio" && type !== "http" && type !== "sse") {
    return invalid(name, document, diagnostics, "MCP transport 仅支持 stdio、http 或 sse")
  }
  const timeout = config["timeout"] ?? DEFAULT_TIMEOUT
  if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout < 0) {
    return invalid(name, document, diagnostics, "MCP timeout 必须是非负有限数字")
  }
  const command = expandString(config["command"], env)
  const url = expandString(config["url"], env)
  if (command !== undefined && url !== undefined) {
    return invalid(name, document, diagnostics, "MCP server 不能同时配置 command 和 url")
  }
  if (type === "stdio" && command === undefined) {
    return invalid(name, document, diagnostics, "stdio MCP server 需要 command")
  }
  if (type !== "stdio" && (url === undefined || !isHttpUrl(url))) {
    return invalid(name, document, diagnostics, "HTTP/SSE MCP server 需要 HTTP(S) url")
  }
  const args = stringList(config["args"], env)
  const maps = stringMaps(config, env)
  if (args === null || maps === undefined)
    return invalid(name, document, diagnostics, "MCP 字段类型无效")
  return {
    name,
    type: type satisfies McpTransportKind,
    ...(command === undefined ? {} : { command }),
    ...(args === undefined ? {} : { args }),
    ...(maps.env === undefined ? {} : { env: maps.env }),
    ...(maps.cwd === undefined ? {} : { cwd: maps.cwd }),
    ...(url === undefined ? {} : { url }),
    ...(maps.headers === undefined ? {} : { headers: maps.headers }),
    timeout,
    origin: { source: document.source, path: document.path },
  }
}

function stringMaps(
  config: Record<string, unknown>,
  env: Readonly<Record<string, string | undefined>>,
):
  | {
      readonly env?: Readonly<Record<string, string>>
      readonly headers?: Readonly<Record<string, string>>
      readonly cwd?: string
    }
  | undefined {
  const mappedEnv = stringMap(config["env"], env)
  const headers = stringMap(config["headers"], env)
  const cwd = expandString(config["cwd"], env)
  if (mappedEnv === null || headers === null) return undefined
  return {
    ...(mappedEnv === undefined ? {} : { env: mappedEnv }),
    ...(headers === undefined ? {} : { headers }),
    ...(cwd === undefined ? {} : { cwd }),
  }
}

function stringList(
  value: unknown,
  env: Readonly<Record<string, string | undefined>>,
): readonly string[] | undefined | null {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null
  return value.map((item) => expand(item, env))
}

function stringMap(
  value: unknown,
  env: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> | undefined | null {
  if (value === undefined) return undefined
  const record = asRecord(value)
  if (record === undefined) return null
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry !== "string") return null
    result[key] = expand(entry, env)
  }
  return result
}

function expandString(
  value: unknown,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  return typeof value === "string" ? expand(value, env) : undefined
}

function expand(value: string, env: Readonly<Record<string, string | undefined>>): string {
  return value.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/gu,
    (token, name: string, fallback: string | undefined) => {
      const resolved = env[name]
      return resolved === undefined || resolved.length === 0 ? (fallback ?? token) : resolved
    },
  )
}

function invalid(
  subject: string,
  document: ConfigDocument,
  diagnostics: ExtensionDiagnostic[],
  message: string,
): undefined {
  diagnostics.push({ scope: "mcp", subject, source: document.path, message })
  return undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && Reflect.get(error, "code") === "ENOENT"
}
