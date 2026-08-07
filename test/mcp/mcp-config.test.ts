import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadMcpConfigs } from "../../src/mcp/config"

async function fixture(): Promise<{ readonly root: string; readonly home: string }> {
  const root = await mkdtemp(join(tmpdir(), "astock-mcp-config-"))
  const home = join(root, "home")
  await mkdir(home)
  return { root, home }
}

async function config(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true })
  await writeFile(path, JSON.stringify(value))
}

test("MCP 配置按 OMP 优先级合并、禁用 server 并展开环境变量", async () => {
  const { root, home } = await fixture()
  const token = "$" + "{TOKEN}"
  const fallback = "$" + "{MISSING:-default}"
  const unresolved = "$" + "{NOPE}"
  try {
    await config(join(root, ".omp", "mcp.json"), {
      mcpServers: {
        shared: { command: "native" },
        remote: {
          type: "http",
          url: "https://mcp.example.com",
          headers: {
            Authorization: `Bearer ${token}`,
            Fallback: fallback,
            Literal: unresolved,
          },
        },
      },
    })
    await config(join(root, "mcp.json"), {
      mcpServers: { shared: { command: "root" }, disabled: { command: "disabled" } },
    })
    await config(join(root, ".mcp.json"), { mcpServers: { compatibility: { command: "compat" } } })
    await config(join(home, ".omp", "agent", "mcp.json"), {
      mcpServers: { user: { command: "user" } },
      disabledServers: ["disabled"],
    })

    const result = await loadMcpConfigs({ cwd: root, home, env: { TOKEN: "secret" } })

    expect(result.servers.map((server) => server.name)).toEqual([
      "shared",
      "remote",
      "compatibility",
      "user",
    ])
    expect(result.servers[0]).toMatchObject({
      command: "native",
      origin: { source: "omp-project" },
    })
    expect(result.servers[1]).toMatchObject({
      headers: { Authorization: "Bearer secret", Fallback: "default", Literal: unresolved },
    })
    expect(JSON.stringify(result.diagnostics)).not.toContain("secret")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("MCP 配置隔离无效、禁用和不安全 transport", async () => {
  const { root, home } = await fixture()
  try {
    await config(join(root, ".omp", "mcp.json"), {
      mcpServers: {
        off: { enabled: false, command: "skip" },
        "bad name": { command: "bad" },
        httpMissingUrl: { type: "http" },
        unsafeHttp: { type: "http", url: "file:///private" },
        valid: { type: "sse", url: "https://mcp.example.com/sse", timeout: 50 },
      },
    })

    const result = await loadMcpConfigs({ cwd: root, home, env: {} })

    expect(result.servers).toEqual([
      expect.objectContaining({ name: "valid", type: "sse", timeout: 50 }),
    ])
    expect(result.diagnostics.map((item) => item.subject).sort()).toEqual([
      "bad name",
      "httpMissingUrl",
      "unsafeHttp",
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
