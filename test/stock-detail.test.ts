import { expect, test } from "bun:test"
import { parseTencentDetail } from "../src/market/stock-detail"

const PAYLOAD_519 =
  "1~贵州茅台~600519~1297.41~1292.01~1305.00~35699~17225~18474~" +
  "1296.00~1~1295.60~1~1295.43~2~1295.20~3~1295.18~3~" +
  "1297.41~21~1297.57~1~1297.64~5~1297.65~1~1297.67~1~~" +
  "20260724161433~5.40~0.42~1309.21~1286.20~1297.41/35699/4622242878~35699~462224~0.29~19.61~" +
  "~1309.21~1286.20~1.78~16218.68~16218.68~6.96~1421.21~1162.81~0.52~-19~1294.79"

test("解析腾讯详情字段", () => {
  const detail = parseTencentDetail("SH600519", PAYLOAD_519)
  expect(detail).toEqual({
    code: "SH600519",
    name: "贵州茅台",
    open: 1305,
    volume: 35_699,
    turnover: 462_224,
    turnoverRate: 0.29,
    peTtm: 19.61,
    amplitude: 1.78,
    circMarketCap: 16_218.68,
    totalMarketCap: 16_218.68,
    pb: 6.96,
    limitUp: 1421.21,
    limitDown: 1162.81,
    volumeRatio: 0.52,
    averagePrice: 1294.79,
    bids: [
      { price: 1296.0, volume: 1 },
      { price: 1295.6, volume: 1 },
      { price: 1295.43, volume: 2 },
      { price: 1295.2, volume: 3 },
      { price: 1295.18, volume: 3 },
    ],
    asks: [
      { price: 1297.41, volume: 21 },
      { price: 1297.57, volume: 1 },
      { price: 1297.64, volume: 5 },
      { price: 1297.65, volume: 1 },
      { price: 1297.67, volume: 1 },
    ],
  })
})

test("缺失或非法字段被忽略", () => {
  const detail = parseTencentDetail("SH600519", "1~名称~600519~10~9.9~10.1~100")
  expect(detail).toEqual({
    code: "SH600519",
    name: "名称",
    open: 10.1,
    volume: 100,
  })
  expect(parseTencentDetail("SH600519", "")).toEqual({ code: "SH600519" })
})

test("解析五档买卖盘与 52 周高低", () => {
  const detail = parseTencentDetail("SH600519", PAYLOAD_519)
  expect(detail.asks).toEqual([
    { price: 1297.41, volume: 21 },
    { price: 1297.57, volume: 1 },
    { price: 1297.64, volume: 5 },
    { price: 1297.65, volume: 1 },
    { price: 1297.67, volume: 1 },
  ])
  expect(detail.bids).toEqual([
    { price: 1296.0, volume: 1 },
    { price: 1295.6, volume: 1 },
    { price: 1295.43, volume: 2 },
    { price: 1295.2, volume: 3 },
    { price: 1295.18, volume: 3 },
  ])

  const extended = parseTencentDetail(
    "SH600519",
    `${PAYLOAD_519}~14.88~19.70${"~".repeat(14)}1539.98~1151.01`,
  )
  expect(extended.week52High).toBe(1539.98)
  expect(extended.week52Low).toBe(1151.01)
})
