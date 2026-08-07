import type { MarketMover, SectorOverview } from "./overview"

export function parseSector(value: string): SectorOverview | null {
  const fields = value.split(",")
  const code = fields[0]
  const name = fields[1]
  const companyCount = Number(fields[2])
  const changePercent = Number(fields[5])
  const turnover = Number(fields[7])
  const leaderCode = fields[8]
  const leaderChangePercent = Number(fields[9])
  const leaderName = fields[12]
  if (
    code === undefined ||
    name === undefined ||
    leaderCode === undefined ||
    leaderName === undefined ||
    ![companyCount, changePercent, turnover, leaderChangePercent].every(Number.isFinite)
  ) {
    return null
  }
  return {
    code,
    name,
    companyCount,
    changePercent,
    turnover,
    leaderCode: leaderCode.toUpperCase(),
    leaderName,
    leaderChangePercent,
  }
}

export function parseMover(value: unknown): MarketMover | null {
  if (typeof value !== "object" || value === null) return null
  const symbol = Reflect.get(value, "symbol")
  const name = Reflect.get(value, "name")
  const price = Number(Reflect.get(value, "trade"))
  const changePercent = Number(Reflect.get(value, "changepercent"))
  const turnover = Number(Reflect.get(value, "amount"))
  const turnoverRate = Number(Reflect.get(value, "turnoverratio"))
  if (
    typeof symbol !== "string" ||
    typeof name !== "string" ||
    ![price, changePercent, turnover, turnoverRate].every(Number.isFinite)
  ) {
    return null
  }
  return { code: symbol.toUpperCase(), name, price, changePercent, turnover, turnoverRate }
}

export function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    throw new Error("公共市场接口返回非 JSON 数据")
  }
}

export function recordField(value: unknown, field: string): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null
  const nested = Reflect.get(value, field)
  return typeof nested === "object" && nested !== null ? (nested as Record<string, unknown>) : null
}

export function fulfilled<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null
}

export function collectErrors(
  results: readonly PromiseSettledResult<unknown>[],
  labels: readonly string[],
): string[] {
  const errors: string[] = []
  for (let index = 0; index < results.length; index++) {
    const result = results[index]
    if (result?.status !== "rejected") continue
    const reason = result.reason instanceof Error ? result.reason.message : String(result.reason)
    errors.push(`${labels[index] ?? "数据"}：${reason}`)
  }
  return errors
}
