import { describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentSystemEvent } from "../src/agent-event-dispatcher"
import type { CommandContext } from "../src/commands"
import { createScheduledTaskSink, extractSummary } from "../src/research-task-runner"
import type { ScheduledTaskEvent } from "../src/scheduled-task-service"

const NOW = new Date("2026-07-17T07:10:00.000Z") // 周五 15:10（上海）

function taskEvent(overrides: Partial<ScheduledTaskEvent> = {}): ScheduledTaskEvent {
  return {
    kind: "custom",
    dedupeKey: "task:TASK-0001",
    title: "收盘复盘",
    prompt: "[定时任务·收盘复盘] 总结今日市场与持仓",
    createdAt: NOW.toISOString(),
    taskId: "TASK-0001",
    taskName: "收盘复盘",
    mode: "research",
    source: "agent",
    ...overrides,
  }
}

function fixture(options: { readonly report?: string; readonly failWith?: string } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "astocktui-research-runner-"))
  const enqueued: AgentSystemEvent[] = []
  const marks: { id: string; state: string; reason?: string }[] = []
  const refreshed: string[] = []
  const runs: string[] = []
  const context = {
    refreshAndWait: async (target: string) => {
      refreshed.push(target)
    },
  } as unknown as CommandContext
  const sink = createScheduledTaskSink({
    context,
    dispatcher: {
      enqueue(event) {
        enqueued.push(event)
        return "queued"
      },
    },
    tasks: () => ({
      markRunResult(id, state, reason) {
        marks.push({ id, state, ...(reason === undefined ? {} : { reason }) })
      },
    }),
    runResearch: async (_context, prompt) => {
      runs.push(prompt)
      if (options.failWith !== undefined) throw new Error(options.failWith)
      return options.report ?? "# 收盘复盘\n\n正文\n\n## 摘要\n- 市场缩量上涨\n- 持仓风险可控\n"
    },
    reportsDir: directory,
    now: () => NOW,
  })
  return { directory, enqueued, marks, refreshed, runs, sink }
}

describe("定时任务路由 sink", () => {
  test("agent 模式事件原样转发主 agent dispatcher", () => {
    const { directory, enqueued, refreshed, runs, sink } = fixture()
    try {
      const event = taskEvent({ mode: "agent" })
      expect(sink.enqueue(event)).toBe("queued")
      expect(enqueued).toEqual([event])
      expect(refreshed).toEqual([])
      expect(runs).toEqual([])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("research 模式先刷新数据再跑子任务，报告落盘、摘要回流并标记完成", async () => {
    const { directory, enqueued, marks, refreshed, runs, sink } = fixture()
    try {
      expect(sink.enqueue(taskEvent())).toBe("queued")
      expect(enqueued).toEqual([]) // 触发时不占用主对话
      await sink.whenIdle()

      expect(refreshed).toEqual(["all"])
      expect(runs).toEqual(["[定时任务·收盘复盘] 总结今日市场与持仓"])

      const files = readdirSync(directory)
      expect(files).toEqual(["2026-07-17-收盘复盘.md"])
      expect(readFileSync(join(directory, files[0] ?? ""), "utf8")).toContain("# 收盘复盘")

      expect(enqueued).toHaveLength(1)
      expect(enqueued[0]).toMatchObject({
        kind: "research",
        dedupeKey: "task:TASK-0001",
        taskId: "TASK-0001",
      })
      expect(enqueued[0]?.prompt).toContain("2026-07-17-收盘复盘.md")
      expect(enqueued[0]?.prompt).toContain("- 市场缩量上涨")
      expect(enqueued[0]?.prompt).not.toContain("正文")
      expect(marks).toEqual([{ id: "TASK-0001", state: "completed" }])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("报告文件名清洗非法字符", async () => {
    const { directory, sink } = fixture()
    try {
      sink.enqueue(taskEvent({ taskName: 'A/B:复盘?"*<>| 测试' }))
      await sink.whenIdle()
      const files = readdirSync(directory)
      expect(files).toHaveLength(1)
      expect(files[0]).toMatch(/^2026-07-17-[A-Za-z0-9一-鿿-]+\.md$/u)
      expect(files[0]).not.toMatch(/[\\/:*?"<>|\s]/u)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("子任务异常时标记失败并回流失败提示，不抛出", async () => {
    const { directory, enqueued, marks, sink } = fixture({ failWith: "模型额度耗尽" })
    try {
      sink.enqueue(taskEvent())
      await sink.whenIdle()
      expect(marks).toEqual([{ id: "TASK-0001", state: "failed", reason: "模型额度耗尽" }])
      expect(enqueued).toHaveLength(1)
      expect(enqueued[0]?.prompt).toContain("模型额度耗尽")
      expect(readdirSync(directory)).toEqual([])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe("摘要提取", () => {
  test("取「摘要」节内容，缺失时退化为全文前 10 行", () => {
    const withSection = "# 报告\n\n正文一\n\n## 摘要\n- 要点一\n- 要点二\n"
    expect(extractSummary(withSection, 80)).toBe("- 要点一\n- 要点二")

    const long = Array.from({ length: 20 }, (_, index) => `第${index + 1}行`).join("\n")
    expect(extractSummary(long, 80).split("\n")).toHaveLength(10)
  })

  test("摘要行按给定宽度截断", () => {
    const report = "## 摘要\n- 这是一段特别特别长的摘要内容需要被截断\n"
    for (const line of extractSummary(report, 12).split("\n")) {
      expect([...line].length).toBeLessThanOrEqual(12)
    }
  })
})
