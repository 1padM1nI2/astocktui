import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentTool } from "@oh-my-pi/pi-agent-core"
import { createFileAgentTools } from "../../src/agent/file-tools"

async function runTool(
  tools: readonly AgentTool[],
  name: string,
  params: Record<string, unknown> = {},
  // biome-ignore lint/suspicious/noExplicitAny: 测试结果 JSON 形状按用例断言
): Promise<any> {
  const tool = tools.find((candidate) => candidate.name === name)
  if (tool === undefined) throw new Error(`工具不存在：${name}`)
  const result = await tool.execute("test-call", params)
  const text = result.content.find((item) => item.type === "text")?.text
  return text === undefined ? null : JSON.parse(text)
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "astocktui-file-agent-tools-"))
}

describe("Agent 文件系统工具", () => {
  test("read 读取目录时列出条目而不是抛出 EISDIR", async () => {
    const directory = tempDir()
    try {
      globalThis.tool = undefined
      writeFileSync(join(directory, "note.txt"), "ok\n", "utf8")
      mkdirSync(join(directory, "sub"))
      const tools = createFileAgentTools()

      const listing = await runTool(tools, "read", { path: directory })

      expect(listing.type).toBe("directory")
      expect(listing.entries).toHaveLength(2)
      expect(listing.entries).toContainEqual({ name: "note.txt", type: "file", size: 3 })
      expect(listing.entries).toContainEqual({ name: "sub", type: "directory", size: null })
    } finally {
      globalThis.tool = undefined
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("read 在本地回退下仍支持行范围选择器", async () => {
    const directory = tempDir()
    try {
      globalThis.tool = undefined
      const path = join(directory, "复盘.md")
      writeFileSync(path, "第一行\n第二行\n第三行\n", "utf8")
      const tools = createFileAgentTools()

      expect(await runTool(tools, "read", { path, selector: "2-3" })).toBe("第二行\n第三行")
    } finally {
      globalThis.tool = undefined
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("write 自动创建父目录并整体覆盖已有文件", async () => {
    const directory = tempDir()
    try {
      const path = join(directory, "nested", "复盘.md")
      const tools = createFileAgentTools()

      const written = await runTool(tools, "write", { path, content: "复盘" })
      expect(written).toMatchObject({ ok: true, path, bytes: 6 })
      expect(readFileSync(path, "utf8")).toBe("复盘")

      await runTool(tools, "write", { path, content: "更新" })
      expect(readFileSync(path, "utf8")).toBe("更新")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("list 返回目录条目的类型和大小", async () => {
    const directory = tempDir()
    try {
      writeFileSync(join(directory, "a.txt"), "abc", "utf8")
      mkdirSync(join(directory, "b"))
      const tools = createFileAgentTools()

      const listing = await runTool(tools, "list", { path: directory })

      expect(listing.path).toBe(directory)
      expect(listing.entries).toContainEqual({ name: "a.txt", type: "file", size: 3 })
      expect(listing.entries).toContainEqual({ name: "b", type: "directory", size: null })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("move 移动文件并自动创建目标父目录", async () => {
    const directory = tempDir()
    try {
      const from = join(directory, "old.txt")
      const to = join(directory, "archive", "new.txt")
      writeFileSync(from, "ok", "utf8")
      const tools = createFileAgentTools()

      expect(await runTool(tools, "move", { from, to })).toMatchObject({ ok: true, from, to })
      expect(existsSync(from)).toBe(false)
      expect(readFileSync(to, "utf8")).toBe("ok")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("mkdir 递归创建目录且重复调用不报错", async () => {
    const directory = tempDir()
    try {
      const path = join(directory, "a", "b", "c")
      const tools = createFileAgentTools()

      expect(await runTool(tools, "mkdir", { path })).toMatchObject({ ok: true, path })
      expect(existsSync(path)).toBe(true)
      expect(await runTool(tools, "mkdir", { path })).toMatchObject({ ok: true })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("delete 删除文件，删除目录必须显式 recursive", async () => {
    const directory = tempDir()
    try {
      const file = join(directory, "gone.txt")
      writeFileSync(file, "ok", "utf8")
      const nested = join(directory, "nested")
      mkdirSync(nested)
      writeFileSync(join(nested, "inner.txt"), "ok", "utf8")
      const tools = createFileAgentTools()

      expect(await runTool(tools, "delete", { path: file })).toMatchObject({ ok: true })
      expect(existsSync(file)).toBe(false)

      await expect(runTool(tools, "delete", { path: nested })).rejects.toThrow("recursive")
      expect(existsSync(nested)).toBe(true)

      expect(await runTool(tools, "delete", { path: nested, recursive: true })).toMatchObject({
        ok: true,
      })
      expect(existsSync(nested)).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("delete 声明为强制确认的不可逆操作", () => {
    const tool = createFileAgentTools().find((candidate) => candidate.name === "delete")

    expect(tool).toMatchObject({ approval: { tier: "exec", override: true } })
  })
})
