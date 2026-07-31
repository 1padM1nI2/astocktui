export type AgentSessionStatus =
  | "unconfigured"
  | "idle"
  | "streaming"
  | "tool-running"
  | "completed"
  | "error"

export interface AgentToolView {
  readonly id: string
  readonly name: string
  readonly label: string
  readonly status: "running" | "completed" | "error"
  readonly summary?: string
}

export interface AgentExchangeView {
  readonly user: string
  readonly answer: string
  readonly tools: readonly AgentToolView[]
}

export interface AgentSessionView {
  readonly status: AgentSessionStatus
  readonly modelLabel: string
  readonly userInput: string
  readonly answer: string
  readonly tools: readonly AgentToolView[]
  readonly error: string | null
  readonly history: readonly AgentExchangeView[]
}

export type AgentDriverEvent =
  | { readonly type: "text_delta"; readonly delta: string }
  | {
      readonly type: "tool_start"
      readonly id: string
      readonly name: string
      readonly label: string
    }
  | {
      readonly type: "tool_end"
      readonly id: string
      readonly name: string
      readonly label: string
      readonly summary: string
      readonly isError: boolean
    }

export interface AgentDriver {
  run(input: string, emit: (event: AgentDriverEvent) => void): Promise<void>
  clear(): void
  abort(): void
}

interface MutableToolView {
  id: string
  name: string
  label: string
  status: "running" | "completed" | "error"
  summary?: string
}

export interface AgentModelSwitcher {
  current(): string
  list(): readonly string[]
  select(target: string): string
}

export interface AgentThinkingControl {
  current(): string
  list(): readonly string[]
  select(target: string): string
}

export class AgentController {
  readonly #driver: AgentDriver
  readonly #modelLabel: string | (() => string)
  readonly modelSwitcher: AgentModelSwitcher | undefined
  readonly thinkingControl: AgentThinkingControl | undefined
  readonly #configurationError: string | null
  readonly #listeners = new Set<() => void>()
  readonly #tools: MutableToolView[] = []
  readonly #history: AgentExchangeView[]
  #status: AgentSessionStatus
  #userInput = ""
  #answer = ""
  #error: string | null
  #pending: Promise<void> | null = null

  constructor(
    driver: AgentDriver,
    modelLabel: string | (() => string),
    configurationError?: string,
    history: readonly AgentExchangeView[] = [],
    modelSwitcher?: AgentModelSwitcher,
    thinkingControl?: AgentThinkingControl,
  ) {
    this.#driver = driver
    this.#modelLabel = modelLabel
    this.modelSwitcher = modelSwitcher
    this.thinkingControl = thinkingControl
    this.#configurationError = configurationError ?? null
    this.#status = configurationError === undefined ? "idle" : "unconfigured"
    this.#error = this.#configurationError
    this.#history = history.map((exchange) => ({
      ...exchange,
      tools: exchange.tools.map((tool) => ({ ...tool })),
    }))
  }

  get busy(): boolean {
    return this.#pending !== null
  }

  get view(): AgentSessionView {
    return {
      status: this.#status,
      modelLabel: typeof this.#modelLabel === "function" ? this.#modelLabel() : this.#modelLabel,
      userInput: this.#userInput,
      answer: this.#answer,
      tools: this.#tools.map((tool) => ({ ...tool })),
      error: this.#error,
      history: this.#history.map((exchange) => ({
        ...exchange,
        tools: exchange.tools.map((tool) => ({ ...tool })),
      })),
    }
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  prompt(input: string): Promise<void> {
    if (this.#configurationError !== null) {
      this.#status = "unconfigured"
      this.#error = this.#configurationError
      this.#notify()
      return Promise.resolve()
    }
    if (this.#pending !== null) {
      this.#error = "Agent 正在处理上一条请求"
      this.#notify()
      return this.#pending
    }

    this.#status = "streaming"
    this.#archiveExchange()
    this.#userInput = input
    this.#answer = ""
    this.#error = null
    this.#tools.length = 0
    this.#notify()
    const pending = this.#driver
      .run(input, (event) => this.#handleEvent(event))
      .then(
        () => {
          this.#status = "completed"
          this.#notify()
        },
        (error: unknown) => {
          this.#status = "error"
          this.#error = error instanceof Error ? error.message : String(error)
          this.#notify()
        },
      )
      .finally(() => {
        this.#pending = null
      })
    this.#pending = pending
    return pending
  }

  waitForIdle(): Promise<void> {
    return this.#pending ?? Promise.resolve()
  }

  clear(): void {
    this.#driver.clear()
    this.#userInput = ""
    this.#answer = ""
    this.#tools.length = 0
    this.#history.length = 0
    this.#status = this.#configurationError === null ? "idle" : "unconfigured"
    this.#error = this.#configurationError
    this.#notify()
  }

  abort(): void {
    this.#driver.abort()
  }

  #archiveExchange(): void {
    if (this.#userInput.length === 0) return
    this.#history.push({
      user: this.#userInput,
      answer: this.#answer,
      tools: this.#tools.map((tool) => ({ ...tool })),
    })
  }

  #handleEvent(event: AgentDriverEvent): void {
    if (event.type === "text_delta") {
      this.#answer += event.delta
      this.#status = "streaming"
    } else if (event.type === "tool_start") {
      this.#tools.push({
        id: event.id,
        name: event.name,
        label: event.label,
        status: "running",
      })
      this.#status = "tool-running"
    } else {
      const tool = this.#tools.find((candidate) => candidate.id === event.id)
      if (tool !== undefined) {
        tool.status = event.isError ? "error" : "completed"
        tool.summary = event.summary
      }
      this.#status = "streaming"
    }
    this.#notify()
  }

  #notify(): void {
    for (const listener of this.#listeners) listener()
  }
}
