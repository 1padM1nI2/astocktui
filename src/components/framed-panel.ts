import type { BoxBorder, Component } from "@oh-my-pi/pi-tui"
import { Box, visibleWidth } from "@oh-my-pi/pi-tui"
import { ANSI } from "../colors"
import { fitLine } from "../width"

export type PanelTone = "muted" | "accent"

const MUTED_BORDER: BoxBorder = {
  chars: {
    topLeft: "╭",
    topRight: "╮",
    bottomLeft: "╰",
    bottomRight: "╯",
    horizontal: "─",
    vertical: "│",
  },
  color: (text) => `${ANSI.brightBlack}${text}${ANSI.reset}`,
}

const ACCENT_BORDER: BoxBorder = {
  ...MUTED_BORDER,
  color: (text) => `${ANSI.cyan}${text}${ANSI.reset}`,
}

class PanelLines implements Component {
  readonly #lines: readonly string[]

  constructor(lines: readonly string[]) {
    this.#lines = lines
  }

  render(width: number): readonly string[] {
    return this.#lines.map((line) => fitLine(line, width))
  }
}

function titleBorder(title: string, width: number, tone: PanelTone): string {
  const paint = tone === "accent" ? ACCENT_BORDER.color : MUTED_BORDER.color
  const titleWidth = Math.max(0, width - 5)
  const fittedTitle = fitLine(title, titleWidth)
  const fillWidth = Math.max(0, width - 5 - visibleWidth(fittedTitle))
  return `${paint?.("╭─")} ${fittedTitle} ${paint?.(`${"─".repeat(fillWidth)}╮`)}`
}

export function renderFramedPanel(
  title: string,
  content: readonly string[],
  width: number,
  height: number,
  tone: PanelTone = "muted",
): readonly string[] {
  const safeWidth = Math.max(0, width | 0)
  const safeHeight = Math.max(0, height | 0)
  if (safeHeight === 0) return []
  if (safeHeight < 3 || safeWidth < 5) {
    return Array.from({ length: safeHeight }, (_, index) =>
      fitLine(index === 0 ? title : (content[index - 1] ?? ""), safeWidth),
    )
  }

  const contentHeight = safeHeight - 2
  const lines = Array.from({ length: contentHeight }, (_, index) => content[index] ?? "")
  const box = new Box(1, 0, undefined, tone === "accent" ? ACCENT_BORDER : MUTED_BORDER)
  box.setIgnoreTight(true)
  box.addChild(new PanelLines(lines))
  const framed = [...box.render(safeWidth)]
  framed[0] = titleBorder(title, safeWidth, tone)
  return framed
}
