import { describe, expect, test } from "bun:test"
import {
  fetchHotRank,
  type HotRankHttp,
  type HotRankRequest,
  parseHotRankList,
  parseQuoteBatch,
} from "../src/eastmoney-hot-rank"

const RANK_PAYLOAD = {
  status: 0,
  data: [
    { sc: "SZ001309", rk: 2, rc: 1, hisRc: 3 },
    { sc: "SH688825", rk: 1, rc: 0, hisRc: 0 },
    { sc: "SZ300308", rk: 4, rc: -2, hisRc: 2 },
    { sc: "SH603986", rk: 3 },
  ],
}

const QUOTE_PAYLOAD = {
  rc: 0,
  data: {
    total: 4,
    diff: [
      { f2: 52.87, f3: -0.15, f12: "688825", f14: "C长鑫" },
      { f2: 390.04, f3: 10.0, f12: "001309", f14: "德明利" },
      { f2: "-", f3: "-", f12: "300308", f14: "中际旭创" },
      { f2: 371.1, f3: 1.94, f12: "603986", f14: "兆易创新" },
    ],
  },
}

interface RecordedRequest {
  readonly request: HotRankRequest
}

function httpWith(
  routes: Readonly<Record<string, unknown>>,
  recorded: RecordedRequest[] = [],
): { http: HotRankHttp; recorded: RecordedRequest[] } {
  const http: HotRankHttp = async (request) => {
    recorded.push({ request })
    for (const [needle, payload] of Object.entries(routes)) {
      if (request.url.includes(needle)) {
        if (payload instanceof Error) return { ok: false, status: 503, body: "" }
        return { ok: true, status: 200, body: JSON.stringify(payload) }
      }
    }
    return { ok: false, status: 404, body: "" }
  }
  return { http, recorded }
}

describe("人气榜解析", () => {
  test("映射字段并按排名升序", () => {
    expect(parseHotRankList(RANK_PAYLOAD)).toEqual([
      { code: "SH688825", rank: 1, rankChange: 0 },
      { code: "SZ001309", rank: 2, rankChange: 1 },
      { code: "SH603986", rank: 3, rankChange: 0 },
      { code: "SZ300308", rank: 4, rankChange: -2 },
    ])
  })

  test("畸形条目丢弃", () => {
    expect(
      parseHotRankList({
        data: [
          { sc: "SH688825", rk: 1, rc: 0 },
          { sc: 688825, rk: 2, rc: 0 },
          { sc: "BJ920001", rk: 3, rc: 0 },
          { sc: "SZ001309", rk: "2", rc: 0 },
          "oops",
          null,
        ],
      }),
    ).toEqual([{ code: "SH688825", rank: 1, rankChange: 0 }])
  })

  test("data 非数组返回空", () => {
    expect(parseHotRankList(undefined)).toEqual([])
    expect(parseHotRankList({})).toEqual([])
    expect(parseHotRankList({ data: "oops" })).toEqual([])
    expect(parseHotRankList({ data: null })).toEqual([])
  })
})

describe("批量行情解析", () => {
  test("按六位代码建映射，缺报价为 null", () => {
    const quotes = parseQuoteBatch(QUOTE_PAYLOAD)
    expect(quotes.get("688825")).toEqual({ name: "C长鑫", price: 52.87, changePercent: -0.15 })
    expect(quotes.get("300308")).toEqual({ name: "中际旭创", price: null, changePercent: null })
    expect(quotes.get("000001")).toBeUndefined()
  })

  test("名称含终端控制符的条目丢弃", () => {
    const quotes = parseQuoteBatch({
      data: { diff: [{ f2: 1, f3: 1, f12: "688825", f14: "坏名字[2J" }] },
    })
    expect(quotes.get("688825")).toBeUndefined()
  })

  test("畸形返回为空映射", () => {
    expect(parseQuoteBatch(undefined).size).toBe(0)
    expect(parseQuoteBatch({}).size).toBe(0)
    expect(parseQuoteBatch({ data: { diff: "oops" } }).size).toBe(0)
    expect(parseQuoteBatch({ data: { diff: [{ f2: 1, f3: 1, f14: "无代码" }] } }).size).toBe(0)
  })
})

describe("人气榜抓取", () => {
  test("榜单与行情拼接完整", async () => {
    const { http } = httpWith({
      "stockrank/getAllCurrentList": RANK_PAYLOAD,
      "ulist.np/get": QUOTE_PAYLOAD,
    })
    const snapshot = await fetchHotRank(4, http, () => 1_750_000_000_000)

    expect(snapshot.source).toBe("东财股吧人气")
    expect(snapshot.updatedAt).toBe(1_750_000_000_000)
    expect(snapshot.items).toEqual([
      {
        code: "SH688825",
        rank: 1,
        rankChange: 0,
        name: "C长鑫",
        price: 52.87,
        changePercent: -0.15,
      },
      {
        code: "SZ001309",
        rank: 2,
        rankChange: 1,
        name: "德明利",
        price: 390.04,
        changePercent: 10.0,
      },
      {
        code: "SH603986",
        rank: 3,
        rankChange: 0,
        name: "兆易创新",
        price: 371.1,
        changePercent: 1.94,
      },
      {
        code: "SZ300308",
        rank: 4,
        rankChange: -2,
        name: "中际旭创",
        price: null,
        changePercent: null,
      },
    ])
  })

  test("榜单纯 POST 且 pageSize 透传，行情 secids 带交易所前缀", async () => {
    const { http, recorded } = httpWith({
      "stockrank/getAllCurrentList": RANK_PAYLOAD,
      "ulist.np/get": QUOTE_PAYLOAD,
    })
    await fetchHotRank(25, http)

    const rankRequest = recorded[0]?.request
    expect(rankRequest?.method).toBe("POST")
    expect(rankRequest?.url).toContain("stockrank/getAllCurrentList")
    expect(rankRequest?.body).toContain('"pageSize":25')
    const quoteRequest = recorded[1]?.request
    expect(quoteRequest?.url).toContain("1.688825")
    expect(quoteRequest?.url).toContain("0.001309")
  })

  test("行情失败降级为代码名与空报价", async () => {
    const { http } = httpWith({
      "stockrank/getAllCurrentList": RANK_PAYLOAD,
      "ulist.np/get": new Error("boom"),
    })
    const snapshot = await fetchHotRank(4, http)

    expect(snapshot.items[0]).toEqual({
      code: "SH688825",
      rank: 1,
      rankChange: 0,
      name: "688825",
      price: null,
      changePercent: null,
    })
  })

  test("榜单请求失败抛出状态码", async () => {
    const { http } = httpWith({ "stockrank/getAllCurrentList": new Error("boom") })
    await expect(fetchHotRank(10, http)).rejects.toThrow("人气榜请求失败：503")
  })

  test("榜单返回无效格式抛出", async () => {
    const { http } = httpWith({ "stockrank/getAllCurrentList": { status: -1, data: null } })
    await expect(fetchHotRank(10, http)).rejects.toThrow("人气榜格式无效")
  })
})
