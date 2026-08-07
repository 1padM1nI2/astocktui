import type { AgentController } from "./controller"
import type { ScheduledTaskMode } from "./scheduled-tasks"

export type AgentTaskKind = "condition" | "dream" | "custom" | "research"

export interface AgentSystemEvent {
  readonly kind: AgentTaskKind
  readonly dedupeKey: string
  readonly title: string
  readonly prompt: string
  readonly createdAt: string
  readonly taskId?: string
  readonly taskName?: string
  readonly mode?: ScheduledTaskMode
  readonly source?: "user" | "agent"
}

export interface AgentEventSink {
  enqueue(event: AgentSystemEvent): "queued" | "deduped"
}

export class AgentEventDispatcher {
  readonly #agent: AgentController
  readonly #queue: AgentSystemEvent[] = []
  readonly #keys = new Set<string>()
  #running: Promise<void> | null = null
  #disposed = false

  constructor(agent: AgentController) {
    this.#agent = agent
  }

  enqueue(event: AgentSystemEvent): "queued" | "deduped" {
    if (this.#disposed || this.#keys.has(event.dedupeKey)) return "deduped"
    this.#keys.add(event.dedupeKey)
    this.#queue.push(event)
    void this.#drain()
    return "queued"
  }

  whenIdle(): Promise<void> {
    return this.#running ?? Promise.resolve()
  }
  cancelPending(): number {
    const count = this.#queue.length
    for (const event of this.#queue) this.#keys.delete(event.dedupeKey)
    this.#queue.length = 0
    return count
  }

  async dispose(): Promise<void> {
    this.#disposed = true
    this.cancelPending()
    this.#agent.abort()
    await this.whenIdle()
  }

  async #drain(): Promise<void> {
    if (this.#running !== null) return this.#running
    this.#running = (async () => {
      while (!this.#disposed) {
        const event = this.#queue.shift()
        if (event === undefined) break
        try {
          if (this.#agent.busy) await this.#agent.waitForIdle()
          if (!this.#disposed) await this.#agent.prompt(event.prompt)
        } finally {
          this.#keys.delete(event.dedupeKey)
        }
      }
    })().finally(() => {
      this.#running = null
    })
    return this.#running
  }
}
