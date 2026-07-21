import type { AppCommand, CommandResult } from "./commands"

const output = (title: string, lines: readonly string[]): CommandResult => ({
  kind: "output",
  title,
  lines,
})
const unavailable = (): CommandResult => output("自动化", ["自动化服务尚未就绪"])

export const AUTOMATION_COMMANDS: readonly AppCommand[] = [
  {
    name: "condition",
    aliases: [],
    category: "portfolio",
    usage:
      "/condition price <code> <buy|sell> <quantity> <above|below> <price> | list | cancel <id>",
    description: "查看或管理模拟盘条件单",
    execute: (context, args) => {
      const service = context.conditionalOrders?.()
      if (service === undefined) return unavailable()
      const action = args[0] ?? "list"
      const id = args[1]
      if (action === "price") {
        const [code, side, quantityText, direction, priceText] = args.slice(1)
        const quantity = Number(quantityText)
        const price = Number(priceText)
        if (
          code === undefined ||
          (side !== "buy" && side !== "sell") ||
          (direction !== "above" && direction !== "below") ||
          !Number.isFinite(quantity) ||
          !Number.isFinite(price)
        )
          return output("命令错误", [
            "用法 /condition price <code> <buy|sell> <quantity> <above|below> <price>",
          ])
        const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString()
        const order = service.create({
          code,
          name: code,
          action: { kind: "trade", side, quantity },
          condition: { type: "price", operator: direction === "above" ? "gte" : "lte", price },
          expiresAt,
        })
        return output("创建条件单", [
          `${order.id} ${order.code} ${direction === "above" ? "高于" : "低于"} ${price}`,
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
