import { withTimeout } from "../infra/http-timeout"
import { type ParsedMarketCode, parseMarketCode } from "./code"
import type { MarketDataDiagnostic, MarketQuote, MarketSnapshot } from "./data"
import { eastmoneyIndexSecid, fetchGlobalCloses } from "./global-market-klines"

export interface GlobalMarketHttp {
  fetch(input: string, init?: RequestInit): Promise<Response>
}

const QUOTE_ENDPOINT = "https://qt.gtimg.cn/q="
const INDEX_ENDPOINT = "https://push2.eastmoney.com/api/qt/ulist.np/get"
const REQUEST_TIMEOUT_MS = 12_000
const SOURCE = "腾讯行情"
const UNAVAILABLE = "全球行情暂不可用"
const INVALID_CODE = "全球股票代码无效"
const CURRENCY: Readonly<Record<"US" | "JP" | "KR", string>> = {
  US: "USD",
  JP: "JPY",
  KR: "KRW",
}
const UTC_OFFSET_HOURS: Readonly<Record<"US" | "JP" | "KR", number>> = { US: -4, JP: 9, KR: 9 }

export class TencentGlobalMarketDataSource {
  readonly #http: GlobalMarketHttp
  readonly #timeoutMs: number
  // TS 内置 Encoding 联合类型未收录 "gbk"，Bun 与浏览器均支持该标签
  readonly #gbk = new TextDecoder("gbk" as "utf-8")

  constructor(http: GlobalMarketHttp = { fetch }, timeoutMs: number = REQUEST_TIMEOUT_MS) {
    this.#http = http
    this.#timeoutMs = timeoutMs
  }

  async loadSnapshot(codes: readonly string[]): Promise<MarketSnapshot> {
    const targets: ParsedMarketCode[] = []
    const diagnostics: MarketDataDiagnostic[] = []
    for (const code of codes) {
      const parsed = parseMarketCode(code)
      if (parsed === null || parsed.market === "CN") {
        diagnostics.push({ code, market: "US", message: INVALID_CODE })
      } else {
        targets.push(parsed)
      }
    }
    const pending = new Map(targets.map((target) => [target.code, target]))
    const quotes = new Map<string, MarketQuote>()
    if (targets.length > 0) {
      const fields = await this.#tencentQuotes(targets)
      const tencentResolved: ParsedMarketCode[] = []
      for (const target of targets) {
        const quote = parseTencentQuote(target, fields.get(target.providerSymbol))
        if (quote !== null) {
          quotes.set(target.code, quote)
          pending.delete(target.code)
          tencentResolved.push(target)
        }
      }
      const eastmoneyCandidates = [...pending.values()].filter((target) => target.market === "US")
      const eastmoneyResolved: ParsedMarketCode[] = []
      if (eastmoneyCandidates.length > 0) {
        await this.#eastmoneyIndices(eastmoneyCandidates, pending, quotes, eastmoneyResolved)
      }
      for (const target of pending.values()) {
        diagnostics.push({ code: target.code, market: target.market, message: UNAVAILABLE })
      }
      await this.#attachTrends(tencentResolved, eastmoneyResolved, quotes)
    }
    return {
      quotes: codes.flatMap((code) => {
        const quote = quotes.get(code)
        return quote === undefined ? [] : [quote]
      }),
      trend: [...quotes.values()].find((quote) => (quote.trend?.length ?? 0) > 0)?.trend ?? [],
      source: SOURCE,
      diagnostics,
    }
  }

