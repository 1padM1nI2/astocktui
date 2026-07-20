import { defaultAppDataPath, readJsonFile, writeJsonFileAtomically } from "./json-file"
import { isMemoryState, type MemoryState } from "./memory"

export function defaultMemoryPath(): string {
  return defaultAppDataPath("memory.json")
}

export class MemoryStore {
  readonly path: string

  constructor(path: string = defaultMemoryPath()) {
    this.path = path
  }

  load(): MemoryState | null {
    try {
      const value = readJsonFile(this.path)
      if (value === null) return null
      if (!isMemoryState(value)) throw new Error("状态结构无效")
      return value
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`记忆文件损坏：${this.path}（${reason}）`)
    }
  }

  save(state: MemoryState): void {
    writeJsonFileAtomically(this.path, state)
  }
}
