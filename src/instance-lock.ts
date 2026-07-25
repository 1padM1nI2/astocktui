import { existsSync, readFileSync, rmSync } from "node:fs"
import { defaultAppDataPath, writeJsonFileAtomically } from "./json-file"

export interface InstanceLock {
  readonly path: string
  readonly pid: number
  release(): void
}

export type InstanceLockResult =
  | { readonly ok: true; readonly lock: InstanceLock }
  | { readonly ok: false; readonly pid: number }

export interface InstanceLockOptions {
  readonly path?: string
  readonly pid?: number
  readonly isAlive?: (pid: number) => boolean
  readonly now?: () => Date
}

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readHolderPid(path: string): number | null {
  try {
    if (!existsSync(path)) return null
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
    if (typeof parsed !== "object" || parsed === null) return null
    const pid = Reflect.get(parsed, "pid")
    return typeof pid === "number" && Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

export function defaultInstanceLockPath(): string {
  return defaultAppDataPath("app.lock")
}

export function acquireInstanceLock(options: InstanceLockOptions = {}): InstanceLockResult {
  const path = options.path ?? defaultInstanceLockPath()
  const pid = options.pid ?? process.pid
  const isAlive = options.isAlive ?? defaultIsAlive
  const now = options.now ?? (() => new Date())

  const holder = readHolderPid(path)
  if (holder !== null && holder !== pid && isAlive(holder)) return { ok: false, pid: holder }

  writeJsonFileAtomically(path, { pid, startedAt: now().toISOString() })
  return {
    ok: true,
    lock: {
      path,
      pid,
      release(): void {
        if (readHolderPid(path) === pid) rmSync(path, { force: true })
      },
    },
  }
}
