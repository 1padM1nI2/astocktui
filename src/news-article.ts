import type { FinancialNewsItem } from "./news-data"

const REQUEST_TIMEOUT_MS = 10_000
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
const GENERIC_MIN_CJK_CHARS = 12

export interface ArticleHttpResponse {
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
  text(): Promise<string>
}

export type ArticleFetcher = (url: string, init?: RequestInit) => Promise<ArticleHttpResponse>
export type ArticleLoader = (item: FinancialNewsItem) => Promise<readonly string[] | null>

const DEFAULT_FETCHER: ArticleFetcher = (url, init) => fetch(url, init)

const WALLSTREETCN_ARTICLE = /^https?:\/\/(?:www\.)?wallstreetcn\.com\/articles\/(\d+)/u
const CLS_ARTICLE = /^https?:\/\/(?:www\.)?cls\.cn\/detail\/\d+/u
const NEXT_DATA_SCRIPT = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/u
// biome-ignore lint/suspicious/noControlCharactersInRegex: 剥离正文 HTML 中的 ANSI 转义序列
const ANSI_SEQUENCE = /\x1b\[[0-9;?]*[a-zA-Z]/g
// biome-ignore lint/suspicious/noControlCharactersInRegex: 剔除正文中的不可见控制字符
const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/giu, " ")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/giu, "&")
}

export function htmlToParagraphs(html: string): string[] {
  const withoutBlocks = html
    .replace(/<script[\s\S]*?<\/script>/giu, " ")
    .replace(/<style[\s\S]*?<\/style>/giu, " ")
    .replace(/<!--[\s\S]*?-->/gu, " ")
  const withBreaks = withoutBlocks.replace(
    /<(?:br|\/(?:p|div|h[1-6]|li|tr|article|section|header|footer|nav|aside|main|ul|ol|dl|dd|dt|table|blockquote|pre|figure|figcaption|form))[^>]*>/giu,
    "\n",
  )
  const text = withBreaks.replace(/<[^>]+>/gu, "")
  const decoded = decodeEntities(text).replace(ANSI_SEQUENCE, "").replace(CONTROL_CHARS, "")

  const paragraphs: string[] = []
  for (const line of decoded.split("\n")) {
    const collapsed = line.replace(/\s+/gu, " ").trim()
    if (collapsed.length > 0) paragraphs.push(collapsed)
  }
  return paragraphs
}

function countCjkChars(text: string): number {
  let count = 0
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0
    if (codePoint >= 0x4e00 && codePoint <= 0x9fff) count++
  }
  return count
}

function requestInit(): RequestInit {
  return {
    headers: { Accept: "text/html,application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }
}

async function loadWallstreetcn(
  articleId: string,
  fetcher: ArticleFetcher,
): Promise<readonly string[] | null> {
  const response = await fetcher(
    `https://api-one.wallstcn.com/apiv1/content/articles/${articleId}?extract=0`,
    requestInit(),
  )
  if (!response.ok) return null
  const payload = await response.json()
  const data = isRecord(payload) ? payload["data"] : undefined
  const content = isRecord(data) ? data["content"] : undefined
  if (typeof content !== "string") return null
  const paragraphs = htmlToParagraphs(content)
  return paragraphs.length > 0 ? paragraphs : null
}

async function loadCls(url: string, fetcher: ArticleFetcher): Promise<readonly string[] | null> {
  const response = await fetcher(url, requestInit())
  if (!response.ok) return null
  const match = NEXT_DATA_SCRIPT.exec(await response.text())
  const payloadText = match?.[1]
  if (payloadText === undefined) return null
  try {
    const payload: unknown = JSON.parse(payloadText)
    const props = isRecord(payload) ? payload["props"] : undefined
    const pageProps = isRecord(props) ? props["pageProps"] : undefined
    const detail = isRecord(pageProps) ? pageProps["articleDetail"] : undefined
    if (!isRecord(detail)) return null
    const content = detail["content"]
    const brief = detail["brief"]
    const html =
      typeof content === "string" && content.length > 0
        ? content
        : typeof brief === "string"
          ? brief
          : undefined
    if (html === undefined) return null
    const paragraphs = htmlToParagraphs(html)
    return paragraphs.length > 0 ? paragraphs : null
  } catch {
    return null
  }
}

async function loadGeneric(
  url: string,
  fetcher: ArticleFetcher,
): Promise<readonly string[] | null> {
  const response = await fetcher(url, requestInit())
  if (!response.ok) return null
  const meaningful = htmlToParagraphs(await response.text()).filter(
    (paragraph) => countCjkChars(paragraph) >= GENERIC_MIN_CJK_CHARS,
  )
  return meaningful.length > 0 ? meaningful : null
}

export async function loadArticleText(
  item: FinancialNewsItem,
  fetcher: ArticleFetcher = DEFAULT_FETCHER,
): Promise<readonly string[] | null> {
  const url = item.url
  if (url === undefined) return null
  try {
    const wallstreetcn = WALLSTREETCN_ARTICLE.exec(url)
    const articleId = wallstreetcn?.[1]
    const paragraphs =
      articleId !== undefined
        ? await loadWallstreetcn(articleId, fetcher)
        : CLS_ARTICLE.test(url)
          ? await loadCls(url, fetcher)
          : await loadGeneric(url, fetcher)
    if (paragraphs === null) return null
    const cleaned = cleanParagraphs(paragraphs, item.title)
    return cleaned.length > 0 ? cleaned : null
  } catch {
    return null
  }
}

const NOISE_PARAGRAPH = /^(风险提示|免责声明)|市场有风险，投资需谨慎|本文不构成/u

function normalizeSentence(text: string): string {
  return text.replace(/[\s。！？!?．.]+/gu, "")
}

// 去掉与标题重复的首段以及各来源文末附带的免责模板
function cleanParagraphs(paragraphs: readonly string[], title: string): string[] {
  const cleaned = paragraphs.filter((paragraph) => !NOISE_PARAGRAPH.test(paragraph))
  const first = cleaned[0]
  if (first !== undefined && normalizeSentence(first) === normalizeSentence(title)) {
    return cleaned.slice(1)
  }
  return cleaned
}
