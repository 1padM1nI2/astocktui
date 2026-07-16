import { truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui"

export function fitLine(text: string, width: number): string {
  return truncateToWidth(text, Math.max(0, width | 0))
}

export type CellAlignment = "left" | "right"

export function alignCell(text: string, width: number, alignment: CellAlignment): string {
  const safeWidth = Math.max(0, width | 0)
  const fitted = fitLine(text, safeWidth)
  const padding = " ".repeat(Math.max(0, safeWidth - visibleWidth(fitted)))
  return alignment === "right" ? `${padding}${fitted}` : `${fitted}${padding}`
}
