import { stocks } from "stock-api"
import type { StockApiQuote } from "./market-data"
import type {
  MarketBreadth,
  MarketIndexOverview,
  MarketMover,
  MarketOverviewDataSource,
  MarketOverviewSnapshot,
  SectorOverview,
} from "./market-overview"
import {
  collectErrors,
  fulfilled,
  parseJson,
  parseMover,
  parseSector,
  recordField,
} from "./market-overview-parsers"

const INDEX_CODES = [
  "SH000001",
  "SZ399001",
  "SZ399006",
  "SH000300",
  "SH000688",
  "SH000905",
  "SH000852",
] as const
const BREADTH_URL =
  "https://push2ex.eastmoney.com/getTopicZDFenBu?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt"
const INDUSTRY_URL = "https://money.finance.sina.com.cn/q/view/newSinaHy.php"
const MOVERS_URL =
  "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData"
const REQUEST_TIMEOUT_MS = 12_000
const RESULT_LIMIT = 10

export interface MarketIndexQuoteClient {
  getStocks(codes: string[]): Promise<readonly StockApiQuote[]>
}

export interface MarketOverviewHttpResult {
  readonly ok: boolean
  readonly status: number
  readonly body: string
}

export type MarketOverviewFetcher = (url: string) => Promise<MarketOverviewHttpResult>

const DEFAULT_FETCHER: MarketOverviewFetcher = async (url) => {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      Referer: "https://finance.sina.com.cn/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
  const body = contentType.includes("gbk")
    ? new TextDecoder("gb18030" as ConstructorParameters<typeof TextDecoder>[0]).decode(
        await response.arrayBuffer(),
      )
    : await response.text()
  return { ok: response.ok, status: response.status, body }
}

export class PublicMarketOverviewDataSource implements MarketOverviewDataSource {
  readonly #indexClient: MarketIndexQuoteClient
  readonly #fetcher: MarketOverviewFetcher
  readonly #now: () => number

  constructor(
    indexClient: MarketIndexQuoteClient = stocks.auto,
    fetcher: MarketOverviewFetcher = DEFAULT_FETCHER,
    now: () => number = Date.now,
  ) {
    this.#indexClient = indexClient
    this.#fetcher = fetcher
    this.#now = now
  }

  async loadOverview(): Promise<MarketOverviewSnapshot> {
    const results = await Promise.allSettled([
      this.#loadIndices(),
      this.#loadBreadth(),
      this.#loadSectors(),
      this.#loadMovers(false),
      this.#loadMovers(true),
    ] as const)
    const indices = fulfilled(results[0]) ?? []
    const breadth = fulfilled(results[1])
    const sectors = fulfilled(results[2])
    const gainers = fulfilled(results[3])
    const losers = fulfilled(results[4])
    const movers =
      gainers === null && losers === null ? null : { gainers: gainers ?? [], losers: losers ?? [] }
    const errors = collectErrors(results, [
      "主要指数",
      "涨跌广度",
      "行业板块",
      "领涨个股",
      "领跌个股",
    ])
    if (indices.length === 0 && breadth === null && sectors === null && movers === null) {
      throw new Error(`没有可用大盘数据：${errors.join("；")}`)
    }
    return {
      indices,
      breadth,
      sectors,
      movers,
      availability: {
        indices: indices.length > 0,
        breadth: breadth !== null,
        sectors: sectors !== null,
        movers: movers !== null,
        errors,
      },
      source: "stock-api + 东方财富 + 新浪财经",
      updatedAt: this.#now(),
    }
  }

  async #loadIndices(): Promise<MarketIndexOverview[]> {
    const quotes = await this.#indexClient.getStocks([...INDEX_CODES])
    return quotes
      .filter((quote) => quote.now > 0 && quote.name !== "---")
      .map((quote) => ({
        code: quote.code,
        name: quote.name,
        price: quote.now,
        changePercent: quote.percent * 100,
        high: quote.high,
        low: quote.low,
        previousClose: quote.yesterday,
        source: quote.source ?? "stock-api",
      }))
  }

  async #loadBreadth(): Promise<MarketBreadth> {
    const payload = parseJson(await this.#request(BREADTH_URL))
    const data = recordField(payload, "data")
    const bins = data === null ? undefined : Reflect.get(data, "fenbu")
    if (!Array.isArray(bins)) throw new Error("涨跌分布格式无效")
    const distribution: Record<string, number> = {}
    for (const bin of bins) {
      if (typeof bin !== "object" || bin === null) continue
      for (const [key, value] of Object.entries(bin)) {
        if (typeof value === "number" && Number.isFinite(value)) distribution[key] = value
      }
    }
    const entries = Object.entries(distribution)
    const sum = (predicate: (bucket: number) => boolean): number =>
      entries.reduce((total, [key, value]) => total + (predicate(Number(key)) ? value : 0), 0)
    return {
      rising: sum((bucket) => bucket > 0),
      falling: sum((bucket) => bucket < 0),
      flat: distribution["0"] ?? 0,
      gainAtLeast10Percent: sum((bucket) => bucket >= 10),
      lossAtLeast10Percent: sum((bucket) => bucket <= -10),
      distribution,
    }
  }

  async #loadSectors(): Promise<MarketOverviewSnapshot["sectors"]> {
    const body = await this.#request(INDUSTRY_URL)
    const assignment = body.indexOf("=")
    if (assignment < 0) throw new Error("行业板块格式无效")
    const raw = parseJson(
      body
        .slice(assignment + 1)
        .trim()
        .replace(/;$/u, ""),
    )
    if (typeof raw !== "object" || raw === null) throw new Error("行业板块格式无效")
    const sectors: SectorOverview[] = []
    for (const value of Object.values(raw)) {
      if (typeof value !== "string") continue
      const sector = parseSector(value)
      if (sector !== null) sectors.push(sector)
    }
    if (sectors.length === 0) throw new Error("行业板块为空")
    sectors.sort((left, right) => right.changePercent - left.changePercent)
    return {
      leaders: sectors.slice(0, RESULT_LIMIT),
      laggards: sectors.slice(-RESULT_LIMIT).reverse(),
      totalTurnover: sectors.reduce((total, sector) => total + sector.turnover, 0),
    }
  }

  async #loadMovers(ascending: boolean): Promise<MarketMover[]> {
    const endpoint = new URL(MOVERS_URL)
    endpoint.search = new URLSearchParams({
      page: "1",
      num: String(RESULT_LIMIT),
      sort: "changepercent",
      asc: ascending ? "1" : "0",
      node: "hs_a",
      symbol: "",
      _s_r_a: "page",
    }).toString()
    const payload = parseJson(await this.#request(endpoint.toString()))
    if (!Array.isArray(payload)) throw new Error("涨跌排行格式无效")
    return payload.flatMap((item) => {
      const mover = parseMover(item)
      return mover === null ? [] : [mover]
    })
  }

  async #request(url: string): Promise<string> {
    const response = await this.#fetcher(url)
    if (!response.ok) throw new Error(`请求失败：${response.status}`)
    return response.body
  }
}
