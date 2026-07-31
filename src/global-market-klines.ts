import { withTimeout } from "./http-timeout"
import type { ParsedMarketCode } from "./market-code"

export interface GlobalKlineHttp {
  fetch(input: string, init?: RequestInit): Promise<Response>
}

const EASTMONEY_KLINE_ENDPOINT = "https://push2his.eastmoney.com/api/qt/stock/kline/get"
const TENCENT_KLINE_ENDPOINT = "https://web.ifzq.gtimg.cn/appstock/app/kline/kline"
const KLINE_LIMIT = 30
const US_STOCK_MARKETS: readonly number[] = [105, 106]

/**
 * 拉取全球标的最近日 K 收盘价序列。腾讯与东财均无日股、韩股个股 K 线，返回空数组。
 * viaEastmoney 为 true 表示报价来自东财指数回退；腾讯解析的美股个股
 * 依次探测纳斯达克（105）与纽交所（106），腾讯解析的指数使用带点符号（us.IXIC）。
 */
export async function fetchGlobalCloses(
  http: GlobalKlineHttp,
  timeoutMs: number,
  target: ParsedMarketCode,
  viaEastmoney: boolean,
): Promise<readonly number[]> {
  if (target.market !== "US") return []
  const bare = target.providerSymbol.slice(2)
  if (viaEastmoney) return eastmoneyCloses(http, timeoutMs, eastmoneyIndexSecid(bare))
  if (target.code.startsWith("US:^")) return tencentIndexCloses(http, timeoutMs, `us.${bare}`)
  for (const market of US_STOCK_MARKETS) {
    const closes = await eastmoneyCloses(http, timeoutMs, `${market}.${bare}`)
    if (closes.length > 0) return closes
  }
  return []
}

const EASTMONEY_INDEX_SECID_ALIAS: Readonly<Record<string, string>> = { SOX: "251.SOX" }

/** 东财全球指数 secid：常规代码在 100 市场，费城半导体等特殊指数在 251 市场 */
export function eastmoneyIndexSecid(bare: string): string {
  return EASTMONEY_INDEX_SECID_ALIAS[bare] ?? `100.${bare}`
}

async function eastmoneyCloses(
  http: GlobalKlineHttp,
  timeoutMs: number,
  secid: string,
): Promise<readonly number[]> {
  const url =
    `${EASTMONEY_KLINE_ENDPOINT}?secid=${secid}&fields1=f1,f2,f3&fields2=f51,f53` +
    `&klt=101&fqt=0&end=20500101&lmt=${KLINE_LIMIT}`
  try {
    const response = await withTimeout(http.fetch(url), timeoutMs, "全球K线")
    if (!response.ok) return []
    const klines = record(record(await response.json())?.["data"])?.["klines"]
    if (!Array.isArray(klines)) return []
    return klines
      .map((line) => (typeof line === "string" ? Number(line.split(",")[1]) : Number.NaN))
      .filter((value) => Number.isFinite(value) && value > 0)
  } catch {
    return []
  }
}

async function tencentIndexCloses(
  http: GlobalKlineHttp,
  timeoutMs: number,
  symbol: string,
): Promise<readonly number[]> {
  const url = `${TENCENT_KLINE_ENDPOINT}?param=${symbol},day,,,${KLINE_LIMIT},`
  try {
    const response = await withTimeout(http.fetch(url), timeoutMs, "全球指数K线")
    if (!response.ok) return []
    const rows = record(record(record(await response.json())?.["data"])?.[symbol])?.["day"]
    if (!Array.isArray(rows)) return []
    return rows
      .map((row) => (Array.isArray(row) ? Number(row[2]) : Number.NaN))
      .filter((value) => Number.isFinite(value) && value > 0)
  } catch {
    return []
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
