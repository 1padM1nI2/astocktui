import type { Component } from "@oh-my-pi/pi-tui"
import { ANSI } from "../colors"
import type { FinancialNewsSnapshot } from "../news-data"
import { fitLine } from "../width"
import { ListScrollState } from "../workspace-scroll"

interface DisplayHeadline {
  readonly time: string
  readonly source: string
  readonly title: string
}

const TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Shanghai",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

export class NewsWorkspace implements Component {
  #headlines: readonly DisplayHeadline[] = []
  #snapshot: FinancialNewsSnapshot | null = null
  #selected = -1
  #source = "NewsNow"
  #status: "idle" | "loading" | "ready" | "error" = "idle"
  readonly #scroll = new ListScrollState()

  get scroll(): ListScrollState {
    return this.#scroll
  }

  get status(): "idle" | "loading" | "ready" | "error" {
    return this.#status
  }

  get source(): string | null {
    return this.#status === "ready" ? this.#source : null
  }

  get snapshot(): FinancialNewsSnapshot | null {
    return this.#snapshot
  }

  beginRefresh(): void {
    this.#status = "loading"
  }

  applySnapshot(snapshot: FinancialNewsSnapshot): void {
    this.#snapshot = snapshot
    this.#headlines = snapshot.items.map((item) => ({
      time: TIME_FORMATTER.format(item.publishedAt),
      source: item.source,
      title: item.title,
    }))
    this.#selected = Math.min(this.#selected, this.#headlines.length - 1)
    this.#scroll.ensureVisible(this.#selected)
    this.#source = snapshot.source
    this.#status = "ready"
  }

  failRefresh(): void {
    this.#status = "error"
  }

  handleInput(data: string): void {
    const max = this.#headlines.length - 1
    const page = Math.max(1, this.#scroll.viewportRows)
    if (data === "\x1b[B") {
      this.#selected = Math.min(this.#selected + 1, max)
    } else if (data === "\x1b[A") {
      this.#selected = Math.max(this.#selected - 1, -1)
    } else if (data === "\x1b[6~") {
      this.#selected = Math.min(this.#selected + page, max)
    } else if (data === "\x1b[5~") {
      this.#selected = Math.max(this.#selected - page, -1)
    } else {
      return
    }
    this.#scroll.ensureVisible(this.#selected)
  }

  render(width: number): readonly string[] {
    const safeWidth = Math.max(0, width | 0)
    let status = `${ANSI.brightBlack}[未加载 · R刷新]${ANSI.reset}`
    if (this.#status === "loading") status = `${ANSI.yellow}[更新中]${ANSI.reset}`
    else if (this.#status === "ready") {
      status = `${ANSI.brightBlack}[${this.#source} · R刷新]${ANSI.reset}`
    } else if (this.#status === "error") {
      status = `${ANSI.brightRed}[获取失败 · R重试]${ANSI.reset}`
    }

    const lines: string[] = [fitLine(`实时新闻 / 财经 ${status}`, safeWidth), "─".repeat(safeWidth)]
    if (this.#headlines.length === 0) {
      let message = "等待财经新闻…"
      if (this.#status === "loading") message = "正在获取财经新闻…"
      else if (this.#status === "error") message = "财经新闻获取失败，按 R 重试"
      lines.push(fitLine(`${ANSI.brightBlack}${message}${ANSI.reset}`, safeWidth))
      return lines
    }

    for (let index = 0; index < this.#headlines.length; index++) {
      const item = this.#headlines[index]
      if (item === undefined) continue
      const marker = `${ANSI.brightBlack}·${ANSI.reset}`
      let line = `${item.time}  ${marker} [${item.source}] ${item.title}`
      if (index === this.#selected) line = `${ANSI.cyan}${ANSI.reverse}${line}${ANSI.reset}`
      lines.push(fitLine(line, safeWidth))
    }
    return lines
  }
}
