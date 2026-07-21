import { isAshareCode, normalizeMarketCode } from "./market-code"
import type { MarketQuote } from "./market-data"
import { continuousAuctionElapsedMinutes, shanghaiDateTime } from "./trading-calendar"

export type ConditionalOrderCondition =
  | { readonly type: "price"; readonly operator: "gte" | "lte"; readonly price: number }
  | {
      readonly type: "change-percent"
      readonly operator: "gte" | "lte"
      readonly percent: number
      readonly referencePrice: number
    }
  | { readonly type: "rebound"; readonly percent: number }
  | { readonly type: "drawdown"; readonly percent: number }
  | { readonly type: "volume-ratio"; readonly operator: "gte" | "lte"; readonly ratio: number }
  | { readonly type: "time"; readonly at: string }
export type ConditionalOrderAction =
  | { readonly kind: "trade"; readonly side: "buy" | "sell"; readonly quantity: number }
  | { readonly kind: "analyze" }
export interface ConditionalOrder {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly condition: ConditionalOrderCondition
  readonly action: ConditionalOrderAction
  readonly createdAt: string
  readonly expiresAt: string
  status: "enabled" | "paused" | "triggered" | "cancelled" | "expired"
  readonly triggerPolicy: "once" | "repeat"
  readonly cooldownMinutes: number
  extremePrice?: number
  avgVolume?: number
  avgVolumeDate?: string
  lastEvidenceAt?: string
  lastTriggeredAt?: string
}
export interface ConditionalOrderState {
  readonly version: 1
  readonly sequence: number
  readonly orders: readonly ConditionalOrder[]
}
export interface ConditionalOrderTrigger {
  readonly id: string
  readonly evidence: string
}

const matches = (value: number, operator: "gte" | "lte", threshold: number): boolean =>
  operator === "gte" ? value >= threshold : value <= threshold
export function evaluateConditionalOrders(
  orders: readonly ConditionalOrder[],
  quotes: ReadonlyMap<string, MarketQuote>,
  now: Date,
  marketOpen: boolean,
): {
  readonly orders: readonly ConditionalOrder[]
  readonly triggers: readonly ConditionalOrderTrigger[]
} {
  const triggers: ConditionalOrderTrigger[] = []
  const next = orders.map((order) => {
    if (new Date(order.expiresAt).getTime() <= now.getTime())
      return { ...order, status: "expired" as const }
    if (order.status !== "enabled") return order
    let matched = false
    let evidence = now.toISOString()
    let extremePrice = order.extremePrice
    if (order.condition.type === "time")
      matched = now.getTime() >= new Date(order.condition.at).getTime()
    else if (marketOpen) {
      const quote = quotes.get(order.code)
      const price = quote?.price
      evidence = String(quote?.asOf ?? now.getTime())
      if (price !== undefined && price > 0 && order.lastEvidenceAt !== evidence) {
        if (order.condition.type === "rebound") {
          const reference = extremePrice ?? price
          matched =
            extremePrice !== undefined && price >= reference * (1 + order.condition.percent / 100)
          extremePrice = Math.min(reference, price)
        } else if (order.condition.type === "drawdown") {
          const reference = extremePrice ?? price
          matched =
            extremePrice !== undefined && price <= reference * (1 - order.condition.percent / 100)
          extremePrice = Math.max(reference, price)
        } else if (order.condition.type === "volume-ratio") {
          const elapsed = continuousAuctionElapsedMinutes(now)
          const baseline =
            order.avgVolumeDate === shanghaiDateTime(now).date ? order.avgVolume : undefined
          const volume = quote?.volume
          if (
            elapsed > 0 &&
            baseline !== undefined &&
            baseline > 0 &&
            volume !== undefined &&
            volume > 0
          ) {
            const expected = (baseline * elapsed) / 240
            matched = matches(volume / expected, order.condition.operator, order.condition.ratio)
          }
        } else {
          const value =
            order.condition.type === "price"
              ? price
              : ((price - order.condition.referencePrice) / order.condition.referencePrice) * 100
          matched = matches(
            value,
            order.condition.operator,
            order.condition.type === "price" ? order.condition.price : order.condition.percent,
          )
        }
      }
    }
    const cooling =
      order.lastTriggeredAt !== undefined &&
      now.getTime() - new Date(order.lastTriggeredAt).getTime() < order.cooldownMinutes * 60_000
    const tracked = extremePrice === undefined ? {} : { extremePrice }
    if (!matched || cooling) return { ...order, ...tracked, lastEvidenceAt: evidence }
    triggers.push({ id: order.id, evidence })
    return {
      ...order,
      ...tracked,
      status: order.triggerPolicy === "once" ? ("triggered" as const) : order.status,
      lastEvidenceAt: evidence,
      lastTriggeredAt: now.toISOString(),
    }
  })
  return { orders: next, triggers }
}

export function validateConditionalOrder(
  code: string,
  action: ConditionalOrderAction,
  lotSize: number,
): string | null {
  const normalized = normalizeMarketCode(code)
  if (normalized === null) return "股票代码无效"
  if (action.kind === "trade" && !isAshareCode(normalized)) return "海外股票仅支持分析提醒"
  if (
    action.kind === "trade" &&
    (!Number.isInteger(action.quantity) || action.quantity <= 0 || action.quantity % lotSize !== 0)
  )
    return `数量必须是 ${lotSize} 股整数倍`
  return null
}
