export const MCP_TRANSPORT_KINDS = ["stdio", "http", "sse"] as const
export type McpTransportKind = (typeof MCP_TRANSPORT_KINDS)[number]

export const MCP_CONFIG_SOURCES = ["omp-project", "root-mcp", "root-dot-mcp", "omp-user"] as const
export type McpConfigSource = (typeof MCP_CONFIG_SOURCES)[number]

export const MCP_CONNECTION_STATES = ["connecting", "connected", "disconnected", "error"] as const
export type McpConnectionState = (typeof MCP_CONNECTION_STATES)[number]

export interface ExtensionDiagnostic {
  readonly scope: "skill" | "mcp"
  readonly subject: string
  readonly source?: string
  readonly message: string
}

export interface McpServerOrigin {
  readonly source: McpConfigSource
  readonly path: string
}

export interface McpServerConfig {
  readonly name: string
  readonly type: McpTransportKind
  readonly command?: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly cwd?: string
  readonly url?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly timeout: number
  readonly origin: McpServerOrigin
}

export interface McpServerStatus {
  readonly name: string
  readonly state: McpConnectionState
  readonly origin: McpServerOrigin
  readonly toolCount: number
  readonly error?: string
}
