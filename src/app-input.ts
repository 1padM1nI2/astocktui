import type { AgentScrollState } from "./agent-scroll"
import { AGENT, MARKET, NEWS, TAB_COUNT } from "./app-render"
import type { CommandPrompt } from "./command-prompt"
import type { CommandExecution } from "./commands"

export interface AppInputOptions {
  readonly prompt: CommandPrompt
  readonly scroll: AgentScrollState
  readonly activeTab: () => number
  readonly setActiveTab: (tab: number) => unknown
  readonly executeCommand: (input: string) => CommandExecution
  readonly promptAgent: (input: string) => unknown
  readonly refreshMarket: () => unknown
  readonly refreshNews: () => unknown
  readonly handleNewsInput: (data: string) => unknown
  readonly onQuit: () => unknown
  readonly onUpdate: () => unknown
}

export class AppInputHandler {
  readonly #options: AppInputOptions

  constructor(options: AppInputOptions) {
    this.#options = options
  }

  handle(data: string): void {
    const options = this.#options
    if (data === "\x03") {
      options.onQuit()
      return
    }
    if (data === "/") {
      options.setActiveTab(AGENT)
      options.prompt.openPalette()
      return
    }
    if (options.activeTab() !== AGENT && (data === "q" || data === "\x1b")) {
      options.onQuit()
      return
    }
    const handlePrompt = (): boolean =>
      options.prompt.handleInput(
        data,
        options.executeCommand,
        options.onUpdate,
        options.promptAgent,
      )
    if (options.activeTab() === AGENT && options.prompt.isPaletteOpen) {
      handlePrompt()
      if (!options.prompt.isPaletteOpen) options.scroll.reset()
      return
    }
    if (options.activeTab() === AGENT && options.scroll.handleInput(data)) return
    if (options.activeTab() === MARKET && (data === "r" || data === "R")) {
      options.refreshMarket()
      return
    }
    if (options.activeTab() === NEWS && (data === "r" || data === "R")) {
      options.refreshNews()
      return
    }
    if (data === "\t" || data === "\x1b[C") {
      options.setActiveTab((options.activeTab() + 1) % TAB_COUNT)
      return
    }
    if (data === "\x1b[Z" || data === "\x1b[D") {
      options.setActiveTab((options.activeTab() - 1 + TAB_COUNT) % TAB_COUNT)
      return
    }
    if (options.activeTab() === NEWS) {
      options.handleNewsInput(data)
      return
    }
    if (options.activeTab() === AGENT && handlePrompt() && (data === "\r" || data === "\n"))
      options.scroll.reset()
  }
}
