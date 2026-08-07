import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeMcpServer, upsertMcpServer } from "../../src/mcp/config-writer"

async function fixture(): Promise<string> {
  return mkdtemp(join(tmpdir(), "astock-mcp-writer-"))
}

async function saved(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>
}

test("upsert 写入不存在的 mcp.json 并显式记录 type", async () => {
  const root = await fixture()
  try {
    const path = join(root, "mcp.json")
    const token = "$" + "{TOKEN}"
    upsertMcpServer(path, "quote", {
      command: "bun",
      args: ["run", "server.ts"],
      env: { TOKEN: token },
    })
    expect(await saved(path)).toEqual({
      mcpServers: {
        quote: {
          type: "stdio",
          command: "bun",
          args: ["run", "server.ts"],
          env: { TOKEN: token },
        },
      },
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("upsert 保留其他 server 与未知顶层字段，同名覆盖", async () => {
  const root = await fixture()
  try {
    const path = join(root, "mcp.json")
    await writeFile(
      path,
      JSON.stringify({
        mcpServers: {
          keep: { command: "keep" },
          quote: { command: "old" },
        },
        disabledServers: ["keep"],
        custom: { nested: true },
      }),
    )
    upsertMcpServer(path, "quote", { type: "http", url: "https://mcp.example.com", timeout: 50 })
    expect(await saved(path)).toEqual({
      mcpServers: {
        keep: { command: "keep" },
        quote: { type: "http", url: "https://mcp.example.com", timeout: 50 },
      },
      disabledServers: ["keep"],
      custom: { nested: true },
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("remove 删除存在的 server，缺失时返回 false", async () => {
  const root = await fixture()
  try {
    const path = join(root, "mcp.json")
    expect(removeMcpServer(path, "quote")).toBe(false)
    await writeFile(path, JSON.stringify({ mcpServers: { quote: { command: "q" } } }))
    expect(removeMcpServer(path, "missing")).toBe(false)
    expect(removeMcpServer(path, "quote")).toBe(true)
    expect(await saved(path)).toEqual({ mcpServers: {} })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("非法名称与非法定义被拒绝", async () => {
  const root = await fixture()
  try {
    const path = join(root, "mcp.json")
    expect(() => upsertMcpServer(path, "bad name", { command: "x" })).toThrow("名称无效")
    expect(() => upsertMcpServer(path, "stdioMissing", {})).toThrow("command")
    expect(() => upsertMcpServer(path, "httpMissing", { type: "http" })).toThrow("url")
    expect(() => upsertMcpServer(path, "unsafe", { type: "sse", url: "file:///private" })).toThrow(
      "url",
    )
    expect(() =>
      upsertMcpServer(path, "both", { command: "x", url: "https://mcp.example.com" }),
    ).toThrow("不能同时")
    expect(() => upsertMcpServer(path, "badTimeout", { command: "x", timeout: -1 })).toThrow(
      "timeout",
    )
    await writeFile(path, JSON.stringify(["not", "an", "object"]))
    expect(() => upsertMcpServer(path, "quote", { command: "x" })).toThrow("根节点")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
