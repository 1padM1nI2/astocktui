import { matchesKey } from "@oh-my-pi/pi-tui"
import { ListScrollState } from "./workspace-scroll"

const DETAIL_HEADER_ROWS = 4

export class MarketSelectionController {
  readonly scroll = new ListScrollState()
  #selectedIndex = -1
  #detailMode = false
  #itemCount = 0
  #allowSelection = false

  get selectedIndex(): number {
    return this.#selectedIndex
  }

  get isInDetailMode(): boolean {
    return this.#detailMode
  }

  get isInSelectionMode(): boolean {
    return this.#selectedIndex >= 0
  }

  recordItemCount(count: number): void {
    this.#itemCount = count
    if (count === 0) {
      this.#selectedIndex = -1
      this.#detailMode = false
    } else if (this.#selectedIndex >= count) {
      this.#selectedIndex = count - 1
    }
  }

  /** 标记行情已加载，允许空格进入选中模式 */
  markReady(): void {
    this.#allowSelection = true
  }

  handleInput(data: string): boolean {
    if (this.#detailMode) return this.#handleDetailInput(data)
    if (this.#selectedIndex >= 0) return this.#handleSelectionInput(data)
    return this.#handleScrollInput(data)
  }

  #handleDetailInput(data: string): boolean {
    if (data === "\x1b") {
      this.#detailMode = false
      return true
    }
    if (matchesKey(data, "up")) {
      this.#selectedIndex = Math.max(0, this.#selectedIndex - 1)
      return true
    }
    if (matchesKey(data, "down")) {
      this.#selectedIndex = Math.min(this.#itemCount - 1, this.#selectedIndex + 1)
      return true
    }
    if (
      matchesKey(data, "pageUp") ||
      matchesKey(data, "pageDown") ||
      matchesKey(data, "home") ||
      matchesKey(data, "end")
    ) {
      // 详情页内容可能超出可视区，翻页键滚动正文而不是切换条目
      return this.scroll.handleInput(data)
    }
    return true
  }

  #handleSelectionInput(data: string): boolean {
    if (data === " ") {
      this.#detailMode = true
      return true
    }
    if (data === "\x1b") {
      this.#selectedIndex = -1
      return true
    }
    if (matchesKey(data, "up")) {
      this.#selectedIndex = Math.max(0, this.#selectedIndex - 1)
      this.#ensureSelectedVisible()
      return true
    }
    if (matchesKey(data, "down")) {
      this.#selectedIndex = Math.min(this.#itemCount - 1, this.#selectedIndex + 1)
      this.#ensureSelectedVisible()
      return true
    }
    if (matchesKey(data, "pageUp")) {
      this.#selectedIndex = Math.max(0, this.#selectedIndex - 5)
      this.#ensureSelectedVisible()
      return true
    }
    if (matchesKey(data, "pageDown")) {
      this.#selectedIndex = Math.min(this.#itemCount - 1, this.#selectedIndex + 5)
      this.#ensureSelectedVisible()
      return true
    }
    if (matchesKey(data, "home")) {
      this.#selectedIndex = 0
      this.#ensureSelectedVisible()
      return true
    }
    if (matchesKey(data, "end")) {
      this.#selectedIndex = this.#itemCount - 1
      this.#ensureSelectedVisible()
      return true
    }
    return this.scroll.handleInput(data)
  }

  #handleScrollInput(data: string): boolean {
    if (data === " ") {
      if (this.#itemCount > 0 && this.#allowSelection) {
        this.#selectedIndex = 0
        this.#ensureSelectedVisible()
      }
      return true
    }
    return this.scroll.handleInput(data)
  }

  #ensureSelectedVisible(): void {
    this.scroll.ensureVisible(this.#selectedIndex + DETAIL_HEADER_ROWS)
  }
}
