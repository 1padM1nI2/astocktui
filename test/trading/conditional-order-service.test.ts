import { expect, test } from "bun:test"
import { ConditionalOrderService } from "../../src/trading/conditional-order-service"

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

test("放量条件缺少基准时后台拉取均量，到位后触发", async () => {
  const events: string[] = []
  const service = new ConditionalOrderService({
    sink: {
      enqueue: (event) => {
        events.push(event.kind)
        return "queued"
      },
    },
    lotSize: 100,
    now: () => new Date("2026-07-20T02:30:00.000Z"), // 10:30 已交易 60 分钟
    volumeBaseline: async (code) => (code === "SH600519" ? 40_000 : null),
  })
  service.create({
    code: "SH600519",
    name: "茅台",
    action: { kind: "analyze" },
    condition: { type: "volume-ratio", operator: "gte", ratio: 2 },
  })
  const snapshot = {
    quotes: [
      {
        code: "SH600519",
        name: "茅台",
        price: 100,
        changePercent: 0,
        source: "stock-api",
        asOf: 1,
        volume: 30_000,
      },
    ],
    trend: [],
    source: "stock-api",
  }
  service.handleSnapshot(snapshot, true)
  expect(events).toEqual([]) // 基准未就位，首次不触发

  await service.whenIdle()
  expect(service.orders[0]).toMatchObject({ avgVolume: 40_000, avgVolumeDate: "2026-07-20" })

  const firstQuote = snapshot.quotes[0]
  if (firstQuote === undefined) throw new Error("缺少测试行情")
  service.handleSnapshot({ ...snapshot, quotes: [{ ...firstQuote, asOf: 2 }] }, true)
  expect(events).toEqual(["condition"])
})
