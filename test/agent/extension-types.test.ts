import { expect, test } from "bun:test"
import {
  MCP_CONFIG_SOURCES,
  MCP_CONNECTION_STATES,
  MCP_TRANSPORT_KINDS,
} from "../../src/agent/extension-types"

test("扩展运行时公开 OMP 兼容的传输、来源和连接状态契约", () => {
  expect(MCP_TRANSPORT_KINDS).toEqual(["stdio", "http", "sse"])
  expect(MCP_CONFIG_SOURCES).toEqual(["omp-project", "root-mcp", "root-dot-mcp", "omp-user"])
  expect(MCP_CONNECTION_STATES).toEqual(["connecting", "connected", "disconnected", "error"])
})
