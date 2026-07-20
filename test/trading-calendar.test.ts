import { describe, expect, test } from "bun:test"
import {
  isAshareWeekday,
  isContinuousAuction,
  parseShanghaiTimeMinutes,
  shanghaiDateTime,
} from "../src/trading-calendar"

const at = (value: string): Date => new Date(value)

describe("A 股交易时段", () => {
  test("按 Asia/Shanghai 解析交易日和分钟", () => {
    expect(shanghaiDateTime(at("2026-07-20T01:30:00.000Z"))).toMatchObject({
      date: "2026-07-20",
      weekday: 1,
      minutes: 570,
    })
    expect(isAshareWeekday(at("2026-07-18T01:30:00.000Z"))).toBe(false)
  })

  test("只在连续竞价时段内返回 true", () => {
    expect(isContinuousAuction(at("2026-07-20T01:29:00.000Z"))).toBe(false)
    expect(isContinuousAuction(at("2026-07-20T01:30:00.000Z"))).toBe(true)
    expect(isContinuousAuction(at("2026-07-20T03:29:00.000Z"))).toBe(true)
    expect(isContinuousAuction(at("2026-07-20T03:30:00.000Z"))).toBe(false)
    expect(isContinuousAuction(at("2026-07-20T04:59:00.000Z"))).toBe(false)
    expect(isContinuousAuction(at("2026-07-20T05:00:00.000Z"))).toBe(true)
    expect(isContinuousAuction(at("2026-07-20T06:59:00.000Z"))).toBe(true)
    expect(isContinuousAuction(at("2026-07-20T07:00:00.000Z"))).toBe(false)
  })

  test("验证 HH:mm", () => {
    expect(parseShanghaiTimeMinutes("08:45")).toBe(525)
    expect(parseShanghaiTimeMinutes("24:00")).toBeNull()
    expect(parseShanghaiTimeMinutes("8:45")).toBeNull()
  })
})
