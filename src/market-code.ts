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
  if (/^US:[A-Z0-9.^.-]{1,10}$/u.test(code)) return code
  if (/^JP:\d{4}$/u.test(code)) return code
  if (/^KR:\d{6}$/u.test(code)) return code
  return null
}

export function parseMarketCode(code: string): ParsedMarketCode | null {
  if (normalizeMarketCode(code) !== code) return null
  if (/^(?:SH|SZ)\d{6}$/u.test(code)) return { market: "CN", code, providerSymbol: code }
  if (code.startsWith("US:")) return { market: "US", code, providerSymbol: usSymbol(code.slice(3)) }
  if (code.startsWith("JP:")) return { market: "JP", code, providerSymbol: `jp${code.slice(3)}` }
  if (code.startsWith("KR:")) return { market: "KR", code, providerSymbol: `kr${code.slice(3)}` }
  return null
}

const US_INDEX_ALIAS: Readonly<Record<string, string>> = { GSPC: "INX" }

function usSymbol(symbol: string): string {
  const bare = symbol.startsWith("^") ? symbol.slice(1) : symbol
  return `us${US_INDEX_ALIAS[bare] ?? bare}`
}

export function isAshareCode(code: string): boolean {
  return parseMarketCode(code)?.market === "CN"
}
