import { describe, expect, test } from "bun:test"
import {
  type EastmoneyHttp,
  fetchCapitalSummary,
  fetchEastmoneyAnnouncements,
  fetchIndexFundFlow,
  fetchNorthbound,
  parseAnnouncements,
  parseFundFlow,
  parseNorthbound,
} from "../../src/market/eastmoney-extra"

const FUND_FLOW_PAYLOAD = {
  rc: 0,
  data: {
    code: "000001",
    market: 1,
    name: "上证指数",
    klines: [
      "2026-07-28,-1000000000.0,2000000000.0,-500000000.0,-500000000.0",
      "2026-07-29,-4837175296.0,11620515840.0,-6783336448.0,-3628064768.0",
    ],
  },
}

const NORTHBOUND_PAYLOAD = {
  result: {
    data: [
      {
        MUTUAL_TYPE: "001",
        TRADE_DATE: "2026-07-28 00:00:00",
        DEAL_AMT: 400_000,
        LEAD_STOCKS_NAME: "旧领涨",
        LS_CHANGE_RATE: 0.5,
      },
      {
        MUTUAL_TYPE: "001",
        TRADE_DATE: "2026-07-29 00:00:00",
        DEAL_AMT: 512_000.5,
        LEAD_STOCKS_NAME: "贵州茅台",
        LS_CHANGE_RATE: 1.2,
      },
      {
        MUTUAL_TYPE: "005",
        TRADE_DATE: "2026-07-29 00:00:00",
        FUND_INFLOW: null,
        NET_DEAL_AMT: null,
        DEAL_AMT: 341_408.12,
        LEAD_STOCKS_NAME: "圣晖集成",
        LS_CHANGE_RATE: 10.01,
      },
    ],
  },
}

const ANNOUNCEMENTS_PAYLOAD = {
  data: {
    list: [
      {
        art_code: "AN202607291234",
        title: "贵州茅台:2026年半年度报告",
        codes: [{ stock_code: "600519" }],
        notice_date: "2026-07-29 00:00:00",
        eiTime: "2026-07-29 19:30:00",
      },
      {
        art_code: "AN202607281233",
        title: "五粮液:关于分红的  公告",
        codes: [{ stock_code: "000858" }],
        notice_date: "2026-07-28 00:00:00",
        eiTime: "2026-07-28 18:00:00",
      },
    ],
  },
}

function httpWith(routes: Readonly<Record<string, unknown>>, status = 200): EastmoneyHttp {
  return async (url) => {
    for (const [needle, payload] of Object.entries(routes)) {
      if (url.includes(needle)) {
        if (payload instanceof Error) return { ok: false, status: 503, body: "" }
        return { ok: status === 200, status, body: JSON.stringify(payload) }
      }
    }
    return { ok: false, status: 404, body: "" }
  }
}

describe("主力资金解析", () => {
  test("取最新一日的主力净流入", () => {
    expect(parseFundFlow(FUND_FLOW_PAYLOAD)).toEqual({
      date: "2026-07-29",
      mainNetInflow: -4_837_175_296,
    })
  })

  test("畸形返回为 null", () => {
    expect(parseFundFlow(undefined)).toBeNull()
    expect(parseFundFlow({})).toBeNull()
    expect(parseFundFlow({ data: { klines: "oops" } })).toBeNull()
    expect(parseFundFlow({ data: { klines: [] } })).toBeNull()
    expect(parseFundFlow({ data: { klines: [42] } })).toBeNull()
    expect(parseFundFlow({ data: { klines: ["2026-07-29,abc,1,2,3"] } })).toBeNull()
  })
})

describe("北向成交解析", () => {
  test("取最新交易日的沪深两条成交额", () => {
    expect(parseNorthbound(NORTHBOUND_PAYLOAD)).toEqual({
      date: "2026-07-29",
      shTurnover: 512_000.5,
      szTurnover: 341_408.12,
      leadStockName: "贵州茅台",
    })
  })

  test("畸形返回为 null", () => {
    expect(parseNorthbound(undefined)).toBeNull()
    expect(parseNorthbound({ result: { data: "oops" } })).toBeNull()
    expect(parseNorthbound({ result: { data: [] } })).toBeNull()
    expect(
      parseNorthbound({
        result: {
          data: [{ MUTUAL_TYPE: "001", TRADE_DATE: "2026-07-29 00:00:00", DEAL_AMT: 1 }],
        },
      }),
    ).toBeNull()
  })
})

