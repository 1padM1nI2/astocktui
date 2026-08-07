import { withTimeout } from "./http-timeout"
import { parseMarketCode } from "./market-code"
import type { KlineBar } from "./market-data"

export interface BacktestHttp {
  fetch(input: string, init?: RequestInit): Promise<Response>
}

const EASTMONEY_KLINE_ENDPOINT = "https://push2his.eastmoney.com/api/qt/stock/kline/get"
const KLINE_FIELDS = "f51,f52,f53,f54,f55,f56"

/** 东财日 K secid：沪市在 1 市场，深市在 0 市场；仅支持 A 股 */
export function eastmoneyDailySecid(code: string): string | null {
  const parsed = parseMarketCode(code)
  if (parsed === null || parsed.market !== "CN") return null
  const digits = parsed.code.slice(2)
  return parsed.code.startsWith("SH") ? `1.${digits}` : `0.${digits}`
}

/** 解析东财 klines 行（date,open,close,high,low,volume,…），丢弃畸形与非正价格行 */
export function parseDailyKlines(payload: unknown): readonly KlineBar[] {
  const klines = record(record(payload)?.["data"])?.["klines"]
  if (!Array.isArray(klines)) return []
  const bars: KlineBar[] = []
  for (const line of klines) {
    if (typeof line !== "string") continue
    const parts = line.split(",")
    if (parts.length < 5) continue
    const date = parts[0] ?? ""
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) continue
    const open = Number(parts[1])
    const close = Number(parts[2])
    const high = Number(parts[3])
    const low = Number(parts[4])
    if (![open, close, high, low].every((value) => Number.isFinite(value) && value > 0)) continue
    const volume = Number(parts[5])
    bars.push({
      date,
      open,
      close,
      high,
      low,
      ...(Number.isFinite(volume) && volume > 0 ? { volume } : {}),
    })
  }
  return bars
}

/**
 * 拉取 A 股前复权日 K。前复权（fqt=1）保证分红拆股后均线类策略信号不断裂。
 * 网络与 HTTP 错误抛出异常；响应正常但无数据时返回空数组。
 */
export async function fetchDailyKlines(
  http: BacktestHttp,
  timeoutMs: number,
  code: string,
  count: number,
): Promise<readonly KlineBar[]> {
  const secid = eastmoneyDailySecid(code)
  if (secid === null) throw new Error(`历史K线仅支持A股：${code}`)
  const url =
    `${EASTMONEY_KLINE_ENDPOINT}?secid=${secid}&fields1=f1,f2,f3&fields2=${KLINE_FIELDS}` +
    `&klt=101&fqt=1&end=20500101&lmt=${Math.max(1, count | 0)}`
  const response = await withTimeout(http.fetch(url), timeoutMs, "历史K线")
  if (!response.ok) throw new Error(`历史K线请求失败：HTTP ${response.status}`)
  return parseDailyKlines(await response.json())
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
