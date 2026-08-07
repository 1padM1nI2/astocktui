import type {
  ConditionalOrderAction,
  ConditionalOrderCondition,
} from "../trading/conditional-orders"
import type { AppCommand, CommandResult } from "./commands"

const output = (title: string, lines: readonly string[]): CommandResult => ({
  kind: "output",
  title,
  lines,
})
const unavailable = (): CommandResult => output("自动化", ["自动化服务尚未就绪"])
const CONDITION_USAGE =
  "/condition <price|percent> <code> <<buy|sell> <quantity>|analyze> <above|below> <数值> | list | pause <id> | resume <id> | cancel <id>"

export const AUTOMATION_COMMANDS: readonly AppCommand[] = [
  {
    name: "condition",
    aliases: [],
    category: "portfolio",
    usage: CONDITION_USAGE,
    description: "查看或管理模拟盘条件单",
    execute: (context, args) => {
      const service = context.conditionalOrders?.()
      if (service === undefined) return unavailable()
      const action = args[0] ?? "list"
      const id = args[1]
      if (action === "price" || action === "percent") {
        const [code, mode, ...rest] = args.slice(1)
        let orderAction: ConditionalOrderAction
        let direction: string | undefined
        let valueText: string | undefined
        if (mode === "analyze") {
          ;[direction, valueText] = rest
          orderAction = { kind: "analyze" }
        } else if (mode === "buy" || mode === "sell") {
          const [quantityText, dir, value] = rest
          const quantity = Number(quantityText)
          direction = dir
          valueText = value
          if (!Number.isFinite(quantity) || quantity <= 0)
            return output("命令错误", [`数量无效，用法 ${CONDITION_USAGE}`])
          orderAction = { kind: "trade", side: mode, quantity }
        } else {
          return output("命令错误", [`用法 ${CONDITION_USAGE}`])
        }
        const value = Number(valueText)
        if (
          code === undefined ||
          (direction !== "above" && direction !== "below") ||
          !Number.isFinite(value) ||
          value <= 0
        )
          return output("命令错误", [`用法 ${CONDITION_USAGE}`])
        const operator = direction === "above" ? "gte" : "lte"
        let condition: ConditionalOrderCondition
        if (action === "price") {
          condition = { type: "price", operator, price: value }
        } else {
          const referencePrice = context
            .marketSnapshot?.()
            ?.quotes.find((quote) => quote.code === code)?.price
          if (referencePrice === undefined || referencePrice <= 0)
            return output("命令错误", ["无法取得参考价，请先刷新行情"])
          condition = { type: "change-percent", operator, percent: value, referencePrice }
        }
        const order = service.create({
          code,
          name: code,
          condition,
          action: orderAction,
          expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
        })
        return output("创建条件单", [
          `${order.id} ${order.code} ${direction === "above" ? "高于" : "低于"} ${value}`,
        ])
      }
      if (action === "cancel" && id !== undefined) service.cancel(id)
      else if (action === "pause" && id !== undefined) service.pause(id)
      else if (action === "resume" && id !== undefined) service.resume(id)
      else if (action !== "list")
        return output("命令错误", ["用法 /condition list|cancel|pause|resume <id>"])
      const orders = service.orders
      return output(
        "模拟盘条件单",
        orders.length === 0
          ? ["暂无条件单"]
          : orders.map(
              (order) => `${order.id} ${order.code} ${order.status} ${order.condition.type}`,
            ),
      )
    },
  },
]
