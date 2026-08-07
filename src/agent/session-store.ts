import { defaultAppDataPath, readJsonFile, writeJsonFileAtomically } from "../infra/json-file"

export interface AgentSessionState {
  readonly version: 1
  readonly savedAt: string
  readonly messages: readonly unknown[]
  readonly thinkingLevel?: string
}

export interface AgentSessionLoadResult {
  readonly state: AgentSessionState
  readonly diagnostic: string | null
}

export interface AgentSessionStoreOptions {
  readonly maxMessages?: number
}

const EMPTY_STATE: AgentSessionState = { version: 1, savedAt: "", messages: [] }
const DEFAULT_MAX_MESSAGES = 200
const MESSAGE_ROLES = new Set(["user", "assistant", "toolResult"])

export function defaultAgentSessionPath(): string {
  return defaultAppDataPath("agent-session.json")
}

export class AgentSessionStore {
  readonly path: string
  readonly #maxMessages: number

  constructor(path: string = defaultAgentSessionPath(), options: AgentSessionStoreOptions = {}) {
    this.path = path
    this.#maxMessages = Math.max(1, options.maxMessages ?? DEFAULT_MAX_MESSAGES)
  }

  load(): AgentSessionLoadResult {
    try {
      const value = readJsonFile(this.path)
      if (value === null) return { state: EMPTY_STATE, diagnostic: null }
      if (!isState(value)) throw new Error("状态结构无效")
      return { state: value, diagnostic: null }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return { state: EMPTY_STATE, diagnostic: `Agent 会话文件损坏：${reason}` }
    }
  }

  save(messages: readonly unknown[], extras?: { readonly thinkingLevel?: string }): void {
    writeJsonFileAtomically(this.path, {
      version: 1,
      savedAt: new Date().toISOString(),
      messages: capMessages(messages, this.#maxMessages),
      ...(extras?.thinkingLevel === undefined ? {} : { thinkingLevel: extras.thinkingLevel }),
    })
  }
}

function capMessages(messages: readonly unknown[], maxMessages: number): unknown[] {
  const capped = messages.length <= maxMessages ? [...messages] : messages.slice(-maxMessages)
  while (capped.length > 0 && !isRole(capped[0], "user")) capped.shift()
  return capped
}

function isRole(value: unknown, role: string): boolean {
  return isRecord(value) && value["role"] === role
}

function isState(value: unknown): value is AgentSessionState {
  return (
    isRecord(value) &&
    value["version"] === 1 &&
    typeof value["savedAt"] === "string" &&
    Array.isArray(value["messages"]) &&
    value["messages"].every(isMessage)
  )
}

function isMessage(value: unknown): boolean {
  return isRecord(value) && typeof value["role"] === "string" && MESSAGE_ROLES.has(value["role"])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
