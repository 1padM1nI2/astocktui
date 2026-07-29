import { matchesKey } from "@oh-my-pi/pi-tui"
import { agentPanelHeight } from "./layout-tiers"

export class AgentScrollState {
  #offset = 0
  #lastRenderWidth = 0
  readonly #viewportRows: (() => number) | undefined

  constructor(viewportRows?: () => number) {
    this.#viewportRows = viewportRows
  }

  get offset(): number {
    return this.#offset
  }

  get viewportRows(): number {
    return Math.max(1, this.#viewportRows?.() ?? 24)
  }

  reset(): void {
    this.#offset = 0
  }

  recordRender(width: number): void {
    this.#lastRenderWidth = Math.max(0, width | 0)
  }

  handleInput(data: string): boolean {
    const pageSize = this.#pageSize(this.viewportRows)
    if (matchesKey(data, "up")) this.#offset = Math.min(Number.MAX_SAFE_INTEGER, this.#offset + 1)
    else if (matchesKey(data, "down")) this.#offset = Math.max(0, this.#offset - 1)
    else if (matchesKey(data, "pageUp")) {
      this.#offset = Math.min(Number.MAX_SAFE_INTEGER, this.#offset + pageSize)
    } else if (matchesKey(data, "pageDown")) this.#offset = Math.max(0, this.#offset - pageSize)
    else if (matchesKey(data, "home")) this.#offset = Number.MAX_SAFE_INTEGER
    else if (matchesKey(data, "end")) this.#offset = 0
    else return false
    return true
  }

  #pageSize(viewportRows: number): number {
    const safeRows = Math.max(1, viewportRows | 0)
    const agentHeight = agentPanelHeight(this.#lastRenderWidth, safeRows)
    return Math.max(1, agentHeight - 5)
  }
}
