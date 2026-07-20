import { expect, test } from "bun:test"
import { AgentTaskScheduler, type AutomationTimer } from "../src/agent-scheduler"

let now = new Date("2026-07-20T00:45:00.000Z")
const callbacks: (() => void)[] = []
const timer: AutomationTimer = {
  setInterval(callback) {
    callbacks.push(callback)
    return callback
  },
  clearInterval(handle) {
    const index = callbacks.indexOf(handle as () => void)
    if (index >= 0) callbacks.splice(index, 1)
  },
}

test("调度器盘前每日一次并在盘中按间隔触发", () => {
  const events: string[] = []
  const scheduler = new AgentTaskScheduler({
    now: () => now,
    timer,
    sink: {
      enqueue: (event) => {
        events.push(event.kind)
        return "queued"
      },
    },
  })
  scheduler.start()
  expect(events).toEqual(["preopen"])
  now = new Date("2026-07-20T01:30:00.000Z")
  callbacks[0]?.()
  expect(events).toEqual(["preopen", "intraday"])
  callbacks[0]?.()
  expect(events).toHaveLength(2)
  scheduler.stop()
  expect(callbacks).toEqual([])
})

test("闲暇且非连续竞价时触发做梦整理，每日一次", () => {
  now = new Date("2026-07-18T12:00:00.000Z") // 周六 20:00（上海）
  const events: string[] = []
  const scheduler = new AgentTaskScheduler({
    now: () => now,
    timer,
    lastActivityAt: () => now.getTime() - 31 * 60_000,
    sink: {
      enqueue: (event) => {
        events.push(event.kind)
        return "queued"
      },
    },
  })
  scheduler.start()
  expect(events).toEqual(["dream"])
  const tick = callbacks[callbacks.length - 1]
  tick?.()
  expect(events).toEqual(["dream"])
  now = new Date("2026-07-19T12:30:00.000Z")
  tick?.()
  expect(events).toEqual(["dream", "dream"])
  scheduler.stop()
})

test("连续竞价时段或活动未超时不做梦", () => {
  now = new Date("2026-07-20T02:00:00.000Z") // 周一 10:00（上海）连续竞价
  const events: string[] = []
  const duringAuction = new AgentTaskScheduler({
    now: () => now,
    timer,
    lastActivityAt: () => now.getTime() - 24 * 3_600_000,
    sink: {
      enqueue: (event) => {
        events.push(event.kind)
        return "queued"
      },
    },
  })
  duringAuction.start()
  expect(events).not.toContain("dream")
  duringAuction.stop()

  now = new Date("2026-07-18T12:00:00.000Z")
  const recent = new AgentTaskScheduler({
    now: () => now,
    timer,
    lastActivityAt: () => now.getTime() - 5 * 60_000,
    sink: {
      enqueue: (event) => {
        events.push(event.kind)
        return "queued"
      },
    },
  })
  recent.start()
  expect(events).not.toContain("dream")
  recent.stop()
})

test("做梦空闲阈值可配置，runNow 手动触发并返回排队结果", () => {
  now = new Date("2026-07-18T12:00:00.000Z")
  const events: string[] = []
  const scheduler = new AgentTaskScheduler({
    now: () => now,
    timer,
    settings: { dreamIdleMinutes: 60 },
    lastActivityAt: () => now.getTime() - 31 * 60_000,
    sink: {
      enqueue: (event) => {
        events.push(event.kind)
        return events.length > 1 ? "deduped" : "queued"
      },
    },
  })
  scheduler.start()
  expect(events).toEqual([])
  expect(scheduler.runNow("dream")).toBe("queued")
  expect(scheduler.runNow("dream")).toBe("deduped")
  expect(events).toEqual(["dream", "dream"])
  scheduler.stop()
})

test("全局调度启用时调用用户任务 tick，停用后不再调用", () => {
  now = new Date("2026-07-20T00:45:00.000Z")
  const ticks: Date[] = []
  const scheduler = new AgentTaskScheduler({
    now: () => now,
    timer,
    sink: { enqueue: () => "queued" },
    tasks: { tick: (at) => ticks.push(at) },
  })
  scheduler.start()
  expect(ticks).toEqual([now])

  scheduler.setEnabled(false)
  now = new Date("2026-07-20T00:46:00.000Z")
  callbacks[0]?.()
  expect(ticks).toEqual([new Date("2026-07-20T00:45:00.000Z")])
  scheduler.stop()
})
