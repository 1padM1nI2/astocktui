import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ToolCallLogger } from "../src/tool-call-log"

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "astocktui-tool-call-log-"))
}

function readLines(path: string): Record<string, unknown>[] {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe("工具调用日志", () => {
  test("记录开始与结束并计算耗时", () => {
    const directory = tempDir()
    try {
      const path = join(directory, "tools.log")
      let tick = 0
      const logger = new ToolCallLogger(path, {
        now: () => new Date(1_752_800_000_000 + tick * 40),
      })

      logger.recordStart({ id: "c1", name: "manage_scheduled_task", args: { action: "create" } })
      tick = 1
      logger.recordEnd({
        id: "c1",
        name: "manage_scheduled_task",
        isError: true,
        result: { content: [{ type: "text", text: "校验失败" }] },
      })

      const lines = readLines(path)
      expect(lines).toHaveLength(2)
      expect(lines[0]).toMatchObject({
        phase: "start",
        id: "c1",
        name: "manage_scheduled_task",
        args: { action: "create" },
      })
      expect(typeof lines[0]?.["timestamp"]).toBe("string")
      expect(lines[1]).toMatchObject({ phase: "end", id: "c1", isError: true, durationMs: 40 })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("没有匹配开始的结束记录不带耗时", () => {
    const directory = tempDir()
    try {
      const path = join(directory, "tools.log")
      const logger = new ToolCallLogger(path)

      logger.recordEnd({ id: "c9", name: "read", isError: false, result: "ok" })

      const line = readLines(path)[0]
      expect(line).toMatchObject({ phase: "end", id: "c9" })
      expect("durationMs" in (line ?? {})).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("超长参数被截断并保留可读前缀", () => {
    const directory = tempDir()
    try {
      const path = join(directory, "tools.log")
      const logger = new ToolCallLogger(path)

      logger.recordStart({ id: "c1", name: "write", args: { content: "x".repeat(5_000) } })

      const args = readLines(path)[0]?.["args"]
      expect(typeof args).toBe("string")
      expect(String(args).length).toBeLessThan(1_100)
      expect(String(args)).toContain("…")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("文件超过阈值时轮转为单个备份", () => {
    const directory = tempDir()
    try {
      const path = join(directory, "tools.log")
      writeFileSync(path, "x".repeat(2_000))
      const logger = new ToolCallLogger(path, { maxBytes: 1_000 })

      logger.recordStart({ id: "c1", name: "read" })

      expect(readFileSync(`${path}.1`, "utf8")).toBe("x".repeat(2_000))
      expect(readLines(path)).toHaveLength(1)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("写入失败不抛出并记录诊断信息", () => {
    const directory = tempDir()
    try {
      const logger = new ToolCallLogger(directory)

      expect(() => logger.recordStart({ id: "c1", name: "read" })).not.toThrow()
      expect(logger.error).not.toBeNull()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
