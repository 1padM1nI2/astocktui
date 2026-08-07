import { hasUnsafeTerminalControl } from "../news/news-data"
import { isAshareCode, normalizeMarketCode } from "./market-code"

const REQUEST_TIMEOUT_MS = 12_000
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
const SEARCH_URL = "https://searchapi.eastmoney.com/api/suggest/get"
const SEARCH_TOKEN = "D43BF722C8E33BDC906FB84D85E326E8"
const SEARCH_COUNT = 10

/** 名称搜索命中项：code 已规范化为应用内格式（如 SH600519），pinyin 缺失时为空串 */
export interface StockSearchMatch {
  readonly code: string
  readonly name: string
  readonly pinyin: string
}

export type StockSearcher = (query: string) => Promise<readonly StockSearchMatch[]>

export interface StockSearchHttpResult {
  readonly ok: boolean
  readonly status: number
  readonly body: string
}

export type StockSearchHttp = (url: string) => Promise<StockSearchHttpResult>

const defaultHttp: StockSearchHttp = async (url) => {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Referer: "https://quote.eastmoney.com/",
      "User-Agent": USER_AGENT,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  return { ok: response.ok, status: response.status, body: await response.text() }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/** 北交所代码段（应用仅支持沪深 A 股，须先于 normalizeMarketCode 排除 920 段误判为 SH） */
function isBseCode(code: string): boolean {
  return code.startsWith("4") || code.startsWith("8") || code.startsWith("920")
}

function parseEntry(value: unknown): StockSearchMatch | null {
  if (!isRecord(value)) return null
  const code = Reflect.get(value, "Code")
  const name = Reflect.get(value, "Name")
  const mktNum = Reflect.get(value, "MktNum")
  if (
    typeof code !== "string" ||
    !/^\d{6}$/u.test(code) ||
    typeof name !== "string" ||
    name.length === 0 ||
    hasUnsafeTerminalControl(name) ||
    Reflect.get(value, "Classify") !== "AStock" ||
    (mktNum !== "1" && mktNum !== "0") ||
    isBseCode(code)
  ) {
    return null
  }
  const normalized = normalizeMarketCode(`${mktNum === "1" ? "SH" : "SZ"}${code}`)
  if (normalized === null || !isAshareCode(normalized)) return null
  const pinyin = Reflect.get(value, "PinYin")
  return { code: normalized, name, pinyin: typeof pinyin === "string" ? pinyin : "" }
}

/** 解析东财 suggest 响应：仅保留沪深 A 股，剔除北交所/港美股/无效项并按代码去重 */
export function parseEastmoneySuggest(payload: unknown): readonly StockSearchMatch[] {
  const table = isRecord(payload) ? Reflect.get(payload, "QuotationCodeTable") : undefined
  const data = isRecord(table) ? Reflect.get(table, "Data") : undefined
  if (!Array.isArray(data)) return []
  const matches: StockSearchMatch[] = []
  const seen = new Set<string>()
  for (const item of data) {
    const match = parseEntry(item)
    if (match === null || seen.has(match.code)) continue
    seen.add(match.code)
    matches.push(match)
  }
  return matches
}

/** 创建东财股票搜索器：按名称、拼音或代码片段搜索沪深 A 股 */
export function createEastmoneyStockSearcher(http: StockSearchHttp = defaultHttp): StockSearcher {
  return async (query) => {
    const trimmed = query.trim()
    if (trimmed.length === 0) return []
    const url = `${SEARCH_URL}?input=${encodeURIComponent(trimmed)}&type=14&token=${SEARCH_TOKEN}&count=${SEARCH_COUNT}`
    const result = await http(url)
    if (!result.ok) throw new Error(`股票搜索接口异常：HTTP ${result.status}`)
    let payload: unknown
    try {
      payload = JSON.parse(result.body)
    } catch {
      throw new Error("股票搜索接口返回非 JSON 数据")
    }
    return parseEastmoneySuggest(payload)
  }
}
