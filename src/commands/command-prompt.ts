import { matchesKey } from "@oh-my-pi/pi-tui"
import {
  type AppCommand,
  type CommandExecution,
  type CommandResult,
  filterCommands,
  isBareCommand,
} from "./commands"

export interface CommandPromptView {
  readonly input: string
  readonly submitted: string | null
  readonly result: CommandResult | null
  readonly isPaletteOpen: boolean
  readonly suggestions: readonly AppCommand[]
  readonly selectedIndex: number
}

export class CommandPrompt {
  #input = ""
  #submitted: string | null = null
  #result: CommandResult | null = null
  #pending: Promise<void> | null = null
  #executionVersion = 0
  readonly #additionalCommands: () => readonly AppCommand[]

  constructor(additionalCommands: () => readonly AppCommand[] = () => []) {
    this.#additionalCommands = additionalCommands
  }
  get isPaletteOpen(): boolean {
    return this.#input.startsWith("/")
  }

  whenIdle(): Promise<void> {
    return this.#pending ?? Promise.resolve()
  }

  pasteText(text: string): boolean {
    const preserveNewlines = !(this.#input + text).startsWith("/")
    const normalized = (
      preserveNewlines
        ? text.replace(/\r\n?/g, "\n").replace(/\t/g, " ")
        : text.replace(/[\r\n\t]+/g, " ")
    ).normalize("NFC")
    if (normalized.length === 0) return false
    this.#input += normalized
    this.#result = null
    this.#selectedIndex = 0
    return true
  }

  #selectedIndex = 0
  openPalette(): void {
    this.#input = "/"
    this.#result = null
    this.#selectedIndex = 0
  }

  get view(): CommandPromptView {
    const isPaletteOpen = this.isPaletteOpen
    return {
      input: this.#input,
      submitted: this.#submitted,
      result: this.#result,
      isPaletteOpen,
      suggestions: isPaletteOpen ? filterCommands(this.#input, this.#additionalCommands()) : [],
      selectedIndex: this.#selectedIndex,
    }
  }

  handleInput(
    data: string,
    execute: (input: string) => CommandExecution,
    onUpdate: () => void = () => {},
    onSubmit: (input: string) => void = () => {},
  ): boolean {
    if (this.#input.startsWith("/")) return this.#handleCommandInput(data, execute, onUpdate)
    if (data === "\t") return false
    if (
      matchesKey(data, "shift+enter") ||
      matchesKey(data, "alt+enter") ||
      matchesKey(data, "ctrl+enter")
    ) {
      this.#result = null
      this.#input += "\n"
      this.#selectedIndex = 0
      return true
    }
    if (data === "\r" || data === "\n") {
      if (isBareCommand(this.#input)) {
        this.#startExecution(execute(this.#input), onUpdate)
        return true
      }
      this.#submitted = this.#input
      this.#input = ""
      this.#result = null
      if (this.#submitted.trim().length > 0) onSubmit(this.#submitted)
      return true
    }
    if (data === "\x7f" || data === "\b") {
      this.#input = this.#input.slice(0, -1)
      return true
    }
    if (data.length > 0 && data.charCodeAt(0) >= 0x20) {
      this.#result = null
      this.#input += data
      this.#selectedIndex = 0
      return true
    }
    return false
  }

  #handleCommandInput(
    data: string,
    execute: (input: string) => CommandExecution,
    onUpdate: () => void,
  ): boolean {
    const suggestions = filterCommands(this.#input, this.#additionalCommands())
    if (data === "\x1b") {
      this.#input = ""
      this.#selectedIndex = 0
      return true
    }
    if (data === "\x1b[B" || data === "\x1b[A") {
      if (suggestions.length > 0) {
        const direction = data === "\x1b[B" ? 1 : -1
        this.#selectedIndex =
          (this.#selectedIndex + direction + suggestions.length) % suggestions.length
      }
      return true
    }
    if (data === "\t") {
      this.#completeSelected(suggestions)
      return true
    }
    if (data === "\r" || data === "\n") {
      if (!this.#hasExactCommand(suggestions) && suggestions.length > 0) {
        this.#completeSelected(suggestions)
        return true
      }
      this.#startExecution(execute(this.#input), onUpdate)
      return true
    }
    if (data === "\x7f" || data === "\b") {
      this.#input = this.#input.slice(0, -1)
      this.#selectedIndex = 0
      return true
    }
    if (data.length > 0 && data.charCodeAt(0) >= 0x20) {
      this.#input += data
      this.#selectedIndex = 0
      return true
    }
    return false
  }

  #startExecution(execution: CommandExecution, onUpdate: () => void): void {
    const version = ++this.#executionVersion
    this.#input = ""
    this.#selectedIndex = 0
    if (!(execution instanceof Promise)) {
      this.#pending = null
      this.#applyResult(execution)
      return
    }
    this.#result = { kind: "output", title: "命令执行中", lines: ["正在获取行情并执行…"] }
    const pending = execution
      .then(
        (result) => {
          if (version !== this.#executionVersion) return
          this.#applyResult(result)
          onUpdate()
        },
        () => {
          if (version !== this.#executionVersion) return
          this.#result = { kind: "output", title: "命令执行失败", lines: ["异步命令执行失败"] }
          onUpdate()
        },
      )
      .finally(() => {
        if (version === this.#executionVersion) this.#pending = null
      })
    this.#pending = pending
  }

  #applyResult(result: CommandResult): void {
    if (result.kind === "clear") {
      this.#submitted = null
      this.#result = null
      return
    }
    this.#result = result
  }

  #completeSelected(suggestions: readonly AppCommand[]): void {
    const command = suggestions[this.#selectedIndex]
    if (command === undefined) return
    const whitespaceIndex = this.#input.search(/\s/)
    const argumentsSuffix = whitespaceIndex < 0 ? " " : this.#input.slice(whitespaceIndex)
    this.#input = `/${command.name}${argumentsSuffix}`
    this.#selectedIndex = 0
  }

  #hasExactCommand(suggestions: readonly AppCommand[]): boolean {
    const token = this.#input.trim().slice(1).split(/\s+/, 1)[0]?.toLowerCase() ?? ""
    return suggestions.some((command) => command.name === token || command.aliases.includes(token))
  }
}
