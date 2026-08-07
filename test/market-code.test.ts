import { expect, test } from "bun:test"
import { isAshareCode, normalizeMarketCode, parseMarketCode } from "../src/market/market-code"

test("规范化 A 股、美股、日本和韩国股票代码并映射腾讯 ticker", () => {
  expect(normalizeMarketCode("600519")).toBe("SH600519")
  expect(normalizeMarketCode("sz000001")).toBe("SZ000001")
  expect(normalizeMarketCode("us:aapl")).toBe("US:AAPL")
  expect(normalizeMarketCode("JP:7203")).toBe("JP:7203")
  expect(normalizeMarketCode("kr:005930")).toBe("KR:005930")

  expect(parseMarketCode("US:BRK.B")).toMatchObject({ market: "US", providerSymbol: "usBRK.B" })
  expect(parseMarketCode("JP:7203")).toMatchObject({ market: "JP", providerSymbol: "jp7203" })
  expect(parseMarketCode("KR:005930")).toMatchObject({ market: "KR", providerSymbol: "kr005930" })
  expect(isAshareCode("SH600519")).toBe(true)
  expect(isAshareCode("US:AAPL")).toBe(false)
})

test("接受全球主力指数代码并映射腾讯 ticker", () => {
  expect(normalizeMarketCode("us:^ixic")).toBe("US:^IXIC")
  expect(normalizeMarketCode("US:^GSPC")).toBe("US:^GSPC")
  expect(parseMarketCode("US:^IXIC")).toMatchObject({ market: "US", providerSymbol: "usIXIC" })
  expect(parseMarketCode("US:^GSPC")).toMatchObject({ market: "US", providerSymbol: "usINX" })
  expect(parseMarketCode("US:^N225")).toMatchObject({ market: "US", providerSymbol: "usN225" })
  expect(parseMarketCode("US:^KS11")).toMatchObject({ market: "US", providerSymbol: "usKS11" })
})

test("拒绝歧义、格式错误和不支持市场的全球代码", () => {
  for (const code of [
    "7203",
    "US:",
    "US:TOO-LONG-SYMBOL",
    "JP:720",
    "JP:12345",
    "KR:1234",
    "HK:0700",
  ]) {
    expect(normalizeMarketCode(code)).toBeNull()
  }
  expect(parseMarketCode("KR:005930 ")).toBeNull()
})
