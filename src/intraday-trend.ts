export type IntradayTrendFetcher = (
  codes: readonly string[],
) => Promise<ReadonlyMap<string, readonly number[]>>

/** 解析腾讯分时接口返回的单个标的数据，输出当天分钟收盘价序列 */
export function parseTencentMinuteTrend(payload: unknown): readonly number[] {
  const rows = (payload as { readonly data?: { readonly data?: unknown } } | undefined)?.data?.data
  if (!Array.isArray(rows)) return []
  const prices: number[] = []
  for (const row of rows) {
    if (typeof row !== "string") continue
    const price = Number(row.split(" ")[1])
    if (Number.isFinite(price) && price > 0) prices.push(price)
  }
  return prices
}

/** 逐个拉取腾讯分时数据；单只失败仅该只为空，不影响其它 */
export const fetchTencentIntradayTrends: IntradayTrendFetcher = async (codes) => {
  const trends = new Map<string, readonly number[]>()
  await Promise.all(
    codes.map(async (code) => {
      const apiCode = code.toLowerCase()
      try {
        const response = await fetch(
          `https://ifzq.gtimg.cn/appstock/app/minute/query?code=${apiCode}`,
        )
        const json: unknown = await response.json()
        const payload = (json as { readonly data?: Readonly<Record<string, unknown>> } | undefined)
          ?.data?.[apiCode]
        trends.set(code, parseTencentMinuteTrend(payload))
      } catch {
        trends.set(code, [])
      }
    }),
  )
  return trends
}
