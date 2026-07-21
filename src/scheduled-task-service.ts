import type { RefreshScheduler } from "./auto-refresh"
import type { ScheduledTaskState, ScheduledTaskStore } from "./scheduled-task-store"
import {
  advanceScheduledTask,
  nextScheduledRunAt,
  type ScheduledTask,
  type ScheduledTaskInput,
  type ScheduledTaskSource,
  validateScheduledTaskInput,
} from "./scheduled-tasks"

export interface ScheduledTaskEvent {
  readonly kind: "custom"
  readonly dedupeKey: string
  readonly title: string
  readonly prompt: string
  readonly createdAt: string
  readonly taskId: string
  readonly taskName: string
  readonly source: ScheduledTaskSource
}

export interface ScheduledTaskEventSink {
  enqueue(event: ScheduledTaskEvent): "queued" | "deduped"
}

export interface ScheduledTaskServiceOptions {
  readonly store: ScheduledTaskStore
  readonly sink: ScheduledTaskEventSink
  readonly now?: () => Date
  readonly timer?: RefreshScheduler | undefined
}

export interface ScheduledTaskSummary {
  readonly enabledCount: number
  readonly nextTask: ScheduledTask | null
  readonly lastTask: ScheduledTask | null
  readonly diagnostic: string | null
}

export class ScheduledTaskService {
  readonly #store: ScheduledTaskStore
  readonly #sink: ScheduledTaskEventSink
  readonly #now: () => Date
  readonly #timer: RefreshScheduler | undefined
  #state: ScheduledTaskState
  #diagnostic: string | null
  #handle: unknown

  constructor(options: ScheduledTaskServiceOptions) {
    this.#store = options.store
    this.#sink = options.sink
    this.#now = options.now ?? (() => new Date())
    this.#timer = options.timer
    const loaded = this.#store.load()
    this.#state = loaded.state
    this.#diagnostic = loaded.diagnostic
  }

  get running(): boolean {
    return this.#handle !== undefined
  }

  start(): void {
    if (this.#timer === undefined || this.running) return
    this.tick()
    this.#handle = this.#timer.setInterval(() => this.tick(), 60_000)
  }

  stop(): void {
    if (this.#handle !== undefined) this.#timer?.clearInterval(this.#handle)
    this.#handle = undefined
  }

  list(): readonly ScheduledTask[] {
    return this.#state.tasks
  }

  get(id: string): ScheduledTask | undefined {
    return this.#state.tasks.find((task) => task.id === id)
  }

  create(input: ScheduledTaskInput, source: ScheduledTaskSource): ScheduledTask {
    const now = this.#now()
    const value = this.#validated(input, now)
    const sequence = this.#state.sequence + 1
    const task: ScheduledTask = {
      id: `TASK-${String(sequence).padStart(4, "0")}`,
      ...value,
      createdBy: source,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      updatedBy: source,
      enabled: true,
      nextRunAt: nextScheduledRunAt(value.schedule, now),
    }
    this.#state = { version: 1, sequence, tasks: [...this.#state.tasks, task] }
    this.#save()
    return task
  }

  update(id: string, input: ScheduledTaskInput, source: ScheduledTaskSource): ScheduledTask {
    const now = this.#now()
    const value = this.#validated(input, now)
    const task = this.#task(id)
    const updated: ScheduledTask = {
      ...task,
      ...value,
      updatedAt: now.toISOString(),
      updatedBy: source,
      nextRunAt: task.enabled ? nextScheduledRunAt(value.schedule, now) : task.nextRunAt,
    }
    this.#replace(updated)
    this.#save()
    return updated
  }

  pause(id: string): ScheduledTask {
    const task = this.#task(id)
    const paused = { ...task, enabled: false, updatedAt: this.#now().toISOString() }
    this.#replace(paused)
    this.#save()
    return paused
  }

  resume(id: string): ScheduledTask {
    const now = this.#now()
    const task = this.#task(id)
    const nextRunAt = nextScheduledRunAt(task.schedule, now)
    if (nextRunAt === null) throw new Error("一次性任务时间已过，无法恢复")
    const resumed = { ...task, enabled: true, updatedAt: now.toISOString(), nextRunAt }
    this.#replace(resumed)
    this.#save()
    return resumed
  }

  remove(id: string): boolean {
    const task = this.#task(id)
    this.#state = {
      ...this.#state,
      tasks: this.#state.tasks.filter((item) => item.id !== task.id),
    }
    this.#save()
    return true
  }

  runNow(id: string): "queued" | "deduped" {
    return this.#enqueue(this.#task(id), this.#now())
  }

  tick(now: Date = this.#now()): void {
    for (const task of this.#state.tasks) {
      if (
        !task.enabled ||
        task.nextRunAt === null ||
        new Date(task.nextRunAt).getTime() > now.getTime()
      )
        continue
      const advanced = advanceScheduledTask(task, now)
      this.#replace(advanced)
      this.#save()
      this.#enqueue(advanced, now)
    }
  }

  summary(): ScheduledTaskSummary {
    const enabled = this.#state.tasks.filter((task) => task.enabled)
    const nextTask = enabled
      .filter((task) => task.nextRunAt !== null)
      .sort((left, right) => (left.nextRunAt ?? "").localeCompare(right.nextRunAt ?? ""))[0]
    const lastTask = this.#state.tasks
      .filter((task) => task.lastRun !== undefined)
      .sort((left, right) => (right.lastRun?.at ?? "").localeCompare(left.lastRun?.at ?? ""))[0]
    return {
      enabledCount: enabled.length,
      nextTask: nextTask ?? null,
      lastTask: lastTask ?? null,
      diagnostic: this.#diagnostic,
    }
  }

  #validated(input: ScheduledTaskInput, now: Date): ScheduledTaskInput {
    const validation = validateScheduledTaskInput(input, now)
    if (!validation.ok) throw new Error(validation.error)
    return validation.value
  }

  #task(id: string): ScheduledTask {
    const task = this.get(id)
    if (task === undefined) throw new Error(`未找到定时任务：${id}`)
    return task
  }

  #enqueue(task: ScheduledTask, now: Date): "queued" | "deduped" {
    const result = this.#sink.enqueue({
      kind: "custom",
      dedupeKey: `task:${task.id}`,
      title: task.name,
      prompt: `[定时任务·${task.name}] ${task.prompt}`,
      createdAt: now.toISOString(),
      taskId: task.id,
      taskName: task.name,
      source: task.updatedBy ?? task.createdBy,
    })
    const state = result === "queued" ? "queued" : "skipped"
    this.#replace({
      ...this.#task(task.id),
      lastRun: {
        at: now.toISOString(),
        state,
        ...(state === "skipped" ? { reason: "任务已在队列中" } : {}),
      },
    })
    this.#save()
    return result
  }

  #replace(updated: ScheduledTask): void {
    this.#state = {
      ...this.#state,
      tasks: this.#state.tasks.map((task) => (task.id === updated.id ? updated : task)),
    }
  }

  #save(): void {
    this.#store.save(this.#state)
    this.#diagnostic = null
  }
}
