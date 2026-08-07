import type { AgentTool, AgentToolResult } from "@oh-my-pi/pi-agent-core"
import { z } from "@oh-my-pi/pi-ai"
import type { CommandContext } from "../commands/commands"
import type { ConditionalOrderService } from "../trading/conditional-order-service"
import type {
  ConditionalOrderAction,
  ConditionalOrderCondition,
} from "../trading/conditional-orders"

const conditionSchema = z.object({
  type: z.enum(["price", "change-percent", "rebound", "drawdown", "volume-ratio", "time"]),
  operator: z.enum(["gte", "lte"]).optional(),
  price: z.number().positive().optional(),
  percent: z.number().positive().optional(),
  referencePrice: z.number().positive().optional(),
  ratio: z.number().positive().optional(),
  at: z.string().min(1).optional(),
})

const parameters = z.object({
  action: z.enum(["create", "list", "cancel", "pause", "resume"]),
  id: z.string().min(1).optional(),
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  condition: conditionSchema.optional(),
  side: z.enum(["buy", "sell"]).optional(),
  quantity: z.number().int().positive().optional(),
  expiresAt: z.string().min(1).optional(),
  triggerPolicy: z.enum(["once", "repeat"]).optional(),
  cooldownMinutes: z.number().int().positive().optional(),
})

type ConditionToolInput = {
  readonly action: "create" | "list" | "cancel" | "pause" | "resume"
  readonly id?: string
  readonly code?: string
  readonly name?: string
  readonly condition?: {
    readonly type: "price" | "change-percent" | "rebound" | "drawdown" | "volume-ratio" | "time"
    readonly operator?: "gte" | "lte"
    readonly price?: number
    readonly percent?: number
    readonly referencePrice?: number
    readonly ratio?: number
    readonly at?: string
  }
  readonly side?: "buy" | "sell"
  readonly quantity?: number
  readonly expiresAt?: string
  readonly triggerPolicy?: "once" | "repeat"
  readonly cooldownMinutes?: number
}

function result(value: unknown): AgentToolResult<unknown> {
  return { content: [{ type: "text", text: JSON.stringify(value) }], details: value }
}

function normalizeCondition(
  input: NonNullable<ConditionToolInput["condition"]>,
): ConditionalOrderCondition {
  if (input.type === "price") {
    if (input.operator === undefined || input.price === undefined)
      throw new Error("价格条件需要 operator（gte/lte）与 price")
    return { type: "price", operator: input.operator, price: input.price }
  }
  if (input.type === "change-percent") {
    if (input.operator === undefined || input.percent === undefined)
      throw new Error("涨跌幅条件需要 operator（gte/lte）与 percent")
    const referencePrice = input.referencePrice
    if (referencePrice === undefined) throw new Error("涨跌幅条件需要 referencePrice（参考价）")
    return {
      type: "change-percent",
      operator: input.operator,
      percent: input.percent,
      referencePrice,
    }
  }
  if (input.type === "rebound" || input.type === "drawdown") {
    if (input.percent === undefined) throw new Error("反弹/回落条件需要 percent")
    return { type: input.type, percent: input.percent }
  }
  if (input.type === "volume-ratio") {
    if (input.operator === undefined || input.ratio === undefined)
      throw new Error("量比条件需要 operator（gte/lte）与 ratio")
    return { type: "volume-ratio", operator: input.operator, ratio: input.ratio }
  }
  if (input.at === undefined) throw new Error("时间条件需要 at（ISO 时间）")
  return { type: "time", at: input.at }
}

function normalizeAction(input: ConditionToolInput): ConditionalOrderAction {
  if (input.side === undefined && input.quantity === undefined) return { kind: "analyze" }
  if (input.side === undefined || input.quantity === undefined)
    throw new Error("交易条件单需要同时提供 side 与 quantity；仅分析请两者都不提供")
  return { kind: "trade", side: input.side, quantity: input.quantity }
}

export function createConditionAgentTools(context: CommandContext): readonly AgentTool[] {
  const service = (): ConditionalOrderService => {
    const orders = context.conditionalOrders?.()
    if (orders === undefined) throw new Error("条件单服务尚未就绪")
    return orders
  }
  return [
    {
      name: "manage_condition_order",
      label: "管理模拟盘条件单",
      description:
        "创建、查看、暂停、恢复或取消本地模拟盘条件单。条件类型：price（价格 gte/lte 阈值）、change-percent（相对 referencePrice 涨跌幅 gte/lte percent%）、rebound（从观察期低点反弹 percent%）、drawdown（从观察期高点回落 percent%）、volume-ratio（量比 gte/lte ratio，按当日竞价时长折算近 5 日均量）、time（到点 at）。提供 side 与 quantity 为交易单，否则为仅分析提醒。条件触发后由 Agent 决定是否交易。",
      parameters,
      intent: "omit",
      approval: "write",
      execute: async (_id, params) => {
        const orders = service()
        const input = params as ConditionToolInput
        if (input.action === "create") {
          if (input.code === undefined) throw new Error("创建条件单需要 code")
          if (input.condition === undefined) throw new Error("创建条件单需要 condition")
          return result(
            orders.create({
              code: input.code,
              name: input.name ?? input.code,
              condition: normalizeCondition(input.condition),
              action: normalizeAction(input),
              ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
              ...(input.triggerPolicy === undefined ? {} : { triggerPolicy: input.triggerPolicy }),
              ...(input.cooldownMinutes === undefined
                ? {}
                : { cooldownMinutes: input.cooldownMinutes }),
            }),
          )
        }
        if (input.action === "cancel") orders.cancel(input.id ?? "")
        if (input.action === "pause") orders.pause(input.id ?? "")
        if (input.action === "resume") orders.resume(input.id ?? "")
        return result(orders.orders)
      },
    },
  ]
}
