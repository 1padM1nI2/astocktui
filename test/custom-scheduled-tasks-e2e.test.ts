import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type AgentSystemEvent,
  AgentTaskScheduler,
  type AutomationTimer,
} from "../src/agent-scheduler"
import { ScheduledTaskService } from "../src/scheduled-task-service"
import { ScheduledTaskStore } from "../src/scheduled-task-store"

let now = new Date("2026-07-20T00:44:00.000Z")

function fixture(): {
  readonly directory: string
  readonly events: AgentSystemEvent[]
  readonly scheduler: AgentTaskScheduler
  readonly service: ScheduledTaskService
  readonly tick: () => void
} {
  const directory = mkdtempSync(join(tmpdir(), "astocktui-custom-task-e2e-"))
  const events: AgentSystemEvent[] = []
  let callback: (() => void) | undefined
  const timer: AutomationTimer = {
    setInterval(next) {
      callback = next
      return next
    },
    clearInterval() {
      callback = undefined
    },
  }
  const sink = {
    enqueue(event: AgentSystemEvent): "queued" {
      events.push(event)
      return "queued"
    },
  }
  const service = new ScheduledTaskService({
    store: new ScheduledTaskStore(join(directory, "scheduled-tasks.json")),
    sink,
    now: () => now,
  })
  const scheduler = new AgentTaskScheduler({ now: () => now, timer, sink, tasks: service })
  return { directory, events, scheduler, service, tick: () => callback?.() }
}

test("自定义任务与内置盘前任务共用调度器，恢复后遵守暂停、删除和全局关闭", () => {
  const { directory, events, scheduler, service, tick } = fixture()
  try {
    const task = service.create(
      { name: "盘前自检", prompt: "检查隔夜风险", schedule: { kind: "interval", minutes: 1 } },
      "user",
    )
    now = new Date("2026-07-20T00:45:00.000Z")
    scheduler.start()
    expect(events.map((event) => event.kind)).toEqual(["preopen", "custom"])
    expect(events.at(-1)).toMatchObject({ taskId: task.id, taskName: "盘前自检", source: "user" })

    now = new Date("2026-07-20T03:45:00.000Z")
    tick()
    expect(events.filter((event) => event.kind === "custom")).toHaveLength(2)

    const restored = new ScheduledTaskService({
      store: new ScheduledTaskStore(join(directory, "scheduled-tasks.json")),
      sink: { enqueue: () => "queued" },
      now: () => now,
    })
    expect(restored.get(task.id)).toMatchObject({ enabled: true })
    service.pause(task.id)
    expect(
      new ScheduledTaskService({
        store: new ScheduledTaskStore(join(directory, "scheduled-tasks.json")),
        sink: { enqueue: () => "queued" },
      }).get(task.id),
    ).toMatchObject({ enabled: false })
    now = new Date("2026-07-20T03:46:00.000Z")
    tick()
    expect(events.filter((event) => event.kind === "custom")).toHaveLength(2)

    service.remove(task.id)
    expect(
      new ScheduledTaskService({
        store: new ScheduledTaskStore(join(directory, "scheduled-tasks.json")),
        sink: { enqueue: () => "queued" },
      }).list(),
    ).toEqual([])

    scheduler.setEnabled(false)
    now = new Date("2026-07-20T03:47:00.000Z")
    tick()
    expect(events).toHaveLength(3)
    scheduler.stop()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
