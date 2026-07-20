import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ScheduledTaskService } from "../src/scheduled-task-service"
import { ScheduledTaskStore } from "../src/scheduled-task-store"

let now = new Date("2026-07-17T01:00:00.000Z")

function fixture(result: "queued" | "deduped" = "queued"): {
  readonly directory: string
  readonly events: unknown[]
  readonly service: ScheduledTaskService
} {
  const directory = mkdtempSync(join(tmpdir(), "astocktui-scheduled-task-service-"))
  const events: unknown[] = []
  const service = new ScheduledTaskService({
    now: () => now,
    store: new ScheduledTaskStore(join(directory, "scheduled-tasks.json")),
    sink: {
      enqueue(event) {
        events.push(event)
        return result
      },
    },
  })
  return { directory, events, service }
}

describe("自定义定时任务服务", () => {
  test("创建、更新、暂停、恢复和删除任务时保留来源并持久化", () => {
    const { directory, service } = fixture()
    try {
      const task = service.create(
        {
          name: "收盘复盘",
          prompt: "总结市场与持仓",
          schedule: { kind: "daily", time: "15:10", weekdaysOnly: true },
        },
        "agent",
      )
      expect(task).toMatchObject({ id: "TASK-0001", createdBy: "agent", enabled: true })
      expect(service.update(task.id, { ...task, name: "午后复盘" }, "user")).toMatchObject({
        name: "午后复盘",
        updatedBy: "user",
      })
      expect(service.pause(task.id).enabled).toBe(false)
      expect(service.resume(task.id).enabled).toBe(true)
      expect(service.remove(task.id)).toBe(true)
      expect(service.list()).toEqual([])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("到期任务先持久化推进后提交唯一系统事件，手动运行不改变下次时间", () => {
    const { directory, events, service } = fixture()
    try {
      const task = service.create(
        {
          name: "盘前检查",
          prompt: "检查隔夜风险",
          schedule: { kind: "once", at: "2026-07-17T01:01:00.000Z" },
        },
        "user",
      )
      const scheduledAt = task.nextRunAt
      expect(service.runNow(task.id)).toBe("queued")
      expect(service.get(task.id)?.nextRunAt).toBe(scheduledAt)

      now = new Date("2026-07-17T01:01:00.000Z")
      service.tick(now)
      expect(events).toHaveLength(2)
      expect(events[1]).toMatchObject({ kind: "custom", taskId: task.id, source: "user" })
      expect(service.get(task.id)).toMatchObject({ enabled: false, nextRunAt: null })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("去重或非法输入不会留下部分状态", () => {
    const { directory, service } = fixture("deduped")
    try {
      expect(() =>
        service.create(
          { name: "", prompt: "x", schedule: { kind: "interval", minutes: 5 } },
          "user",
        ),
      ).toThrow("任务名称")
      const task = service.create(
        { name: "整点检查", prompt: "检查市场", schedule: { kind: "interval", minutes: 5 } },
        "user",
      )
      expect(service.runNow(task.id)).toBe("deduped")
      expect(service.get(task.id)?.lastRun).toMatchObject({ state: "skipped" })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
