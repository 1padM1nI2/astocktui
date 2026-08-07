import { hasUnsafeTerminalControl } from "../news/news-data"
import type { EastmoneyHttpResult } from "./eastmoney-extra"
import { parseJson } from "./market-overview-parsers"

const REQUEST_TIMEOUT_MS = 12_000
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
const RANK_URL = "https://emappdata.eastmoney.com/stockrank/getAllCurrentList"
const QUOTE_URL = "https://push2.eastmoney.com/api/qt/ulist.np/get"
const QUOTE_UT = "b2884a393a59ad64002292a3e90d46a5"
const GUBA_REFERER = "https://guba.eastmoney.com/"
const QUOTE_REFERER = "https://quote.eastmoney.com/"
const RANK_BODY = {
  appId: "appId01",
  globalId: "786e4c21-70dc-435a-93bb-38",
  marketType: "",
  pageNo: 1,
}

export interface HotRankRequest {
  readonly url: string
  readonly referer: string
  readonly method?: "GET" | "POST"
  readonly body?: string
}

export type HotRankHttp = (request: HotRankRequest) => Promise<EastmoneyHttpResult>

const defaultHttp: HotRankHttp = async (request) => {
  const response = await fetch(request.url, {
    method: request.method ?? "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Referer: request.referer,
      "User-Agent": USER_AGENT,
    },
    body: request.body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  return { ok: response.ok, status: response.status, body: await response.text() }
}

/** 股吧人气榜行：code 带交易所前缀（SH/SZ），rankChange 为当日排名变动（正升负降） */
export interface HotRankRow {
  readonly code: string
  readonly rank: number
  readonly rankChange: number
}

export interface HotRankQuote {
  readonly name: string
  readonly price: number | null
  readonly changePercent: number | null
}

/** 人气榜条目：行情缺失时 name 退化为六位代码、报价为 null */
export interface HotRankEntry extends HotRankRow {
  readonly name: string
  readonly price: number | null
  readonly changePercent: number | null
}

export interface HotRankSnapshot {
  readonly items: readonly HotRankEntry[]
  readonly source: string
  readonly updatedAt: number
}

export type HotRankFetcher = (limit?: number) => Promise<HotRankSnapshot>

/** 人气榜 POST 返回：data 为 {sc, rk, rc} 数组，畸形条目丢弃，按排名升序 */
export function parseHotRankList(payload: unknown): HotRankRow[] {
  if (typeof payload !== "object" || payload === null) return []
  const list = Reflect.get(payload, "data")
  if (!Array.isArray(list)) return []
  const rows: HotRankRow[] = []
  for (const raw of list) {
    if (typeof raw !== "object" || raw === null) continue
    const sc = Reflect.get(raw, "sc")
    const rank = Reflect.get(raw, "rk")
    const rankChange = Reflect.get(raw, "rc")
    if (typeof sc !== "string" || !/^(?:SH|SZ)\d{6}$/u.test(sc)) continue
    if (typeof rank !== "number" || !Number.isFinite(rank)) continue
    if (
      rankChange !== undefined &&
      (typeof rankChange !== "number" || !Number.isFinite(rankChange))
    )
      continue
    rows.push({ code: sc, rank, rankChange: rankChange ?? 0 })
  }
  return rows.sort((left, right) => left.rank - right.rank)
}

/** 批量行情返回：按六位代码建映射；停牌等缺报价场景 price/changePercent 为 null */
export function parseQuoteBatch(payload: unknown): ReadonlyMap<string, HotRankQuote> {
  const quotes = new Map<string, HotRankQuote>()
  if (typeof payload !== "object" || payload === null) return quotes
  const data = Reflect.get(payload, "data")
  if (typeof data !== "object" || data === null) return quotes
  const diff = Reflect.get(data, "diff")
  if (!Array.isArray(diff)) return quotes
  for (const raw of diff) {
    if (typeof raw !== "object" || raw === null) continue
    const code = Reflect.get(raw, "f12")
    const name = Reflect.get(raw, "f14")
    if (typeof code !== "string" || !/^\d{6}$/u.test(code)) continue
    if (typeof name !== "string" || name.length === 0 || hasUnsafeTerminalControl(name)) continue
    const price = Number(Reflect.get(raw, "f2"))
    const changePercent = Number(Reflect.get(raw, "f3"))
    quotes.set(code, {
      name,
      price: Number.isFinite(price) ? price : null,
      changePercent: Number.isFinite(changePercent) ? changePercent : null,
    })
  }
  return quotes
}

function toSecid(code: string): string {
  return `${code.startsWith("SH") ? "1" : "0"}.${code.slice(2)}`
}

function quoteUrlFor(rows: readonly HotRankRow[]): string {
  const secids = rows.map((row) => toSecid(row.code)).join(",")
  return `${QUOTE_URL}?fltt=2&secids=${secids}&fields=f12,f14,f2,f3&ut=${QUOTE_UT}`
}

async function loadQuotes(
  rows: readonly HotRankRow[],
  http: HotRankHttp,
): Promise<ReadonlyMap<string, HotRankQuote>> {
  try {
    const result = await http({ url: quoteUrlFor(rows), referer: QUOTE_REFERER })
    if (!result.ok) return new Map()
    return parseQuoteBatch(parseJson(result.body))
  } catch {
    return new Map()
  }
}

/** 股吧人气榜：POST 取榜单，再批量补名称/报价；行情失败降级为代码名，榜单失败抛错 */
export async function fetchHotRank(
  limit = 50,
  http: HotRankHttp = defaultHttp,
  now: () => number = Date.now,
): Promise<HotRankSnapshot> {
  const result = await http({
    url: RANK_URL,
    referer: GUBA_REFERER,
    method: "POST",
    body: JSON.stringify({ ...RANK_BODY, pageSize: limit }),
  })
  if (!result.ok) throw new Error(`人气榜请求失败：${result.status}`)
  const rows = parseHotRankList(parseJson(result.body)).slice(0, limit)
  if (rows.length === 0) throw new Error("人气榜格式无效")
  const quotes = await loadQuotes(rows, http)
  const items: HotRankEntry[] = rows.map((row) => {
    const quote = quotes.get(row.code.slice(2))
    return {
      ...row,
      name: quote?.name ?? row.code.slice(2),
      price: quote?.price ?? null,
      changePercent: quote?.changePercent ?? null,
    }
  })
  return { items, source: "东财股吧人气", updatedAt: now() }
}
