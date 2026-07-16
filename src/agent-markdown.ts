import { Markdown, type MarkdownTheme, type SymbolTheme } from "@oh-my-pi/pi-tui"
import { ANSI } from "./colors"
import { fitLine } from "./width"

const SHARP_BOX = {
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
  vertical: "│",
  teeDown: "┬",
  teeUp: "┴",
  teeLeft: "┤",
  teeRight: "├",
  cross: "┼",
} as const

const SYMBOLS: SymbolTheme = {
  cursor: "◆",
  inputCursor: ">_",
  boxRound: {
    topLeft: "╭",
    topRight: "╮",
    bottomLeft: "╰",
    bottomRight: "╯",
    horizontal: "─",
    vertical: "│",
  },
  boxSharp: SHARP_BOX,
  table: SHARP_BOX,
  quoteBorder: "│",
  hrChar: "─",
  spinnerFrames: ["-", "\\", "|", "/"],
}

function style(open: string): (text: string) => string {
  return (text) => `${open}${text}${ANSI.reset}`
}

const THEME: MarkdownTheme = {
  heading: style(ANSI.cyan),
  link: style(`\x1b[4m${ANSI.cyan}`),
  linkUrl: style(ANSI.brightBlack),
  code: style(ANSI.yellow),
  codeBlock: style(ANSI.brightWhite),
  codeBlockBorder: style(ANSI.brightBlack),
  quote: style(ANSI.brightWhite),
  quoteBorder: style(ANSI.cyan),
  hr: style(ANSI.brightBlack),
  listBullet: (text) => `${ANSI.cyan}${text.replace(/^[-*+](?=\s)/u, "•")}${ANSI.reset}`,
  bold: style(ANSI.bold),
  italic: style("\x1b[3m"),
  strikethrough: style("\x1b[9m"),
  underline: style("\x1b[4m"),
  symbols: SYMBOLS,
}

export function renderAgentMarkdown(
  source: string,
  width: number,
  streaming: boolean,
): readonly string[] {
  const safeWidth = Math.max(1, width | 0)
  const markdown = new Markdown(normalizeAgentMarkdown(source), 0, 0, THEME, undefined, 2)
  markdown.setIgnoreTight(true)
  markdown.transientRenderCache = streaming
  return markdown.render(safeWidth).map((line) => fitLine(line, safeWidth))
}

function normalizeAgentMarkdown(source: string): string {
  return source.replace(/^#{3,6}(?=\s)/gmu, "##")
}
