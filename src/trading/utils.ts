const DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function tradingDate(date: Date): string {
  const parts = DATE_FORMATTER.formatToParts(date)
  let year = ""
  let month = ""
  let day = ""
  for (const part of parts) {
    if (part.type === "year") year = part.value
    else if (part.type === "month") month = part.value
    else if (part.type === "day") day = part.value
  }
  return `${year}-${month}-${day}`
}
