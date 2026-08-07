import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { appendMemoryEntry, EMPTY_MEMORY_STATE } from "../src/agent/memory"
import { defaultMemoryPath, MemoryStore } from "../src/agent/memory-store"

function temporaryMemoryPath(): { readonly directory: string; readonly path: string } {
  const directory = mkdtempSync(join(tmpdir(), "astocktui-memory-"))
  return { directory, path: join(directory, "memory.json") }
}

describe("记忆持久化", () => {
  test("缺失文件返回 null，保存后回读一致", () => {
    const temporary = temporaryMemoryPath()
    try {
      const store = new MemoryStore(temporary.path)
      expect(store.load()).toBeNull()

      const now = new Date("2026-07-16T08:00:00.000Z")
      const { state } = appendMemoryEntry(
        EMPTY_MEMORY_STATE,
        { kind: "pattern", content: "缩量阴跌不抄底", source: "agent" },
        () => now,
      )
      store.save(state)

      const restored = new MemoryStore(temporary.path).load()
      expect(restored).toEqual(state)
      expect(JSON.parse(readFileSync(temporary.path, "utf8")).version).toBe(1)
    } finally {
      rmSync(temporary.directory, { recursive: true, force: true })
    }
  })

  test("损坏或结构无效的记忆文件明确报错", () => {
    const temporary = temporaryMemoryPath()
    try {
      writeFileSync(temporary.path, "{not-json", "utf8")
      expect(() => new MemoryStore(temporary.path).load()).toThrow("记忆文件损坏")

      writeFileSync(temporary.path, JSON.stringify({ version: 2 }), "utf8")
      expect(() => new MemoryStore(temporary.path).load()).toThrow("记忆文件损坏")
    } finally {
      rmSync(temporary.directory, { recursive: true, force: true })
    }
  })

  test("默认路径位于应用数据目录", () => {
    expect(defaultMemoryPath()).toContain("memory.json")
  })
})
