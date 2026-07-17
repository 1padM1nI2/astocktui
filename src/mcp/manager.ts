import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { McpServerConfig, McpServerStatus } from "../agent-extension-types"

export type McpToolDefinition = Readonly<{
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}>

export interface McpClientConnection {
  listTools(): Promise<readonly McpToolDefinition[]>
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
  close(): Promise<void>
  onClose?(listener: () => void): void
}

export type McpConnector = (config: McpServerConfig) => Promise<McpClientConnection>

export type McpServerConnection = Readonly<{
  name: string
  config: McpServerConfig
  tools: readonly McpToolDefinition[]
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
}>

export type McpManagerOptions = Readonly<{
  configs: readonly McpServerConfig[]
  connector?: McpConnector
  onChange?: () => void
}>

const RETRY_DELAYS = [500, 1_000, 2_000, 4_000] as const
type Connection = {
  readonly client: McpClientConnection
  readonly tools: readonly McpToolDefinition[]
}

export class McpManager {
  #configs: readonly McpServerConfig[]
  readonly #connector: McpConnector
  readonly #onChange: (() => void) | undefined
  readonly #connections = new Map<string, Connection>()
  readonly #statuses = new Map<string, McpServerStatus>()
  readonly #retries = new Map<string, number>()
  readonly #retryTimers = new Map<string, Timer>()
  #disposed = false

  constructor(options: McpManagerOptions) {
    this.#configs = options.configs
    this.#connector = options.connector ?? connectMcpServer
    this.#onChange = options.onChange
    this.#resetStatuses()
  }

  async connect(): Promise<void> {
    await Promise.all(this.#configs.map((config) => this.#connect(config)))
  }

  async reload(configs: readonly McpServerConfig[]): Promise<void> {
    this.#clearRetryTimers()
    await this.#closeConnections()
    this.#configs = configs
    this.#retries.clear()
    this.#resetStatuses()
    await this.connect()
  }

  async reconnect(name: string): Promise<void> {
    const config = this.#configs.find((candidate) => candidate.name === name)
    if (config === undefined) throw new Error(`MCP server 不存在：${name}`)
    await this.#closeConnection(name)
    await this.#connect(config)
  }

  getStatuses(): readonly McpServerStatus[] {
    return this.#configs.map((config) => this.#statuses.get(config.name) ?? disconnected(config))
  }

  getConnections(): readonly McpServerConnection[] {
    return this.#configs.flatMap((config) => {
      const connection = this.#connections.get(config.name)
      return connection === undefined
        ? []
        : [
            {
              name: config.name,
              config,
              tools: connection.tools,
              callTool: connection.client.callTool.bind(connection.client),
            },
          ]
    })
  }

  async dispose(): Promise<void> {
    this.#disposed = true
    this.#clearRetryTimers()
    await this.#closeConnections()
  }

  async #connect(config: McpServerConfig): Promise<void> {
    if (!this.#canConnect(config)) return
    this.#setStatus(config, "connecting", 0)
    let client: McpClientConnection | undefined
    try {
      client = await this.#connector(config)
      const tools = await withTimeout(client.listTools(), config.timeout)
      if (this.#disposed) {
        await client.close()
        return
      }
      const connectedClient = client
      this.#connections.set(config.name, { client: connectedClient, tools })
      this.#retries.delete(config.name)
      connectedClient.onClose?.(() => this.#handleClose(config, connectedClient))
      this.#setStatus(config, "connected", tools.length)
    } catch (error) {
      await client?.close().catch(() => undefined)
      const message = error instanceof Error ? error.message : "MCP 连接失败"
      this.#setStatus(config, "error", 0, message)
      this.#scheduleReconnect(config)
    }
  }

  #handleClose(config: McpServerConfig, client: McpClientConnection): void {
    if (this.#connections.get(config.name)?.client !== client) return
    this.#connections.delete(config.name)
    this.#setStatus(config, "disconnected", 0)
    this.#scheduleReconnect(config)
  }

  #canConnect(config: McpServerConfig): boolean {
    return !this.#disposed && this.#configs.includes(config) && !this.#connections.has(config.name)
  }

  #scheduleReconnect(config: McpServerConfig): void {
    if (!this.#canConnect(config) || this.#retryTimers.has(config.name)) return
    const attempts = this.#retries.get(config.name) ?? 0
    if (attempts >= 5) return
    this.#retries.set(config.name, attempts + 1)
    const delay = RETRY_DELAYS[Math.min(attempts, RETRY_DELAYS.length - 1)]
    const timer = setTimeout(() => {
      this.#retryTimers.delete(config.name)
      void this.#connect(config)
    }, delay)
    this.#retryTimers.set(config.name, timer)
  }

  #setStatus(
    config: McpServerConfig,
    state: McpServerStatus["state"],
    toolCount: number,
    error?: string,
  ): void {
    this.#statuses.set(config.name, {
      name: config.name,
      state,
      origin: config.origin,
      toolCount,
      ...(error === undefined ? {} : { error }),
    })
    this.#onChange?.()
  }

  #resetStatuses(): void {
    this.#statuses.clear()
    for (const config of this.#configs) this.#statuses.set(config.name, disconnected(config))
    this.#onChange?.()
  }

  #clearRetryTimers(): void {
    for (const timer of this.#retryTimers.values()) clearTimeout(timer)
    this.#retryTimers.clear()
  }

  async #closeConnections(): Promise<void> {
    await Promise.allSettled(
      [...this.#connections.keys()].map((name) => this.#closeConnection(name)),
    )
    this.#connections.clear()
  }

  async #closeConnection(name: string): Promise<void> {
    const connection = this.#connections.get(name)
    if (connection === undefined) return
    this.#connections.delete(name)
    await connection.client.close()
  }
}

