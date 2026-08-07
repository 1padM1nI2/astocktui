import { expect, test } from "bun:test"
import {
  evaluateConditionalOrders,
  validateConditionalOrder,
} from "../src/trading/conditional-orders"

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

test("反弹条件跟踪日内低点，反弹到位才触发", () => {
  const now = new Date("2026-07-20T01:30:00.000Z")
  const makeOrder = () => ({
    id: "c1",
    code: "SH600519",
    name: "茅台",
    condition: { type: "rebound" as const, percent: 2 },
    action: { kind: "analyze" as const },
    createdAt: now.toISOString(),
    expiresAt: "2026-07-21T07:00:00.000Z",
    status: "enabled" as const,
    triggerPolicy: "once" as const,
    cooldownMinutes: 15,
  })
  const quote = (price: number, asOf: number) => ({
    code: "SH600519",
    name: "茅台",
    price,
    changePercent: 0,
    source: "stock-api",
    asOf,
  })

  const first = evaluateConditionalOrders(
    [makeOrder()],
    new Map([["SH600519", quote(100, 1)]]),
    now,
    true,
  )
  expect(first.triggers).toHaveLength(0)
  expect(first.orders[0]?.extremePrice).toBe(100)

  const second = evaluateConditionalOrders(
    first.orders,
    new Map([["SH600519", quote(98, 2)]]),
    now,
    true,
  )
  expect(second.triggers).toHaveLength(0)
  expect(second.orders[0]?.extremePrice).toBe(98)

  const third = evaluateConditionalOrders(
    second.orders,
    new Map([["SH600519", quote(100.5, 3)]]),
    now,
    true,
  )
  expect(third.triggers).toHaveLength(1)
  expect(third.orders[0]?.status).toBe("triggered")
  expect(third.orders[0]?.extremePrice).toBe(98)
})

test("回落条件跟踪日内高点", () => {
  const now = new Date("2026-07-20T01:30:00.000Z")
  const makeOrder = () => ({
    id: "c2",
    code: "SH600519",
    name: "茅台",
    condition: { type: "drawdown" as const, percent: 3 },
    action: { kind: "analyze" as const },
    createdAt: now.toISOString(),
    expiresAt: "2026-07-21T07:00:00.000Z",
    status: "enabled" as const,
    triggerPolicy: "once" as const,
    cooldownMinutes: 15,
  })
  const quote = (price: number, asOf: number) => ({
    code: "SH600519",
    name: "茅台",
    price,
    changePercent: 0,
    source: "stock-api",
    asOf,
  })

  const first = evaluateConditionalOrders(
    [makeOrder()],
    new Map([["SH600519", quote(100, 1)]]),
    now,
    true,
  )
  expect(first.orders[0]?.extremePrice).toBe(100)
  const second = evaluateConditionalOrders(
    first.orders,
    new Map([["SH600519", quote(104, 2)]]),
    now,
    true,
  )
  expect(second.triggers).toHaveLength(0)
  expect(second.orders[0]?.extremePrice).toBe(104)
  const third = evaluateConditionalOrders(
    second.orders,
    new Map([["SH600519", quote(100.8, 3)]]),
    now,
    true,
  )
  expect(third.triggers).toHaveLength(1)
})

test("放量条件按竞价时长折算均量，基准过期或缺量不触发", () => {
  const now = new Date("2026-07-20T02:30:00.000Z") // 10:30 已交易 60 分钟
  const makeOrder = (avgVolumeDate: string) => ({
    id: "c3",
    code: "SH600519",
    name: "茅台",
    condition: { type: "volume-ratio" as const, operator: "gte" as const, ratio: 2 },
    action: { kind: "analyze" as const },
    createdAt: now.toISOString(),
    expiresAt: "2026-07-21T07:00:00.000Z",
    status: "enabled" as const,
    triggerPolicy: "once" as const,
    cooldownMinutes: 15,
    avgVolume: 40_000,
    avgVolumeDate,
  })
  const quote = (volume: number | undefined, asOf: number) => ({
    code: "SH600519",
    name: "茅台",
    price: 100,
    changePercent: 0,
    source: "stock-api",
    asOf,
    ...(volume === undefined ? {} : { volume }),
  })

  // 预期量 = 40000 × 60/240 = 10000；实际 30000 → 量比 3 ≥ 2，触发
  const triggered = evaluateConditionalOrders(
    [makeOrder("2026-07-20")],
    new Map([["SH600519", quote(30_000, 1)]]),
    now,
    true,
  )
  expect(triggered.triggers).toHaveLength(1)

  // 实际 15000 → 量比 1.5 < 2，不触发
  const quiet = evaluateConditionalOrders(
    [makeOrder("2026-07-20")],
    new Map([["SH600519", quote(15_000, 1)]]),
    now,
    true,
  )
  expect(quiet.triggers).toHaveLength(0)

  // 基准日期不是今天，不触发
  const stale = evaluateConditionalOrders(
    [makeOrder("2026-07-19")],
    new Map([["SH600519", quote(30_000, 1)]]),
    now,
    true,
  )
  expect(stale.triggers).toHaveLength(0)

  // 行情缺少成交量，不触发
  const missing = evaluateConditionalOrders(
    [makeOrder("2026-07-20")],
    new Map([["SH600519", quote(undefined, 1)]]),
    now,
    true,
  )
  expect(missing.triggers).toHaveLength(0)
})
