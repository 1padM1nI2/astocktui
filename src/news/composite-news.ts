import type { AnnouncementsFetcher } from "../market/eastmoney-extra"
import {
  type FinancialNewsItem,
  type FinancialNewsSnapshot,
  NEWS_LIMIT,
  type NewsDataSource,
} from "./data"

/**
 * 快讯 + 东财公告复合新闻源：内层成功是底线（内层抛则整体抛），
 * 公告抓取失败静默降级为仅内层；合并后按时间降序、按标题去重、截 NEWS_LIMIT 条。
 */
export class CompositeNewsDataSource implements NewsDataSource {
  readonly #inner: NewsDataSource
  readonly #announcements: AnnouncementsFetcher

  constructor(inner: NewsDataSource, announcements: AnnouncementsFetcher) {
    this.#inner = inner
    this.#announcements = announcements
  }

  async loadNews(): Promise<FinancialNewsSnapshot> {
    const snapshot = await this.#inner.loadNews()
    const announcements = await this.#announcements().catch((): readonly FinancialNewsItem[] => [])
    if (announcements.length === 0) return snapshot
    const merged = [...snapshot.items, ...announcements].sort(
      (left, right) => right.publishedAt - left.publishedAt,
    )
    const titles = new Set<string>()
    const items: FinancialNewsItem[] = []
    for (const entry of merged) {
      if (titles.has(entry.title)) continue
      titles.add(entry.title)
      items.push(entry)
      if (items.length >= NEWS_LIMIT) break
    }
    return { items, source: `${snapshot.source}+东财公告` }
  }
}
