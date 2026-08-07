import { matchesKey } from "@oh-my-pi/pi-tui"

export class ListScrollState {
  #offset = 0
  #contentRows = 0
  #viewportRows = 1

  get offset(): number {
    return this.#offset
  }

  get viewportRows(): number {
    return this.#viewportRows
  }

  recordRender(contentRows: number, viewportRows: number): void {
    this.#contentRows = Math.max(0, contentRows | 0)
    this.#viewportRows = Math.max(1, viewportRows | 0)
    this.#clamp()
  }

  ensureVisible(index: number): void {
    if (index < 0) return
    if (index < this.#offset) this.#offset = index
    else if (index >= this.#offset + this.#viewportRows) {
      this.#offset = index - this.#viewportRows + 1
    }
    this.#clamp()
  }

  handleInput(data: string): boolean {
    if (matchesKey(data, "up")) this.#offset -= 1
    else if (matchesKey(data, "down")) this.#offset += 1
    else if (matchesKey(data, "pageUp")) this.#offset -= this.#viewportRows
    else if (matchesKey(data, "pageDown")) this.#offset += this.#viewportRows
    else if (matchesKey(data, "home")) this.#offset = 0
    else if (matchesKey(data, "end")) this.#offset = this.#maxOffset()
    else return false
    this.#clamp()
    return true
  }

  #maxOffset(): number {
    return Math.max(0, this.#contentRows - this.#viewportRows)
  }

  #clamp(): void {
    this.#offset = Math.min(Math.max(0, this.#offset), this.#maxOffset())
  }
}
