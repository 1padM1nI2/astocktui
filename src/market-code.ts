export type StockMarket = "CN" | "US" | "JP" | "KR"

export interface ParsedMarketCode {
  readonly market: StockMarket
  readonly code: string
  readonly providerSymbol: string
}

export function normalizeMarketCode(input: string): string | null {
  const code = input.trim().toUpperCase()
  if (/^(?:SH|SZ)\d{6}$/u.test(code)) return code
  if (/^\d{6}$/u.test(code)) return /^[569]/u.test(code) ? `SH${code}` : `SZ${code}`
  if (/^US:[A-Z0-9.-]{1,10}$/u.test(code)) return code
  if (/^JP:\d{4}$/u.test(code)) return code
  if (/^KR:\d{6}$/u.test(code)) return code
  return null
}

export function parseMarketCode(code: string): ParsedMarketCode | null {
  if (normalizeMarketCode(code) !== code) return null
  if (/^(?:SH|SZ)\d{6}$/u.test(code)) return { market: "CN", code, providerSymbol: code }
  if (code.startsWith("US:")) return { market: "US", code, providerSymbol: code.slice(3) }
  if (code.startsWith("JP:")) return { market: "JP", code, providerSymbol: `${code.slice(3)}.T` }
  if (code.startsWith("KR:")) return { market: "KR", code, providerSymbol: `${code.slice(3)}.KS` }
  return null
}

export function isAshareCode(code: string): boolean {
  return parseMarketCode(code)?.market === "CN"
}