export async function connectMcpServer(config: McpServerConfig): Promise<McpClientConnection> {
  const transport = createTransport(config)
  const client = new Client({ name: "astocktui", version: "0.1.0" })
  try {
    await withTimeout(client.connect(transport as Parameters<Client["connect"]>[0]), config.timeout)
  } catch (error) {
    await transport.close().catch(() => undefined)
    throw error
  }
  return {
    async listTools() {
      const result = await withTimeout(client.listTools(), config.timeout)
      return result.tools.map((tool) => ({
        name: tool.name,
        ...(tool.description === undefined ? {} : { description: tool.description }),
        inputSchema: tool.inputSchema as Record<string, unknown>,
      }))
    },
    callTool(name, args) {
      return client.callTool({ name, arguments: args })
    },
    close: () => transport.close(),
    onClose(listener) {
      transport.onclose = listener
    },
  }
}

function createTransport(
  config: McpServerConfig,
): StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport {
  if (config.type === "stdio") {
    return new StdioClientTransport({
      command: config.command ?? "",
      ...(config.args === undefined ? {} : { args: [...config.args] }),
      ...(config.env === undefined ? {} : { env: { ...inheritedEnvironment(), ...config.env } }),
      ...(config.cwd === undefined ? {} : { cwd: config.cwd }),
      stderr: "ignore",
    })
  }
  const url = new URL(config.url ?? "")
  const headers = config.headers === undefined ? undefined : { ...config.headers }
  if (config.type === "http") {
    return new StreamableHTTPClientTransport(url, {
      ...(headers === undefined ? {} : { requestInit: { headers } }),
    })
  }
  return new SSEClientTransport(url, {
    ...(headers === undefined
      ? {}
      : {
          eventSourceInit: {
            fetch: (input, init) =>
              globalThis.fetch(input, { ...init, headers: { ...headers, ...init.headers } }),
          },
          requestInit: { headers },
        }),
  })
}

function inheritedEnvironment(): Record<string, string> {
  const entries = Object.entries(Bun.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  )
  return Object.fromEntries(entries)
}

async function withTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
  if (timeout === 0) return promise
  let timer: Timer | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`MCP 请求超时：${timeout}ms`)), timeout)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function disconnected(config: McpServerConfig): McpServerStatus {
  return { name: config.name, state: "disconnected", origin: config.origin, toolCount: 0 }
}
