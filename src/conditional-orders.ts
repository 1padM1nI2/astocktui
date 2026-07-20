import { isAshareCode, normalizeMarketCode } from "./market-code"
import type { MarketQuote } from "./market-data"

export type ConditionalOrderCondition =
  | { readonly type: "price"; readonly operator: "gte" | "lte"; readonly price: number }
  | {
      readonly type: "change-percent"
      readonly operator: "gte" | "lte"
      readonly percent: number
      readonly referencePrice: number
    }
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
    if (order.condition.type === "time")
      matched = now.getTime() >= new Date(order.condition.at).getTime()
    else if (marketOpen) {
      const quote = quotes.get(order.code)
      const price = quote?.price
      evidence = String(quote?.asOf ?? now.getTime())
      if (price !== undefined && price > 0 && order.lastEvidenceAt !== evidence) {
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
    const cooling =
      order.lastTriggeredAt !== undefined &&
      now.getTime() - new Date(order.lastTriggeredAt).getTime() < order.cooldownMinutes * 60_000
    if (!matched || cooling) return { ...order, lastEvidenceAt: evidence }
    triggers.push({ id: order.id, evidence })
    return {
      ...order,
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
