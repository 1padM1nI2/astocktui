import { defaultAppDataPath, readJsonFile, writeJsonFileAtomically } from "./json-file"

export function defaultAgentSchedulerPath(): string {
  return defaultAppDataPath("agent-scheduler.json")
}

export class AgentSchedulerStore {
  readonly path: string

  constructor(path: string = defaultAgentSchedulerPath()) {
    this.path = path
  }

  loadPreopenDate(): string | null {
    try {
      const value = readJsonFile(this.path)
      if (typeof value !== "object" || value === null) return null
      const date = Reflect.get(value, "preopenDate")
      return typeof date === "string" && date.length > 0 ? date : null
    } catch {
      return null
    }
  }

  savePreopenDate(date: string): void {
    writeJsonFileAtomically(this.path, { version: 1, preopenDate: date })
  }
}
