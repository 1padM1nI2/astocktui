import { expect, test } from "bun:test"
import type { McpServerConfig } from "../../src/agent/extension-types"
import type { McpServerConnection } from "../../src/mcp/manager"
import { bridgeMcpTools, sanitizeMcpToolName } from "../../src/mcp/tool-bridge"

const config: McpServerConfig = {
  name: "Market Data",
  type: "http",
  url: "https://mcp.example.com",
  timeout: 100,
  origin: { source: "omp-project", path: "/project/.omp/mcp.json" },
}

test("MCP 工具保留 schema、命名空间和远端文本图片结果", async () => {
  const schema = { type: "object", properties: { code: { type: "string" } }, required: ["code"] }
  const calls: unknown[][] = []
  const server: McpServerConnection = {
    name: config.name,
    config,
    tools: [],
    async callTool(...args) {
      calls.push(args)
      return {
        content: [
          { type: "text", text: "SH600519" },
          { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
        ],
      }
    },
  }

  const [tool] = bridgeMcpTools(server, [
    { name: "Quote Price", description: "读取报价", inputSchema: schema },
  ])
  if (tool === undefined) throw new Error("工具未桥接")
  const result = await tool.execute("call-1", { code: "600519" })

  expect(tool.name).toBe("mcp__market_data_quote_price")
  expect(tool.description).toBe("读取报价")
  expect(tool.parameters).toBe(schema)
  expect(calls).toEqual([["Quote Price", { code: "600519" }, undefined]])
  expect(result).toMatchObject({
    content: [
      { type: "text", text: "SH600519" },
      { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
    ],
  })
})

test("MCP 工具规避名称冲突并将异常或畸形响应降级为工具错误", async () => {
  const server: McpServerConnection = {
    name: "server",
    config: { ...config, name: "server" },
    tools: [],
    async callTool(name) {
      if (name === "throws") throw new Error("secret-token")
      return { content: "invalid" }
    },
  }
  const tools = bridgeMcpTools(server, [
    { name: "same-name", inputSchema: { type: "object" } },
    { name: "same_name", inputSchema: { type: "object" } },
    { name: "throws", inputSchema: { type: "object" } },
  ])

  expect(tools.map((tool) => tool.name)).toEqual([
    "mcp__server_same_name",
    "mcp__server_same_name_2",
    "mcp__server_throws",
  ])
  await expect(tools[0]?.execute("call", {})).resolves.toMatchObject({ isError: true })
  await expect(tools[2]?.execute("call", {})).resolves.toMatchObject({
    isError: true,
    content: [{ type: "text", text: "MCP 工具调用失败" }],
  })
  expect(sanitizeMcpToolName(" A/B ", " C.D ")).toBe("mcp__a_b_c_d")
})
