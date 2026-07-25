import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs"
import { dirname } from "node:path"
import { defaultAppDataPath } from "./json-file"

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024
const MAX_FIELD_LENGTH = 1_000

export interface ToolCallStartInfo {
  readonly id: string
  readonly name: string
  readonly args?: unknown
}

export interface ToolCallEndInfo {
  readonly id: string
  readonly name: string
  readonly isError: boolean
  readonly result?: unknown
}

export interface ToolCallLoggerOptions {
  readonly maxBytes?: number
  readonly now?: () => Date
}

export function defaultToolCallLogPath(): string {
  return defaultAppDataPath("agent-tool-calls.log")
}

function clipField(value: unknown): unknown {
  if (value === undefined) return undefined
  try {
    if (typeof value === "string") {
      return value.length <= MAX_FIELD_LENGTH ? value : `${value.slice(0, MAX_FIELD_LENGTH)}…`
    }
    const text = JSON.stringify(value)
    if (text === undefined || text.length <= MAX_FIELD_LENGTH) return value
    return `${text.slice(0, MAX_FIELD_LENGTH)}…`
  } catch {
    return "[无法序列化]"
  }
}

export class ToolCallLogger {
  readonly path: string
  readonly #maxBytes: number
  readonly #now: () => Date
  readonly #startedAt = new Map<string, number>()
  #error: string | null = null
  #rotated = false

  constructor(path: string = defaultToolCallLogPath(), options: ToolCallLoggerOptions = {}) {
    this.path = path
    this.#maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    this.#now = options.now ?? (() => new Date())
  }

  get error(): string | null {
    return this.#error
  }

  recordStart(info: ToolCallStartInfo): void {
    const at = this.#now()
    this.#startedAt.set(info.id, at.getTime())
    this.#append({
      timestamp: at.toISOString(),
      phase: "start",
      id: info.id,
      name: info.name,
      args: clipField(info.args),
    })
  }

  recordEvent(kind: string, fields: Record<string, unknown>): void {
    this.#append({ timestamp: this.#now().toISOString(), phase: "event", kind, ...fields })
  }

  recordEnd(info: ToolCallEndInfo): void {
    const at = this.#now()
    const startedAt = this.#startedAt.get(info.id)
    this.#startedAt.delete(info.id)
    this.#append({
      timestamp: at.toISOString(),
      phase: "end",
      id: info.id,
      name: info.name,
      isError: info.isError,
      ...(startedAt === undefined ? {} : { durationMs: at.getTime() - startedAt }),
      result: clipField(info.result),
    })
  }

  #append(entry: Record<string, unknown>): void {
    try {
      this.#rotateOnce()
      mkdirSync(dirname(this.path), { recursive: true })
      appendFileSync(this.path, `${JSON.stringify(entry)}\n`, "utf8")
      this.#error = null
    } catch (error) {
      this.#error = error instanceof Error ? error.message : String(error)
    }
  }

  #rotateOnce(): void {
    if (this.#rotated) return
    this.#rotated = true
    if (!existsSync(this.path)) return
    if (statSync(this.path).size < this.#maxBytes) return
    renameSync(this.path, `${this.path}.1`)
  }
}
