const SHANGHAI_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

const WEEKDAYS: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

export interface ShanghaiDateTime {
  readonly date: string
  readonly weekday: number
  readonly minutes: number
}

export function shanghaiDateTime(now: Date): ShanghaiDateTime {
  const values: Record<string, string> = {}
  for (const part of SHANGHAI_PARTS.formatToParts(now)) {
    if (part.type !== "literal") values[part.type] = part.value
  }
  const weekday = WEEKDAYS[values["weekday"] ?? ""] ?? 0
  const hour = Number(values["hour"])
  const minute = Number(values["minute"])
  return {
    date: `${values["year"]}-${values["month"]}-${values["day"]}`,
    weekday,
    minutes: hour * 60 + minute,
  }
}

export function isAshareWeekday(now: Date): boolean {
  const weekday = shanghaiDateTime(now).weekday
  return weekday >= 1 && weekday <= 5
}

export function isContinuousAuction(now: Date): boolean {
  const { weekday, minutes } = shanghaiDateTime(now)
  if (weekday < 1 || weekday > 5) return false
  return (minutes >= 570 && minutes < 690) || (minutes >= 780 && minutes < 900)
}

export function continuousAuctionElapsedMinutes(now: Date): number {
  const { minutes } = shanghaiDateTime(now)
  const morning = Math.min(Math.max(minutes - 570, 0), 120)
  const afternoon = Math.min(Math.max(minutes - 780, 0), 120)
  return morning + afternoon
}

export function parseShanghaiTimeMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (match === null) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}
