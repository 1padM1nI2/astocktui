export const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  reverse: "\x1b[7m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  brightBlack: "\x1b[90m",
  brightRed: "\x1b[91m",
  brightWhite: "\x1b[97m",
} as const

export type AnsiCode = keyof typeof ANSI

/** 整行反色高亮；行内嵌套的 reset 之后自动恢复反色，避免高亮被截断 */
export function highlightReverse(line: string): string {
  const resume = `${ANSI.reset}${ANSI.cyan}${ANSI.reverse}`
  return `${ANSI.cyan}${ANSI.reverse}${line.replaceAll(ANSI.reset, resume)}${ANSI.reset}`
}
