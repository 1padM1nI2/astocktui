import { defaultAppDataPath, readJsonFile, writeJsonFileAtomically } from "../infra/json-file"
import type { ScheduledTask, ScheduledTaskSchedule } from "./scheduled-tasks"

export interface ScheduledTaskState {
  readonly version: 1
  readonly sequence: number
  readonly tasks: readonly ScheduledTask[]
}

export interface ScheduledTaskStoreLoadResult {
  readonly state: ScheduledTaskState
  readonly diagnostic: string | null
}

const EMPTY_STATE: ScheduledTaskState = { version: 1, sequence: 0, tasks: [] }

export function defaultScheduledTaskPath(): string {
  return defaultAppDataPath("scheduled-tasks.json")
}

export class ScheduledTaskStore {
  readonly path: string

  constructor(path: string = defaultScheduledTaskPath()) {
    this.path = path
  }

  load(): ScheduledTaskStoreLoadResult {
    try {
      const value = readJsonFile(this.path)
      if (value === null) return { state: EMPTY_STATE, diagnostic: null }
      if (!isState(value)) throw new Error("状态结构无效")
      return { state: value, diagnostic: null }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return { state: EMPTY_STATE, diagnostic: `定时任务文件损坏：${reason}` }
    }
  }

  save(state: ScheduledTaskState): void {
    writeJsonFileAtomically(this.path, state)
  }
}

function isState(value: unknown): value is ScheduledTaskState {
  if (!isRecord(value) || value["version"] !== 1 || !isNonNegativeInteger(value["sequence"]))
    return false
  return Array.isArray(value["tasks"]) && value["tasks"].every(isTask)
}

function isTask(value: unknown): value is ScheduledTask {
  if (!isRecord(value)) return false
  return (
    isNonEmptyString(value["id"]) &&
    isNonEmptyString(value["name"]) &&
    isNonEmptyString(value["prompt"]) &&
    isSchedule(value["schedule"]) &&
    (value["mode"] === undefined || value["mode"] === "agent" || value["mode"] === "research") &&
    (value["createdBy"] === "user" || value["createdBy"] === "agent") &&
    isIsoDate(value["createdAt"]) &&
    isIsoDate(value["updatedAt"]) &&
    typeof value["enabled"] === "boolean" &&
    (value["nextRunAt"] === null || isIsoDate(value["nextRunAt"])) &&
    (value["lastRun"] === undefined || isLastRun(value["lastRun"]))
  )
}

function isSchedule(value: unknown): value is ScheduledTaskSchedule {
  if (!isRecord(value) || typeof value["kind"] !== "string") return false
  if (value["kind"] === "once") return isNonEmptyString(value["at"])
  if (value["kind"] === "daily")
    return isNonEmptyString(value["time"]) && typeof value["weekdaysOnly"] === "boolean"
  return value["kind"] === "interval" && isPositiveInteger(value["minutes"])
}

function isLastRun(value: unknown): boolean {
  return (
    isRecord(value) &&
    isIsoDate(value["at"]) &&
    (value["state"] === "queued" ||
      value["state"] === "skipped" ||
      value["state"] === "completed" ||
      value["state"] === "failed") &&
    (value["reason"] === undefined || typeof value["reason"] === "string")
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime())
}
