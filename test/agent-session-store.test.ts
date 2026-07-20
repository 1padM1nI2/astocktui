import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AgentSessionStore } from "../src/agent-session-store"

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "astocktui-agent-session-"))
}

const USER_MESSAGE = { role: "user", content: "分析一下贵州茅台", timestamp: 1_752_800_000_000 }
const ASSISTANT_MESSAGE = {
  role: "assistant",
  content: [{ type: "text", text: "贵州茅台短线偏强" }],
  timestamp: 1_752_800_001_000,
}

describe("Agent 会话持久化", () => {
  test("保存并按原样读取对话消息", () => {
    const directory = tempDir()
    try {
      const path = join(directory, "agent-session.json")
      const store = new AgentSessionStore(path)

      store.save([USER_MESSAGE, ASSISTANT_MESSAGE])
      const loaded = store.load()

      expect(loaded.diagnostic).toBeNull()
      expect(loaded.state.messages).toEqual([USER_MESSAGE, ASSISTANT_MESSAGE])
      const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
      expect(raw["version"]).toBe(1)
      expect(typeof raw["savedAt"]).toBe("string")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("文件不存在时返回空会话且无诊断", () => {
    const directory = tempDir()
    try {
      const loaded = new AgentSessionStore(join(directory, "agent-session.json")).load()

      expect(loaded.state.messages).toEqual([])
      expect(loaded.diagnostic).toBeNull()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("损坏或结构无效的会话文件返回空会话并报告诊断", () => {
    const directory = tempDir()
    try {
      const corrupted = join(directory, "corrupted.json")
      writeFileSync(corrupted, "不是 JSON", "utf8")
      const corruptedLoad = new AgentSessionStore(corrupted).load()
      expect(corruptedLoad.state.messages).toEqual([])
      expect(corruptedLoad.diagnostic).toContain("损坏")

      const invalid = join(directory, "invalid.json")
      writeFileSync(invalid, JSON.stringify({ version: 2, messages: [] }), "utf8")
      const invalidLoad = new AgentSessionStore(invalid).load()
      expect(invalidLoad.state.messages).toEqual([])
      expect(invalidLoad.diagnostic).toContain("损坏")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("超过上限时保留最近消息并从用户消息边界截断", () => {
    const directory = tempDir()
    try {
      const store = new AgentSessionStore(join(directory, "agent-session.json"), {
        maxMessages: 3,
      })
      const messages = [
        { role: "user", content: "第一问" },
        { role: "assistant", content: "第一答" },
        { role: "assistant", content: "工具补充" },
        { role: "user", content: "第二问" },
        { role: "assistant", content: "第二答" },
      ]

      store.save(messages)

      expect(store.load().state.messages).toEqual([
        { role: "user", content: "第二问" },
        { role: "assistant", content: "第二答" },
      ])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("保存空消息列表覆盖旧会话", () => {
    const directory = tempDir()
    try {
      const path = join(directory, "agent-session.json")
      const store = new AgentSessionStore(path)
      store.save([USER_MESSAGE])

      store.save([])

      expect(store.load().state.messages).toEqual([])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
