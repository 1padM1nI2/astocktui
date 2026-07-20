import type { Component } from "@oh-my-pi/pi-tui"
import { visibleWidth } from "@oh-my-pi/pi-tui"
import { ANSI } from "./colors"
import { renderFramedPanel } from "./components/framed-panel"
import { fitLine } from "./width"
import { ListScrollState } from "./workspace-scroll"

function scrollStateOf(component: Component): ListScrollState | undefined {
  const candidate = (component as { readonly scroll?: unknown }).scroll
  return candidate instanceof ListScrollState ? candidate : undefined
}

export function zipColumns(
  columns: readonly { readonly lines: readonly string[]; readonly width: number }[],
  totalWidth: number,
  separator: string,
  height?: number,
): string[] {
  const result: string[] = []
  let contentRows = 0
  for (const column of columns) contentRows = Math.max(contentRows, column.lines.length)
  const rowCount = height === undefined ? contentRows : Math.max(0, height | 0)

  for (let row = 0; row < rowCount; row++) {
    let composed = ""
    for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
      const column = columns[columnIndex]
      if (column === undefined) continue
      const content = column.lines[row] ?? ""
      const padding = Math.max(0, column.width - visibleWidth(content))
      composed += `${content}${" ".repeat(padding)}${ANSI.reset}`
      if (columnIndex < columns.length - 1) composed += separator
    }
    result.push(fitLine(composed, totalWidth))
  }
  return result
}

export function renderWorkspacePanel(
  component: Component,
  width: number,
  height: number,
  active: boolean,
): readonly string[] {
  const rendered = component.render(Math.max(0, width - 4))
  const focusMarker = active ? "◆ " : ""
  const body = rendered.slice(2)
  const scroll = scrollStateOf(component)
  if (scroll === undefined) {
    return renderFramedPanel(
      `${focusMarker}${rendered[0] ?? "工作区"}`,
      body,
      width,
      height,
      active ? "accent" : "muted",
    )
  }
  scroll.recordRender(body.length, Math.max(1, height - 2))
  return renderFramedPanel(
    `${focusMarker}${rendered[0] ?? "工作区"}`,
    body.slice(scroll.offset),
    width,
    height,
    active ? "accent" : "muted",
  )
}
