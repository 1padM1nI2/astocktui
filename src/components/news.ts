import type { Component } from "@oh-my-pi/pi-tui"
import { ANSI, highlightReverse } from "../colors"
import { MarketSelectionController } from "../market-selection"
import { type ArticleLoader, loadArticleText } from "../news-article"
import type { FinancialNewsItem, FinancialNewsSnapshot } from "../news-data"
import { shanghaiDateTime } from "../trading-calendar"
import { fitLine, wrapText } from "../width"
import type { ListScrollState } from "../workspace-scroll"

interface DisplayHeadline {
  readonly time: string
  readonly source: string
  readonly title: string
}

type ArticleState = "loading" | readonly string[] | null

const TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Shanghai",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

function fullDateTime(publishedAt: number): string {
  const dt = shanghaiDateTime(new Date(publishedAt))
  const hh = String(Math.floor(dt.minutes / 60)).padStart(2, "0")
  const mm = String(dt.minutes % 60).padStart(2, "0")
  return `${dt.date} ${hh}:${mm}`
}

export class NewsWorkspace implements Component {
  #headlines: readonly DisplayHeadline[] = []
  #snapshot: FinancialNewsSnapshot | null = null
  #source = "NewsNow"
  #status: "idle" | "loading" | "ready" | "error" = "idle"
  readonly #selection = new MarketSelectionController()
  readonly #articleLoader: ArticleLoader
  readonly #articles = new Map<string, ArticleState>()

  constructor(articleLoader: ArticleLoader = loadArticleText) {
    this.#articleLoader = articleLoader
  }

  get scroll(): ListScrollState {
    return this.#selection.scroll
  }

  get isInDetailMode(): boolean {
    return this.#selection.isInDetailMode
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
    this.#selection.recordItemCount(snapshot.items.length)
    this.#selection.markReady()
    this.#source = snapshot.source
    this.#status = "ready"
  }

  failRefresh(): void {
    this.#status = "error"
  }

  handleInput(data: string): boolean {
    const wasInDetail = this.#selection.isInDetailMode
    const previousIndex = this.#selection.selectedIndex
    const handled = this.#selection.handleInput(data)
    // 进入详情或切换新闻时回到正文顶部
    if (
      this.#selection.isInDetailMode &&
      (!wasInDetail || this.#selection.selectedIndex !== previousIndex)
    ) {
      this.#selection.scroll.ensureVisible(0)
    }
    return handled
  }

  /** 按需加载当前选中新闻的正文，结果缓存；已由 App 在输入后触发 */
  async loadSelectedArticle(): Promise<void> {
    if (!this.#selection.isInDetailMode) return
    const item = this.#selectedItem()
    if (item === undefined || this.#articles.has(item.id)) return
    this.#articles.set(item.id, "loading")
    try {
      this.#articles.set(item.id, await this.#articleLoader(item))
    } catch {
      this.#articles.set(item.id, null)
    }
  }

  #selectedItem(): FinancialNewsItem | undefined {
    return this.#snapshot?.items[this.#selection.selectedIndex]
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

    if (this.#selection.isInDetailMode) {
      const item = this.#selectedItem()
      if (item !== undefined) return this.#renderDetail(item, lines, safeWidth)
    }

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
      if (this.#selection.isInSelectionMode && index === this.#selection.selectedIndex) {
        line = highlightReverse(line)
      }
      lines.push(fitLine(line, safeWidth))
    }
    return lines
  }

  #renderDetail(item: FinancialNewsItem, lines: string[], width: number): readonly string[] {
    lines.push(
      fitLine(
        ` ${ANSI.brightBlack}${item.source} · ${fullDateTime(item.publishedAt)}${ANSI.reset}`,
        width,
      ),
    )
    for (const line of wrapText(item.title, width - 1)) {
      lines.push(fitLine(` ${ANSI.bold}${line}${ANSI.reset}`, width))
    }
    lines.push("")

    const article = this.#articles.get(item.id)
    if (article === undefined || article === "loading") {
      lines.push(fitLine(` ${ANSI.brightBlack}正在加载正文…${ANSI.reset}`, width))
    } else if (article === null) {
      lines.push(fitLine(` ${ANSI.brightBlack}暂无正文，可访问原文链接${ANSI.reset}`, width))
    } else {
      for (const paragraph of article) {
        for (const line of wrapText(paragraph, width - 1)) lines.push(fitLine(` ${line}`, width))
        lines.push("")
      }
    }

    if (item.url !== undefined) {
      if (article === null || article === undefined || article === "loading") lines.push("")
      lines.push(fitLine(` ${ANSI.brightBlack}原文: ${item.url}${ANSI.reset}`, width))
    }
    lines.push(
      "",
      fitLine(
        ` ${ANSI.brightBlack}[Esc 返回]  [↑↓ 上一条/下一条]  [PgUp/PgDn 翻页]${ANSI.reset}`,
        width,
      ),
    )
    return lines
  }
}
