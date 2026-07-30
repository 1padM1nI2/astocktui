import { CompositeNewsDataSource } from "./composite-news"
import { type CacheEnvelope, readCache, writeCache } from "./disk-cache"
import { fetchEastmoneyAnnouncements } from "./eastmoney-extra"
import { defaultAppDataPath } from "./json-file"
import {
  createDefaultMarketDataSource,
  type MarketDataSource,
  type MarketSnapshot,
} from "./market-data"
import { type FinancialNewsSnapshot, type NewsDataSource, NewsNowDataSource } from "./news-data"

/** 行情源磁盘兜底：成功写盘，失败回退到最近一次缓存（附 cachedAt），无缓存抛原错 */
export class CachedMarketDataSource implements MarketDataSource {
  readonly #inner: MarketDataSource
  readonly #path: string
  readonly #now: () => number

  constructor(inner: MarketDataSource, path: string, now: () => number = Date.now) {
    this.#inner = inner
    this.#path = path
    this.#now = now
  }

  async loadSnapshot(codes: readonly string[]): Promise<MarketSnapshot> {
    try {
      const snapshot = await this.#inner.loadSnapshot(codes)
      try {
        writeCache(this.#path, snapshot, this.#now)
      } catch {
        // 缓存写失败（如磁盘只读）不影响行情本身
      }
      return snapshot
    } catch (error) {
      const cached = readCachedMarketSnapshot(this.#path)
      if (cached === null) throw error
      return { ...cached.value, cachedAt: cached.cachedAt }
    }
  }
}

/** 新闻源磁盘兜底：语义同 CachedMarketDataSource */
export class CachedNewsDataSource implements NewsDataSource {
  readonly #inner: NewsDataSource
  readonly #path: string
  readonly #now: () => number

  constructor(inner: NewsDataSource, path: string, now: () => number = Date.now) {
    this.#inner = inner
    this.#path = path
    this.#now = now
  }

  async loadNews(): Promise<FinancialNewsSnapshot> {
    try {
      const snapshot = await this.#inner.loadNews()
      try {
        writeCache(this.#path, snapshot, this.#now)
      } catch {
        // 缓存写失败不影响新闻本身
      }
      return snapshot
    } catch (error) {
      const cached = readCachedNewsSnapshot(this.#path)
      if (cached === null) throw error
      return { ...cached.value, cachedAt: cached.cachedAt }
    }
  }
}

export function readCachedMarketSnapshot(path: string): CacheEnvelope<MarketSnapshot> | null {
  return readCache<MarketSnapshot>(path)
}

export function readCachedNewsSnapshot(path: string): CacheEnvelope<FinancialNewsSnapshot> | null {
  return readCache<FinancialNewsSnapshot>(path)
}

export function createCachedMarketDataSource(): MarketDataSource {
  return new CachedMarketDataSource(
    createDefaultMarketDataSource(),
    defaultAppDataPath("cache/market.json"),
  )
}

export function createCachedNewsDataSource(): NewsDataSource {
  return new CachedNewsDataSource(
    new CompositeNewsDataSource(new NewsNowDataSource(), fetchEastmoneyAnnouncements),
    defaultAppDataPath("cache/news.json"),
  )
}

interface MarketSnapshotSink {
  applySnapshot(snapshot: MarketSnapshot): void
}

interface NewsSnapshotSink {
  applySnapshot(snapshot: FinancialNewsSnapshot): void
}

/** 冷启动预渲染：磁盘缓存命中则直接套用快照，不触发网络 */
export function applyStartupCaches(
  market: MarketSnapshotSink,
  news: NewsSnapshotSink,
  marketPath: string = defaultAppDataPath("cache/market.json"),
  newsPath: string = defaultAppDataPath("cache/news.json"),
): void {
  const cachedMarket = readCachedMarketSnapshot(marketPath)
  if (cachedMarket !== null)
    market.applySnapshot({ ...cachedMarket.value, cachedAt: cachedMarket.cachedAt })
  const cachedNews = readCachedNewsSnapshot(newsPath)
  if (cachedNews !== null)
    news.applySnapshot({ ...cachedNews.value, cachedAt: cachedNews.cachedAt })
}
