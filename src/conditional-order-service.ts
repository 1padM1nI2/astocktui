import type { AgentEventSink } from "./agent-event-dispatcher"
import type { ConditionalOrderStore } from "./conditional-order-store"
import {
  type ConditionalOrder,
  type ConditionalOrderAction,
  evaluateConditionalOrders,
  validateConditionalOrder,
} from "./conditional-orders"
import type { MarketSnapshot } from "./market-data"

export interface CreateConditionalOrderInput {
  readonly code: string
  readonly name: string
  readonly condition: ConditionalOrder["condition"]
  readonly action: ConditionalOrderAction
  readonly expiresAt: string
  readonly triggerPolicy?: "once" | "repeat"
  readonly cooldownMinutes?: number
}

export class ConditionalOrderService {
  readonly #sink: AgentEventSink
  readonly #lotSize: number
  readonly #now: () => Date
  readonly #store: ConditionalOrderStore | undefined
  #orders: ConditionalOrder[] = []
  #sequence = 0
  constructor(options: {
    sink: AgentEventSink
    lotSize: number
    now?: () => Date
    store?: ConditionalOrderStore | undefined
  }) {
    this.#sink = options.sink
    this.#lotSize = options.lotSize
    this.#now = options.now ?? (() => new Date())
    this.#store = options.store
    const loaded = this.#store?.load().state
    this.#orders = [...(loaded?.orders ?? [])]
    this.#sequence = loaded?.sequence ?? 0
  }
  get orders(): readonly ConditionalOrder[] {
    return this.#orders
  }
  get activeCodes(): readonly string[] {
    return this.#orders.filter((order) => order.status === "enabled").map((order) => order.code)
  }
  create(input: CreateConditionalOrderInput): ConditionalOrder {
    const invalid = validateConditionalOrder(input.code, input.action, this.#lotSize)
    if (invalid !== null) throw new Error(invalid)
    const now = this.#now()
    if (!Number.isFinite(new Date(input.expiresAt).getTime()) || new Date(input.expiresAt) <= now)
      throw new Error("有效期必须晚于当前时间")
    const order: ConditionalOrder = {
      ...input,
      id: `condition-${++this.#sequence}`,
      createdAt: now.toISOString(),
      status: "enabled",
      triggerPolicy: input.triggerPolicy ?? "once",
      cooldownMinutes: input.cooldownMinutes ?? 15,
    }
    this.#orders = [...this.#orders, order]
    this.#save()
    return order
  }
  cancel(id: string): ConditionalOrder {
    return this.#set(id, "cancelled")
  }
  pause(id: string): ConditionalOrder {
    return this.#set(id, "paused")
  }
  resume(id: string): ConditionalOrder {
    return this.#set(id, "enabled")
  }
  handleSnapshot(snapshot: MarketSnapshot, marketOpen: boolean): void {
    const now = this.#now()
    const result = evaluateConditionalOrders(
      this.#orders,
      new Map(snapshot.quotes.map((quote) => [quote.code, quote])),
      now,
      marketOpen,
    )
    this.#orders = [...result.orders]
    this.#save()
    for (const trigger of result.triggers) {
      const order = this.#orders.find((candidate) => candidate.id === trigger.id)
      if (order !== undefined)
        this.#sink.enqueue({
          kind: "condition",
          dedupeKey: `${order.id}:${trigger.evidence}`,
          title: "条件单触发",
          createdAt: now.toISOString(),
          prompt: `[条件单触发 ${order.id}] ${order.code} 已满足条件。请检查行情、持仓和风险后决定预览、执行本地模拟交易或放弃；不得声称未调用工具的成交。`,
        })
    }
  }
  #set(id: string, status: ConditionalOrder["status"]): ConditionalOrder {
    const order = this.#orders.find((candidate) => candidate.id === id)
    if (order === undefined) throw new Error(`条件单不存在：${id}`)
    const next = { ...order, status }
    this.#orders = this.#orders.map((candidate) => (candidate.id === id ? next : candidate))
    this.#save()
    return next
  }

  #save(): void {
    this.#store?.save({ version: 1, sequence: this.#sequence, orders: this.#orders })
  }
}
