import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentSystemEvent } from "../src/agent-event-dispatcher"
import type { RefreshScheduler } from "../src/auto-refresh"
import { ScheduledTaskService } from "../src/scheduled-task-service"
import { ScheduledTaskStore } from "../src/scheduled-task-store"

let now = new Date("2026-07-20T00:44:00.000Z")

function fixture(): {
  readonly directory: string
  readonly events: AgentSystemEvent[]
  readonly service: ScheduledTaskService
  readonly tick: () => void
} {
  const directory = mkdtempSync(join(tmpdir(), "astocktui-custom-task-e2e-"))
  const events: AgentSystemEvent[] = []
  let callback: (() => void) | undefined
  const timer: RefreshScheduler = {
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
    timer,
  })
  return { directory, events, service, tick: () => callback?.() }
}

test("自定义任务由服务自调度触发，恢复后遵守暂停与删除", () => {
  const { directory, events, service, tick } = fixture()
  try {
    const task = service.create(
      { name: "盘前自检", prompt: "检查隔夜风险", schedule: { kind: "interval", minutes: 1 } },
      "user",
    )
    now = new Date("2026-07-20T00:45:00.000Z")
    service.start()
    expect(events.map((event) => event.kind)).toEqual(["custom"])
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

    service.stop()
    now = new Date("2026-07-20T03:47:00.000Z")
    tick()
    expect(events).toHaveLength(2)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
