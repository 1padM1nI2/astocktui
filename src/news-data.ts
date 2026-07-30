export const NEWSNOW_FINANCE_SOURCE_IDS = [
  "mktnews-flash",
  "wallstreetcn-quick",
  "wallstreetcn-news",
  "cls-telegraph",
  "cls-depth",
  "xueqiu-hotstock",
  "gelonghui",
  "fastbull-express",
  "jin10",
] as const
export const NEWS_LIMIT = 40
const REQUEST_TIMEOUT_MS = 10_000
const DEFAULT_NEWSNOW_URL = "https://newsnow.busiyi.world"
const RAW_CONFIGURED_NEWSNOW_URL = Reflect.get(Bun.env, "ASTOCK_NEWSNOW_URL")
const CONFIGURED_NEWSNOW_URL =
  typeof RAW_CONFIGURED_NEWSNOW_URL === "string" ? RAW_CONFIGURED_NEWSNOW_URL : undefined

export type NewsNowSourceId = (typeof NEWSNOW_FINANCE_SOURCE_IDS)[number]

const SOURCE_NAME_BY_ID: Record<NewsNowSourceId, string> = {
  "mktnews-flash": "MKTNews",
  "wallstreetcn-quick": "华尔街见闻",
  "wallstreetcn-news": "华尔街见闻",
  "cls-telegraph": "财联社",
  "cls-depth": "财联社深度",
  "xueqiu-hotstock": "雪球热门股票",
  gelonghui: "格隆汇",
  "fastbull-express": "法布财经",
  jin10: "金十数据",
}

export interface FinancialNewsItem {
  readonly id: string
  readonly title: string
  readonly publishedAt: number
  readonly source: string
  readonly url?: string
}

export interface FinancialNewsSnapshot {
  readonly items: readonly FinancialNewsItem[]
  readonly source: string
  readonly cachedAt?: number
}

export interface NewsDataSource {
  loadNews(): Promise<FinancialNewsSnapshot>
}

export interface NewsHttpResponse {
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
}

export interface NewsRequestOptions {
  readonly headers: {
    readonly Accept: string
    readonly "User-Agent": string
  }
  readonly signal: AbortSignal
}

export type NewsFetcher = (url: string, options: NewsRequestOptions) => Promise<NewsHttpResponse>

const DEFAULT_FETCHER: NewsFetcher = (url, options) => fetch(url, options)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function hasUnsafeTerminalControl(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const codeUnit = text.charCodeAt(index)
    const isNormalWhitespace = codeUnit === 0x09 || codeUnit === 0x0a || codeUnit === 0x0d
    if ((codeUnit < 0x20 && !isNormalWhitespace) || (codeUnit >= 0x7f && codeUnit <= 0x9f)) {
      return true
    }
  }
  return false
}

function parseNewsNowItems(payload: unknown, sourceId: NewsNowSourceId): readonly unknown[] | null {
  if (!isRecord(payload)) return null
  const responseId = Reflect.get(payload, "id")
  const items = Reflect.get(payload, "items")
  if (responseId !== sourceId || !Array.isArray(items)) return null
  return items
}

function parseFinancialNewsItem(
  rawItem: unknown,
  sourceId: NewsNowSourceId,
): FinancialNewsItem | null {
  if (!isRecord(rawItem)) return null
  const rawId = Reflect.get(rawItem, "id")
  const rawTitle = Reflect.get(rawItem, "title")
  if (
    (typeof rawId !== "string" && typeof rawId !== "number") ||
    typeof rawTitle !== "string" ||
    hasUnsafeTerminalControl(rawTitle)
  ) {
    return null
  }

  const rawExtra = Reflect.get(rawItem, "extra")
  const rawPublishedAt =
    Reflect.get(rawItem, "pubDate") ??
    (isRecord(rawExtra) ? Reflect.get(rawExtra, "date") : undefined)
  const publishedAt =
    typeof rawPublishedAt === "number"
      ? rawPublishedAt
      : typeof rawPublishedAt === "string"
        ? Number(rawPublishedAt)
        : Number.NaN
  const title = rawTitle.replace(/\s+/gu, " ").trim()
  const rawUrl =
    Reflect.get(rawItem, "url") ??
    Reflect.get(rawItem, "mobileUrl") ??
    (isRecord(rawExtra) ? Reflect.get(rawExtra, "url") : undefined)
  const url = typeof rawUrl === "string" && /^https?:\/\//u.test(rawUrl) ? rawUrl : undefined
  if (title.length === 0 || !Number.isFinite(publishedAt) || publishedAt < 1_000_000_000_000) {
    return null
  }

  return {
    id: `${sourceId}:${rawId}`,
    title,
    publishedAt,
    source: SOURCE_NAME_BY_ID[sourceId],
    ...(url === undefined ? {} : { url }),
  }
}

export class NewsNowDataSource implements NewsDataSource {
  readonly #fetcher: NewsFetcher
  readonly #baseUrl: string
  readonly #sourceIds: readonly NewsNowSourceId[]

  constructor(
    fetcher: NewsFetcher = DEFAULT_FETCHER,
    baseUrl: string = CONFIGURED_NEWSNOW_URL ?? DEFAULT_NEWSNOW_URL,
    sourceIds: readonly NewsNowSourceId[] = NEWSNOW_FINANCE_SOURCE_IDS,
  ) {
    this.#fetcher = fetcher
    this.#baseUrl = baseUrl
    this.#sourceIds = sourceIds
  }

  async loadNews(): Promise<FinancialNewsSnapshot> {
    const results = await Promise.allSettled(
      this.#sourceIds.map((sourceId) => this.#loadSource(sourceId)),
    )
    const merged: FinancialNewsItem[] = []
    let sourceCount = 0

    for (const result of results) {
      if (result.status !== "fulfilled" || result.value.length === 0) continue
      sourceCount++
      merged.push(...result.value)
    }
    if (merged.length === 0) throw new Error("没有可用财经新闻")

    merged.sort((left, right) => right.publishedAt - left.publishedAt)
    const titles = new Set<string>()
    const items: FinancialNewsItem[] = []
    for (const item of merged) {
      if (titles.has(item.title)) continue
      titles.add(item.title)
      items.push(item)
      if (items.length === NEWS_LIMIT) break
    }

    if (items.length === 0) throw new Error("没有可用财经新闻")
    return { items, source: `NewsNow ${sourceCount}源` }
  }

  async #loadSource(sourceId: NewsNowSourceId): Promise<FinancialNewsItem[]> {
    const endpoint = new URL("/api/s", this.#baseUrl)
    endpoint.searchParams.set("id", sourceId)
    const response = await this.#fetcher(endpoint.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`NewsNow 请求失败: ${response.status}`)

    const rawItems = parseNewsNowItems(await response.json(), sourceId)
    if (rawItems === null) throw new Error("NewsNow 返回格式无效")

    const items: FinancialNewsItem[] = []
    for (const rawItem of rawItems) {
      const item = parseFinancialNewsItem(rawItem, sourceId)
      if (item !== null) items.push(item)
    }
    return items
  }
}
