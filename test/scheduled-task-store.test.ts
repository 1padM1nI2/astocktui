import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type ScheduledTaskState, ScheduledTaskStore } from "../src/agent/scheduled-task-store"

function fixture(): { readonly directory: string; readonly path: string } {
  const directory = mkdtempSync(join(tmpdir(), "astocktui-scheduled-tasks-"))
  return { directory, path: join(directory, "scheduled-tasks.json") }
}

const state: ScheduledTaskState = {
  version: 1,
  sequence: 1,
  tasks: [
    {
      id: "TASK-0001",
      name: "收盘复盘",
      prompt: "总结市场和持仓",
      schedule: { kind: "daily", time: "15:10", weekdaysOnly: true },
      createdBy: "user",
      createdAt: "2026-07-17T07:00:00.000Z",
      updatedAt: "2026-07-17T07:00:00.000Z",
      enabled: true,
      nextRunAt: "2026-07-20T07:10:00.000Z",
    },
  ],
}

test("定时任务存储原子保存并恢复版本化状态", () => {
  const temporary = fixture()
  try {
    const store = new ScheduledTaskStore(temporary.path)
    expect(store.load()).toEqual({
      state: { version: 1, sequence: 0, tasks: [] },
      diagnostic: null,
    })

    store.save(state)
    expect(JSON.parse(readFileSync(temporary.path, "utf8"))).toEqual(state)
    expect(store.load()).toEqual({ state, diagnostic: null })
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true })
  }
})

test("任务模式随状态持久化往返，旧文件缺少模式字段仍可加载", () => {
  const temporary = fixture()
  try {
    const withMode: ScheduledTaskState = {
      ...state,
      tasks: state.tasks.map((task) => ({ ...task, mode: "research" as const })),
    }
    const store = new ScheduledTaskStore(temporary.path)
    store.save(withMode)
    expect(store.load()).toEqual({ state: withMode, diagnostic: null })

    writeFileSync(temporary.path, JSON.stringify(state), "utf8")
    const legacy = store.load()
    expect(legacy.diagnostic).toBeNull()
    expect(legacy.state.tasks[0]).toMatchObject({ id: "TASK-0001" })
    expect(legacy.state.tasks[0]?.mode).toBeUndefined()
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true })
  }
})

test("损坏或不兼容文件安全降级且不覆盖原内容", () => {
  const temporary = fixture()
  try {
    writeFileSync(temporary.path, "{not-json", "utf8")
    const corrupt = new ScheduledTaskStore(temporary.path).load()
    expect(corrupt.state).toEqual({ version: 1, sequence: 0, tasks: [] })
    expect(corrupt.diagnostic).toContain("定时任务文件损坏")
    expect(readFileSync(temporary.path, "utf8")).toBe("{not-json")

    writeFileSync(temporary.path, JSON.stringify({ version: 2, tasks: [] }), "utf8")
    expect(new ScheduledTaskStore(temporary.path).load().diagnostic).toContain("定时任务文件损坏")
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true })
  }
})
