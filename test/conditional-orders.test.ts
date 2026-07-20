import { expect, test } from "bun:test"
import { evaluateConditionalOrders, validateConditionalOrder } from "../src/conditional-orders"

test("价格条件触发一次且不会重复", () => {
  const now = new Date("2026-07-20T01:30:00.000Z")
  const order = {
    id: "c1",
    code: "SH600519",
    name: "茅台",
    condition: { type: "price" as const, operator: "gte" as const, price: 100 },
    action: { kind: "trade" as const, side: "buy" as const, quantity: 100 },
    createdAt: now.toISOString(),
    expiresAt: "2026-07-21T07:00:00.000Z",
    status: "enabled" as const,
    triggerPolicy: "once" as const,
    cooldownMinutes: 15,
  }
  const result = evaluateConditionalOrders(
    [order],
    new Map([
      [
        "SH600519",
        {
          code: "SH600519",
          name: "茅台",
          price: 101,
          changePercent: 1,
          source: "stock-api",
          asOf: 1,
        },
      ],
    ]),
    now,
    true,
  )
  expect(result.triggers).toHaveLength(1)
  expect(result.orders[0]?.status).toBe("triggered")
})

test("海外交易条件和非整手数量被拒绝", () => {
  expect(
    validateConditionalOrder("US:AAPL", { kind: "trade", side: "buy", quantity: 100 }, 100),
  ).toContain("海外")
  expect(
    validateConditionalOrder("SH600519", { kind: "trade", side: "buy", quantity: 10 }, 100),
  ).toContain("整数倍")
})