  async #tencentQuotes(targets: readonly ParsedMarketCode[]): Promise<Map<string, string[]>> {
    const url = `${QUOTE_ENDPOINT}${targets.map((target) => target.providerSymbol).join(",")}`
    try {
      const response = await withTimeout(this.#http.fetch(url), this.#timeoutMs, "全球行情")
      if (!response.ok) throw new Error("上游请求失败")
      const text = this.#gbk.decode(await response.arrayBuffer())
      const fields = new Map<string, string[]>()
      for (const match of text.matchAll(/v_([A-Za-z0-9.]+)="([^"]*)";/gu)) {
        fields.set(match[1] ?? "", (match[2] ?? "").split("~"))
      }
      return fields
    } catch {
      return new Map()
    }
  }

  async #eastmoneyIndices(
    targets: readonly ParsedMarketCode[],
    pending: Map<string, ParsedMarketCode>,
    quotes: Map<string, MarketQuote>,
    resolved: ParsedMarketCode[],
  ): Promise<void> {
    const secids = targets.map((target) => eastmoneyIndexSecid(target.providerSymbol.slice(2)))
    const url = `${INDEX_ENDPOINT}?secids=${secids.join(",")}&fields=f2,f3,f12,f14,f124,f152`
    try {
      const response = await withTimeout(this.#http.fetch(url), this.#timeoutMs, "全球指数")
      if (!response.ok) throw new Error("上游请求失败")
      const diff = record(record(await response.json())?.["data"])?.["diff"]
      const entries = new Map(
        (Array.isArray(diff) ? diff : []).flatMap((entry) => {
          const item = record(entry)
          const code = string(item?.["f12"])
          return code === undefined ? [] : [[code, item] as const]
        }),
      )
      for (const target of targets) {
        const quote = parseEastmoneyIndex(target, entries.get(target.providerSymbol.slice(2)))
        if (quote !== null) {
          quotes.set(target.code, quote)
          pending.delete(target.code)
          resolved.push(target)
        }
      }
    } catch {
      // 指数回退失败时由调用方统一生成诊断
    }
  }

  async #attachTrends(
    tencentResolved: readonly ParsedMarketCode[],
    eastmoneyResolved: readonly ParsedMarketCode[],
    quotes: Map<string, MarketQuote>,
  ): Promise<void> {
    const attach = async (target: ParsedMarketCode, viaEastmoney: boolean) => {
      const quote = quotes.get(target.code)
      if (quote === undefined) return
      const trend = await fetchGlobalCloses(this.#http, this.#timeoutMs, target, viaEastmoney)
      if (trend.length > 0) quotes.set(target.code, { ...quote, trend })
    }
    await Promise.all([
      ...tencentResolved.map((target) => attach(target, false)),
      ...eastmoneyResolved.map((target) => attach(target, true)),
    ])
  }
}

function parseTencentQuote(
  target: ParsedMarketCode,
  fields: readonly string[] | undefined,
): MarketQuote | null {
  if (fields === undefined || target.market === "CN") return null
  const price = Number(fields[3])
  const changePercent = Number(fields[32])
  const name = fields[1]?.trim() ?? ""
  if (
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isFinite(changePercent) ||
    name.length === 0 ||
    hasControlCharacter(name)
  ) {
    return null
  }
  return {
    code: target.code,
    name,
    price,
    changePercent,
    source: SOURCE,
    market: target.market,
    currency: CURRENCY[target.market],
    marketState: "unknown",
    asOf: parseAsOf(fields[30], UTC_OFFSET_HOURS[target.market]),
  }
}

function parseEastmoneyIndex(
  target: ParsedMarketCode,
  entry: Record<string, unknown> | undefined,
): MarketQuote | null {
  if (entry === undefined || target.market === "CN") return null
  const rawPrice = number(entry["f2"])
  const scale = number(entry["f152"])
  const rawPercent = number(entry["f3"])
  const name = string(entry["f14"])
  if (rawPrice === undefined || scale === undefined || rawPercent === undefined || !name) {
    return null
  }
  const price = rawPrice / 10 ** scale
  if (!Number.isFinite(price) || price <= 0 || hasControlCharacter(name)) return null
  const asOf = number(entry["f124"])
  return {
    code: target.code,
    name,
    price,
    changePercent: rawPercent / 100,
    source: SOURCE,
    market: target.market,
    marketState: "unknown",
    asOf: asOf === undefined ? null : Math.round(asOf * 1_000),
  }
}

function parseAsOf(value: string | undefined, offsetHours: number): number | null {
  if (value === undefined) return null
  const parsed = Date.parse(`${value.trim().replace(" ", "T")}Z`)
  return Number.isFinite(parsed) ? Math.round(parsed - offsetHours * 3_600_000) : null
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index)
    if (unit < 0x20 || (unit >= 0x7f && unit <= 0x9f)) return true
  }
  return false
}
