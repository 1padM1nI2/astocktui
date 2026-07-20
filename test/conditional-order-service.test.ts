import { expect, test } from "bun:test"
import { ConditionalOrderService } from "../src/conditional-order-service"

test("条件单触发行情事件但不直接成交", () => {
  const events: string[] = []
  const service = new ConditionalOrderService({
    sink: {
      enqueue: (event) => {
        events.push(event.kind)
        return "queued"
      },
    },
    lotSize: 100,
    now: () => new Date("2026-07-20T01:30:00.000Z"),
  })
  service.create({
    code: "SH600519",
    name: "茅台",
    action: { kind: "trade", side: "buy", quantity: 100 },
    condition: { type: "price", operator: "gte", price: 100 },
    expiresAt: "2026-07-21T07:00:00.000Z",
  })
  service.handleSnapshot(
    {
      quotes: [
        {
          code: "SH600519",
          name: "茅台",
          price: 101,
          changePercent: 1,
          source: "stock-api",
          asOf: 1,
        },
      ],
      trend: [],
      source: "stock-api",
    },
    true,
  )
  expect(events).toEqual(["condition"])
})