describe("公告解析", () => {
  test("映射为新闻条目并清洗标题", () => {
    const items = parseAnnouncements(ANNOUNCEMENTS_PAYLOAD, 10)

    expect(items).toEqual([
      {
        id: "eastmoney-ann:AN202607291234",
        title: "贵州茅台:2026年半年度报告",
        publishedAt: Date.parse("2026-07-29T19:30:00+08:00"),
        source: "东财公告",
        url: "https://data.eastmoney.com/notices/detail/600519/AN202607291234.html",
      },
      {
        id: "eastmoney-ann:AN202607281233",
        title: "五粮液:关于分红的 公告",
        publishedAt: Date.parse("2026-07-28T18:00:00+08:00"),
        source: "东财公告",
        url: "https://data.eastmoney.com/notices/detail/000858/AN202607281233.html",
      },
    ])
  })

  test("缺 stock_code、控制字符标题被丢弃，limit 生效", () => {
    const payload = {
      data: {
        list: [
          { art_code: "A1", title: "缺代码公告", codes: [], notice_date: "2026-07-29 00:00:00" },
          {
            art_code: "A2",
            title: "含\x1b[31m控制字符",
            codes: [{ stock_code: "600519" }],
            notice_date: "2026-07-29 00:00:00",
          },
          ANNOUNCEMENTS_PAYLOAD.data.list[0],
          ANNOUNCEMENTS_PAYLOAD.data.list[1],
        ],
      },
    }

    const items = parseAnnouncements(payload, 1)

    expect(items).toHaveLength(1)
    expect(items[0]?.id).toBe("eastmoney-ann:AN202607291234")
  })

  test("畸形返回为空数组", () => {
    expect(parseAnnouncements(undefined, 10)).toEqual([])
    expect(parseAnnouncements({ data: { list: "oops" } }, 10)).toEqual([])
  })
})

describe("东财抓取器", () => {
  test("fetchIndexFundFlow 带 secid 与 ut 请求并返回解析结果", async () => {
    const requested: string[] = []
    const http: EastmoneyHttp = async (url) => {
      requested.push(url)
      return { ok: true, status: 200, body: JSON.stringify(FUND_FLOW_PAYLOAD) }
    }

    const flow = await fetchIndexFundFlow("1.000001", http)

    expect(flow).toEqual({ date: "2026-07-29", mainNetInflow: -4_837_175_296 })
    expect(requested[0]).toContain("push2his.eastmoney.com")
    expect(requested[0]).toContain("secid=1.000001")
    expect(requested[0]).toContain("ut=")
  })

  test("fetchNorthbound 与 fetchEastmoneyAnnouncements 正常返回", async () => {
    const http = httpWith({
      "reportName=RPT_MUTUAL_DEAL_HISTORY": NORTHBOUND_PAYLOAD,
      "np-anotice-stock": ANNOUNCEMENTS_PAYLOAD,
    })

    const north = await fetchNorthbound(http)
    const announcements = await fetchEastmoneyAnnouncements(10, http)

    expect(north.szTurnover).toBe(341_408.12)
    expect(announcements).toHaveLength(2)
    expect(announcements[0]?.source).toBe("东财公告")
  })

  test("HTTP 失败或格式无效时抛错", async () => {
    await expect(
      fetchIndexFundFlow("1.000001", httpWith({ fflow: new Error("down") })),
    ).rejects.toThrow()
    await expect(fetchNorthbound(httpWith({}))).rejects.toThrow()
    await expect(
      fetchEastmoneyAnnouncements(10, httpWith({ "np-anotice-stock": new Error("down") })),
    ).rejects.toThrow()
  })
})

describe("资金北向聚合", () => {
  test("全部成功时返回完整摘要", async () => {
    const summary = await fetchCapitalSummary(
      httpWith({ fflow: FUND_FLOW_PAYLOAD, RPT_MUTUAL_DEAL_HISTORY: NORTHBOUND_PAYLOAD }),
    )

    expect(summary).toEqual({
      shMainNetInflow: -4_837_175_296,
      szMainNetInflow: -4_837_175_296,
      northbound: { shTurnover: 512_000.5, szTurnover: 341_408.12, leadStock: "贵州茅台" },
    })
  })

  test("资金流失败但北向成功时返回部分", async () => {
    const summary = await fetchCapitalSummary(
      httpWith({ fflow: new Error("down"), RPT_MUTUAL_DEAL_HISTORY: NORTHBOUND_PAYLOAD }),
    )

    expect(summary).toEqual({
      shMainNetInflow: null,
      szMainNetInflow: null,
      northbound: { shTurnover: 512_000.5, szTurnover: 341_408.12, leadStock: "贵州茅台" },
    })
  })

  test("全部失败时返回 null", async () => {
    await expect(fetchCapitalSummary(httpWith({}))).resolves.toBeNull()
  })
})
