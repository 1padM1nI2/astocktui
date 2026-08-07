import { parseShanghaiTimeMinutes, shanghaiDateTime } from "../trading/trading-calendar"

export type ScheduledTaskSchedule =
  | { readonly kind: "once"; readonly at: string }
  | { readonly kind: "daily"; readonly time: string; readonly weekdaysOnly: boolean }
  | { readonly kind: "interval"; readonly minutes: number }

export type ScheduledTaskRunState = "queued" | "skipped" | "completed" | "failed"
export type ScheduledTaskSource = "user" | "agent"
/** 任务执行模式：agent 由主对话处理；research 交给只读调研子任务产出复盘报告 */
export type ScheduledTaskMode = "agent" | "research"

export interface ScheduledTaskInput {
  readonly name: string
  readonly prompt: string
  readonly schedule: ScheduledTaskSchedule
  readonly mode?: ScheduledTaskMode
}

export interface ScheduledTask {
  readonly id: string
  readonly name: string
  readonly prompt: string
  readonly schedule: ScheduledTaskSchedule
  readonly mode?: ScheduledTaskMode
  readonly createdBy: ScheduledTaskSource
  readonly createdAt: string
  readonly updatedAt: string
  readonly updatedBy?: ScheduledTaskSource
  readonly enabled: boolean
  readonly nextRunAt: string | null
  readonly lastRun?: {
    readonly at: string
    readonly state: ScheduledTaskRunState
    readonly reason?: string
  }
}

export type ScheduledTaskValidation =
  | { readonly ok: true; readonly value: ScheduledTaskInput }
  | { readonly ok: false; readonly error: string }

const MAX_NAME_LENGTH = 80
const MAX_PROMPT_LENGTH = 4_000
const MAX_INTERVAL_MINUTES = 1_440

export function validateScheduledTaskInput(
  input: ScheduledTaskInput,
  now: Date,
): ScheduledTaskValidation {
  const name = input.name.trim()
  if (name.length === 0 || name.length > MAX_NAME_LENGTH)
    return invalid("任务名称长度必须为 1 到 80 个字符")
  const prompt = input.prompt.trim()
  if (prompt.length === 0 || prompt.length > MAX_PROMPT_LENGTH)
    return invalid("任务提示长度必须为 1 到 4000 个字符")
  if (!isScheduleValid(input.schedule, now)) return invalid(scheduleError(input.schedule))
  if (input.mode !== undefined && input.mode !== "agent" && input.mode !== "research")
    return invalid("任务模式必须是 agent 或 research")
  const mode = input.mode ?? "agent"
  return { ok: true, value: { name, prompt, schedule: input.schedule, mode } }
}

export function nextScheduledRunAt(schedule: ScheduledTaskSchedule, now: Date): string | null {
  if (schedule.kind === "once") {
    const at = new Date(schedule.at)
    return Number.isFinite(at.getTime()) && at.getTime() > now.getTime() ? at.toISOString() : null
  }
  if (schedule.kind === "interval")
    return new Date(now.getTime() + schedule.minutes * 60_000).toISOString()

  const minutes = parseShanghaiTimeMinutes(schedule.time)
  if (minutes === null) return null
  const current = shanghaiDateTime(now)
  const delayMinutes =
    minutes > current.minutes ? minutes - current.minutes : 1_440 - current.minutes + minutes
  const next = new Date(now.getTime() + delayMinutes * 60_000)
  next.setUTCSeconds(0, 0)
  if (!schedule.weekdaysOnly) return next.toISOString()
  while (!isShanghaiWeekday(next)) next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString()
}

export function advanceScheduledTask(task: ScheduledTask, now: Date): ScheduledTask {
  const nextRunAt = task.schedule.kind === "once" ? null : nextScheduledRunAt(task.schedule, now)
  return { ...task, enabled: nextRunAt !== null, nextRunAt, updatedAt: now.toISOString() }
}

function isScheduleValid(schedule: ScheduledTaskSchedule, now: Date): boolean {
  if (schedule.kind === "once") {
    const at = new Date(schedule.at)
    return Number.isFinite(at.getTime()) && at.getTime() > now.getTime()
  }
  if (schedule.kind === "daily") return parseShanghaiTimeMinutes(schedule.time) !== null
  return (
    Number.isInteger(schedule.minutes) &&
    schedule.minutes >= 1 &&
    schedule.minutes <= MAX_INTERVAL_MINUTES
  )
}

function scheduleError(schedule: ScheduledTaskSchedule): string {
  if (schedule.kind === "once") return "一次性任务时间必须是未来的 ISO 时间"
  if (schedule.kind === "daily") return "每日任务时间必须是 HH:mm"
  return `间隔必须是 1 到 ${MAX_INTERVAL_MINUTES} 分钟的整数`
}

function isShanghaiWeekday(now: Date): boolean {
  const weekday = shanghaiDateTime(now).weekday
  return weekday >= 1 && weekday <= 5
}

function invalid(error: string): ScheduledTaskValidation {
  return { ok: false, error }
}
