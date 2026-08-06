import { describe, expect, test } from "bun:test"
import {
  nextScheduledRunAt,
  type ScheduledTaskSchedule,
  validateScheduledTaskInput,
} from "../src/scheduled-tasks"

const at = (value: string): Date => new Date(value)

function schedule(input: ScheduledTaskSchedule): {
  readonly name: string
  readonly prompt: string
  readonly schedule: ScheduledTaskSchedule
} {
  return { name: "每日复盘", prompt: "总结今日市场与持仓风险", schedule: input }
}

describe("定时任务规则", () => {
  test("校验名称、提示、一次性时间与间隔", () => {
    const now = at("2026-07-20T00:00:00.000Z")
    expect(validateScheduledTaskInput(schedule({ kind: "interval", minutes: 5 }), now).ok).toBe(
      true,
    )
    expect(
      validateScheduledTaskInput({ ...schedule({ kind: "interval", minutes: 0 }), name: "" }, now),
    ).toMatchObject({ ok: false })
    expect(
      validateScheduledTaskInput(schedule({ kind: "once", at: "2026-07-19T00:00:00.000Z" }), now),
    ).toMatchObject({ ok: false })
    expect(
      validateScheduledTaskInput(
        schedule({ kind: "daily", time: "25:00", weekdaysOnly: false }),
        now,
      ),
    ).toMatchObject({ ok: false })
  })

  test("任务模式缺省为 agent，非法模式被拒绝", () => {
    const now = at("2026-07-20T00:00:00.000Z")
    const defaulted = validateScheduledTaskInput(schedule({ kind: "interval", minutes: 5 }), now)
    expect(defaulted).toMatchObject({ ok: true, value: { mode: "agent" } })
    expect(
      validateScheduledTaskInput(
        { ...schedule({ kind: "interval", minutes: 5 }), mode: "research" },
        now,
      ),
    ).toMatchObject({ ok: true, value: { mode: "research" } })
    expect(
      validateScheduledTaskInput(
        { ...schedule({ kind: "interval", minutes: 5 }), mode: "banana" as never },
        now,
      ),
    ).toMatchObject({ ok: false })
  })

  test("计算一次性、每日和工作日每日任务的唯一下一次运行时间", () => {
    const now = at("2026-07-17T01:00:00.000Z") // 周五 09:00（上海）
    expect(nextScheduledRunAt({ kind: "once", at: "2026-07-17T02:00:00.000Z" }, now)).toBe(
      "2026-07-17T02:00:00.000Z",
    )
    expect(nextScheduledRunAt({ kind: "daily", time: "10:00", weekdaysOnly: false }, now)).toBe(
      "2026-07-17T02:00:00.000Z",
    )
    expect(nextScheduledRunAt({ kind: "daily", time: "08:45", weekdaysOnly: true }, now)).toBe(
      "2026-07-20T00:45:00.000Z",
    )
  })

  test("间隔任务从当前时刻开始计算，且不会生成补跑队列", () => {
    const now = at("2026-07-17T01:00:00.000Z")
    expect(nextScheduledRunAt({ kind: "interval", minutes: 15 }, now)).toBe(
      "2026-07-17T01:15:00.000Z",
    )
  })

  test("每日任务的下次运行时间取整到分钟，不继承当前秒数", () => {
    const now = at("2026-07-17T01:00:37.123Z") // 周五 09:00:37（上海）
    expect(nextScheduledRunAt({ kind: "daily", time: "09:50", weekdaysOnly: false }, now)).toBe(
      "2026-07-17T01:50:00.000Z",
    )
    expect(nextScheduledRunAt({ kind: "daily", time: "09:00", weekdaysOnly: false }, now)).toBe(
      "2026-07-18T01:00:00.000Z",
    )
  })
})
