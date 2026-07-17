import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { McpServerConfig } from "../src/agent-extension-types"
import { type McpConnector, McpManager } from "../src/mcp/manager"

function config(name: string): McpServerConfig {
  return {
    name,
    type: "stdio",
    command: "fixture",
    timeout: 100,
    origin: { source: "omp-project", path: "/project/.omp/mcp.json" },
  }
}

test("MCP manager 隔离连接失败、公开已连接工具并在 reload 时关闭旧连接", async () => {
  const closed: string[] = []
  const connector: McpConnector = async (server) => {
    if (server.name === "broken") throw new Error("连接失败")
    return {
      async listTools() {
        return [{ name: "lookup", description: "查询", inputSchema: { type: "object" } }]
      },
      async callTool() {
        return { content: [{ type: "text", text: "ok" }] }
      },
      async close() {
        closed.push(server.name)
      },
    }
  }
  const manager = new McpManager({ configs: [config("healthy"), config("broken")], connector })

  await manager.connect()

  expect(manager.getStatuses()).toEqual([
    expect.objectContaining({ name: "healthy", state: "connected", toolCount: 1 }),
    expect.objectContaining({ name: "broken", state: "error", toolCount: 0, error: "连接失败" }),
  ])
  expect(manager.getConnections().map((connection) => connection.name)).toEqual(["healthy"])

  await manager.reload([config("replacement")])
  expect(closed).toEqual(["healthy"])
  expect(manager.getStatuses()).toEqual([
    expect.objectContaining({ name: "replacement", state: "connected", toolCount: 1 }),
  ])

  await manager.dispose()
  expect(closed).toEqual(["healthy", "replacement"])
})

test("MCP manager 通过官方 SDK 完成 stdio、HTTP 与 legacy SSE 初始化和工具发现", async () => {
  const root = await mkdtemp(join(tmpdir(), "astock-mcp-"))
  const fixture = join(root, "stdio-server.ts")
  await writeFile(fixture, stdioServerSource())
  const http = createHttpFixture()
  const sse = createSseFixture()
  const origin = { source: "omp-project" as const, path: "/project/.omp/mcp.json" }
  const manager = new McpManager({
    configs: [
      {
        name: "stdio",
        type: "stdio",
        command: process.execPath,
        args: [fixture],
        cwd: root,
        timeout: 2_000,
        origin,
      },
      { name: "http", type: "http", url: http.url, timeout: 2_000, origin },
      { name: "sse", type: "sse", url: sse.url, timeout: 2_000, origin },
    ],
  })
  try {
    await manager.connect()
    expect(
      manager.getStatuses().map((status) => [status.name, status.state, status.toolCount]),
    ).toEqual([
      ["stdio", "connected", 1],
      ["http", "connected", 1],
      ["sse", "connected", 1],
    ])
    expect(
      manager.getConnections().flatMap((connection) => connection.tools.map((tool) => tool.name)),
    ).toEqual(["lookup", "lookup", "lookup"])
  } finally {
    await manager.dispose()
    http.stop()
    sse.stop()
    await rm(root, { recursive: true, force: true })
  }
})

function createHttpFixture(): { readonly url: string; stop(): void } {
  const server = Bun.serve({
    port: 0,
    fetch: async (request) =>
      request.method === "POST"
        ? jsonRpcResponse(await request.json())
        : new Response(null, { status: 405 }),
  })
  return { url: server.url.toString(), stop: () => server.stop(true) }
}

function createSseFixture(): { readonly url: string; stop(): void } {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  const encode = (value: string) => new TextEncoder().encode(value)
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (request.method === "GET" && url.pathname === "/") {
        const body = new ReadableStream<Uint8Array>({
          start(stream) {
            controller = stream
            stream.enqueue(encode("event: endpoint\ndata: /messages\n\n"))
          },
        })
        return new Response(body, { headers: { "content-type": "text/event-stream" } })
      }
      if (request.method === "POST" && url.pathname === "/messages") {
        const response = await jsonRpcPayload(await request.json())
        if (response !== undefined)
          controller?.enqueue(encode(`data: ${JSON.stringify(response)}\n\n`))
        return new Response(null, { status: 202 })
      }
      return new Response("not found", { status: 404 })
    },
  })
  return {
    url: server.url.toString(),
    stop: () => {
      try {
        controller?.close()
      } catch {}
      server.stop(true)
    },
  }
}

async function jsonRpcResponse(request: unknown): Promise<Response> {
  const response = await jsonRpcPayload(request)
  return response === undefined ? new Response(null, { status: 202 }) : Response.json(response)
}

async function jsonRpcPayload(request: unknown): Promise<Record<string, unknown> | undefined> {
  if (typeof request !== "object" || request === null) return undefined
  const method = Reflect.get(request, "method")
  const id = Reflect.get(request, "id")
  if (id === undefined) return undefined
  if (method === "initialize") {
    const parameters = Reflect.get(request, "params")
    const protocolVersion =
      typeof parameters === "object" && parameters !== null
        ? Reflect.get(parameters, "protocolVersion")
        : "2025-03-26"
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "fixture", version: "1" },
      },
    }
  }
  if (method === "tools/list")
    return {
      jsonrpc: "2.0",
      id,
      result: { tools: [{ name: "lookup", inputSchema: { type: "object" } }] },
    }
  if (method === "tools/call")
    return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "ok" }] } }
  return { jsonrpc: "2.0", id, result: {} }
}

function stdioServerSource(): string {
  return `import { createInterface } from "node:readline"
const input = createInterface({ input: process.stdin })
for await (const line of input) {
  const request = JSON.parse(line)
  if (request.id === undefined) continue
  const result = request.method === "initialize"
    ? { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } }
    : request.method === "tools/list"
      ? { tools: [{ name: "lookup", inputSchema: { type: "object" } }] }
      : request.method === "tools/call"
        ? { content: [{ type: "text", text: "ok" }] }
        : {}
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\\n")
}`
}
