import { type FinancialNewsItem, hasUnsafeTerminalControl } from "../news/data"
import type { MarketCapitalSummary } from "./overview"
import { parseJson, recordField } from "./overview-parsers"

const REQUEST_TIMEOUT_MS = 12_000
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
const FFLOW_URL =
  "https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?ut=b2884a393a59ad64002292a3e90d46a5&lmt=3&klt=101&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55"
const NORTHBOUND_URL =
  "https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_MUTUAL_DEAL_HISTORY&columns=ALL&pageSize=10&sortColumns=TRADE_DATE&sortTypes=-1"
const ANNOUNCEMENTS_URL =
  "https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_index=1&ann_type=A&client_source=web&f_node=0&s_node=0"
const QUOTE_REFERER = "https://quote.eastmoney.com/"
const DATA_REFERER = "https://data.eastmoney.com/"
const SHANGHAI_OFFSET_MS = 8 * 3_600_000

export interface EastmoneyHttpResult {
  readonly ok: boolean
  readonly status: number
  readonly body: string
}

export type EastmoneyHttp = (url: string, referer: string) => Promise<EastmoneyHttpResult>

export type AnnouncementsFetcher = (limit?: number) => Promise<readonly FinancialNewsItem[]>

const defaultHttp: EastmoneyHttp = async (url, referer) => {
  const response = await fetch(url, {
    headers: { Accept: "application/json", Referer: referer, "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  return { ok: response.ok, status: response.status, body: await response.text() }
}

export interface IndexFundFlow {
  readonly date: string
  readonly mainNetInflow: number
}

export interface NorthboundDeal {
  readonly date: string
  readonly shTurnover: number
  readonly szTurnover: number
  readonly leadStockName: string
}

/** 主力资金日度流：取 klines 最后一日的 f52（主力净流入） */
export function parseFundFlow(payload: unknown): IndexFundFlow | null {
  const data = recordField(payload, "data")
  const klines = data === null ? undefined : Reflect.get(data, "klines")
  if (!Array.isArray(klines)) return null
  const last = klines.at(-1)
  if (typeof last !== "string") return null
  const parts = last.split(",")
  const date = parts[0]?.trim() ?? ""
  const mainNetInflow = Number(parts[1])
  if (date.length === 0 || !Number.isFinite(mainNetInflow)) return null
  return { date, mainNetInflow }
}

/** 北向互联互通：取最新交易日的沪（001）/深（005）两条成交额 */
export function parseNorthbound(payload: unknown): NorthboundDeal | null {
  const result = recordField(payload, "result")
  const rows = result === null ? undefined : Reflect.get(result, "data")
  if (!Array.isArray(rows)) return null
  const entries: { date: string; type: string; dealAmt: number; leadName: string }[] = []
  for (const raw of rows) {
    if (typeof raw !== "object" || raw === null) continue
    const tradeDate = Reflect.get(raw, "TRADE_DATE")
    const mutualType = Reflect.get(raw, "MUTUAL_TYPE")
    const dealAmt = Reflect.get(raw, "DEAL_AMT")
    const leadName = Reflect.get(raw, "LEAD_STOCKS_NAME")
    if (typeof tradeDate !== "string" || typeof mutualType !== "string") continue
    if (typeof dealAmt !== "number" || !Number.isFinite(dealAmt)) continue
    const date = tradeDate.slice(0, 10)
    if (date.length < 10) continue
    entries.push({
      date,
      type: mutualType,
      dealAmt,
      leadName: typeof leadName === "string" ? leadName : "",
    })
  }
  if (entries.length === 0) return null
  const latest = entries.reduce((max, entry) => (entry.date > max ? entry.date : max), "")
  const sh = entries.find((entry) => entry.date === latest && entry.type === "001")
  const sz = entries.find((entry) => entry.date === latest && entry.type === "005")
  if (sh === undefined || sz === undefined) return null
  return {
    date: latest,
    shTurnover: sh.dealAmt,
    szTurnover: sz.dealAmt,
    leadStockName: sh.leadName.length > 0 ? sh.leadName : sz.leadName,
  }
}

/** 公告列表：映射为 FinancialNewsItem，畸形条目丢弃 */
export function parseAnnouncements(payload: unknown, limit: number): readonly FinancialNewsItem[] {
  const data = recordField(payload, "data")
  const list = data === null ? undefined : Reflect.get(data, "list")
  if (!Array.isArray(list)) return []
  const items: FinancialNewsItem[] = []
  for (const raw of list) {
    if (typeof raw !== "object" || raw === null) continue
    const artCode = Reflect.get(raw, "art_code")
    const rawTitle = Reflect.get(raw, "title")
    const codes = Reflect.get(raw, "codes")
    const stockCode =
      Array.isArray(codes) && typeof codes[0] === "object" && codes[0] !== null
        ? Reflect.get(codes[0], "stock_code")
        : undefined
    if (typeof artCode !== "string" || artCode.length === 0) continue
    if (typeof rawTitle !== "string" || hasUnsafeTerminalControl(rawTitle)) continue
    if (typeof stockCode !== "string" || stockCode.length === 0) continue
    const publishedAt = parseNoticeTimestamp(
      Reflect.get(raw, "eiTime") ?? Reflect.get(raw, "notice_date"),
    )
    const title = rawTitle.replace(/\s+/gu, " ").trim()
    if (title.length === 0 || !Number.isFinite(publishedAt) || publishedAt < 1_000_000_000_000) {
      continue
    }
    items.push({
      id: `eastmoney-ann:${artCode}`,
      title,
      publishedAt,
      source: "东财公告",
      url: `https://data.eastmoney.com/notices/detail/${stockCode}/${artCode}.html`,
    })
    if (items.length >= limit) break
  }
  return items
}

function parseNoticeTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string") return Number.NaN
  const matched = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/u.exec(
    value.trim(),
  )
  if (matched === null) return Number.NaN
  const part = (index: number): number => Number(matched[index] ?? 0)
  return Date.UTC(part(1), part(2) - 1, part(3), part(4), part(5), part(6)) - SHANGHAI_OFFSET_MS
}

export async function fetchIndexFundFlow(
  secid: string,
  http: EastmoneyHttp = defaultHttp,
): Promise<IndexFundFlow> {
  const result = await http(`${FFLOW_URL}&secid=${encodeURIComponent(secid)}`, QUOTE_REFERER)
  if (!result.ok) throw new Error(`主力资金请求失败：${result.status}`)
  const flow = parseFundFlow(parseJson(result.body))
  if (flow === null) throw new Error("主力资金格式无效")
  return flow
}

export async function fetchNorthbound(http: EastmoneyHttp = defaultHttp): Promise<NorthboundDeal> {
  const result = await http(NORTHBOUND_URL, DATA_REFERER)
  if (!result.ok) throw new Error(`北向成交请求失败：${result.status}`)
  const deal = parseNorthbound(parseJson(result.body))
  if (deal === null) throw new Error("北向成交格式无效")
  return deal
}

export async function fetchEastmoneyAnnouncements(
  limit = 10,
  http: EastmoneyHttp = defaultHttp,
): Promise<readonly FinancialNewsItem[]> {
  const result = await http(`${ANNOUNCEMENTS_URL}&page_size=${limit}`, DATA_REFERER)
  if (!result.ok) throw new Error(`东财公告请求失败：${result.status}`)
  return parseAnnouncements(parseJson(result.body), limit)
}

/** 资金流 + 北向并发聚合；部分失败降级，全失败返回 null */
export async function fetchCapitalSummary(
  http: EastmoneyHttp = defaultHttp,
): Promise<MarketCapitalSummary | null> {
  const [sh, sz, north] = await Promise.allSettled([
    fetchIndexFundFlow("1.000001", http),
    fetchIndexFundFlow("0.399001", http),
    fetchNorthbound(http),
  ])
  const shFlow = sh.status === "fulfilled" ? sh.value : null
  const szFlow = sz.status === "fulfilled" ? sz.value : null
  const northDeal = north.status === "fulfilled" ? north.value : null
  if (shFlow === null && szFlow === null && northDeal === null) return null
  return {
    shMainNetInflow: shFlow?.mainNetInflow ?? null,
    szMainNetInflow: szFlow?.mainNetInflow ?? null,
    northbound:
      northDeal === null
        ? null
        : {
            shTurnover: northDeal.shTurnover,
            szTurnover: northDeal.szTurnover,
            leadStock: northDeal.leadStockName,
          },
  }
}
