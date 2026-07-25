export interface OrderBookLevel {
  readonly price: number
  readonly volume: number
}

export interface StockDetail {
  readonly code: string
  readonly name?: string
  readonly open?: number
  readonly volume?: number
  readonly turnover?: number
  readonly turnoverRate?: number
  readonly peTtm?: number
  readonly amplitude?: number
  readonly circMarketCap?: number
  readonly totalMarketCap?: number
  readonly pb?: number
  readonly limitUp?: number
  readonly limitDown?: number
  readonly volumeRatio?: number
  readonly averagePrice?: number
  readonly week52High?: number
  readonly week52Low?: number
  readonly bids?: readonly OrderBookLevel[]
  readonly asks?: readonly OrderBookLevel[]
}

export type StockDetailFetcher = (
  codes: readonly string[],
) => Promise<ReadonlyMap<string, StockDetail>>

const TENCENT_FIELD = {
  open: 5,
  volume: 6,
  high: 33,
  low: 34,
  turnover: 37,
  turnoverRate: 38,
  peTtm: 39,
  amplitude: 43,
  circMarketCap: 44,
  totalMarketCap: 45,
  pb: 46,
  limitUp: 47,
  limitDown: 48,
  volumeRatio: 49,
  averagePrice: 51,
  week52High: 67,
  week52Low: 68,
} as const

function parseLevels(parts: readonly string[], start: number): readonly OrderBookLevel[] {
  const levels: OrderBookLevel[] = []
  for (let index = start; index < start + 10; index += 2) {
    const price = numberAt(parts, index)
    const volume = numberAt(parts, index + 1)
    if (price !== undefined && volume !== undefined) levels.push({ price, volume })
  }
  return levels
}

function numberAt(parts: readonly string[], index: number): number | undefined {
  const value = Number(parts[index])
  return Number.isFinite(value) && value !== 0 ? value : undefined
}

export function parseTencentDetail(code: string, payload: string): StockDetail {
  const parts = payload.split("~")
  const name = parts[1]?.trim()
  const open = numberAt(parts, TENCENT_FIELD.open)
  const volume = numberAt(parts, TENCENT_FIELD.volume)
  const turnover = numberAt(parts, TENCENT_FIELD.turnover)
  const turnoverRate = numberAt(parts, TENCENT_FIELD.turnoverRate)
  const peTtm = numberAt(parts, TENCENT_FIELD.peTtm)
  const amplitude = numberAt(parts, TENCENT_FIELD.amplitude)
  const circMarketCap = numberAt(parts, TENCENT_FIELD.circMarketCap)
  const totalMarketCap = numberAt(parts, TENCENT_FIELD.totalMarketCap)
  const pb = numberAt(parts, TENCENT_FIELD.pb)
  const limitUp = numberAt(parts, TENCENT_FIELD.limitUp)
  const limitDown = numberAt(parts, TENCENT_FIELD.limitDown)
  const volumeRatio = numberAt(parts, TENCENT_FIELD.volumeRatio)
  const averagePrice = numberAt(parts, TENCENT_FIELD.averagePrice)
  const week52High = numberAt(parts, TENCENT_FIELD.week52High)
  const week52Low = numberAt(parts, TENCENT_FIELD.week52Low)
  const bids = parseLevels(parts, 9)
  const asks = parseLevels(parts, 19)
  return {
    code,
    ...(name === undefined || name.length === 0 ? {} : { name }),
    ...(open === undefined ? {} : { open }),
    ...(volume === undefined ? {} : { volume }),
    ...(turnover === undefined ? {} : { turnover }),
    ...(turnoverRate === undefined ? {} : { turnoverRate }),
    ...(peTtm === undefined ? {} : { peTtm }),
    ...(amplitude === undefined ? {} : { amplitude }),
    ...(circMarketCap === undefined ? {} : { circMarketCap }),
    ...(totalMarketCap === undefined ? {} : { totalMarketCap }),
    ...(pb === undefined ? {} : { pb }),
    ...(limitUp === undefined ? {} : { limitUp }),
    ...(limitDown === undefined ? {} : { limitDown }),
    ...(volumeRatio === undefined ? {} : { volumeRatio }),
    ...(averagePrice === undefined ? {} : { averagePrice }),
    ...(week52High === undefined ? {} : { week52High }),
    ...(week52Low === undefined ? {} : { week52Low }),
    ...(bids.length === 0 ? {} : { bids }),
    ...(asks.length === 0 ? {} : { asks }),
  }
}

// Bun 的 TextDecoder 类型未列出 gbk，但运行时支持；腾讯接口为 GBK 编码，
// 按 UTF-8 误解码会把 GBK 尾字节 0x7E 变成伪 "~" 分隔符，必须用 gbk。
const GBK = "gbk" as "utf-8"

export const fetchTencentStockDetails: StockDetailFetcher = async (codes) => {
  const query = codes.map((code) => code.toLowerCase()).join(",")
  const response = await fetch(`https://qt.gtimg.cn/q=${query}`)
  const text = new TextDecoder(GBK).decode(await response.arrayBuffer())
  const details = new Map<string, StockDetail>()
  for (const line of text.split(";")) {
    const trimmed = line.trim()
    const equal = trimmed.indexOf("=")
    if (equal < 0) continue
    const rawCode = trimmed.slice(0, equal).replace(/^v_/u, "").toUpperCase()
    const payload = trimmed.slice(equal + 1).replace(/^"|"$/gu, "")
    if (payload.length === 0) continue
    details.set(rawCode, parseTencentDetail(rawCode, payload))
  }
  return details
}
