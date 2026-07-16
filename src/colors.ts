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
