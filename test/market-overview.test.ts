import { describe, expect, test } from "bun:test"
import { MarketOverviewService, type MarketOverviewSnapshot } from "../src/market-overview"
import {
  type MarketOverviewFetcher,
  PublicMarketOverviewDataSource,
} from "../src/market-overview-source"

const INDEX_QUOTES = [
  {
    code: "SH000001",
    name: "上证指数",
    percent: 0.0125,
    now: 3_900,
    low: 3_850,
    high: 3_920,
    yesterday: 3_851.86,
    source: "test-index",
  },
]

const SECTORS = {
  media:
    "new_cmyl,传媒娱乐,40,7.69,0.15,2.05,808166135,6622345184,sz002739,10.02,10.32,0.94,儒意电影",
  bank: "new_jrhy,金融行业,51,13.10,0.01,0.10,249570655,27497796790,sz000750,1.05,3.85,0.04,国海证券",
  coal: "new_mthy,煤炭行业,41,10.22,-0.16,-1.55,1234281064,11285056754,sh600721,7.39,8.13,0.56,百花医药",
}

const TOP_GAINERS = [
  {
    symbol: "sz300001",
    code: "300001",
    name: "测试上涨",
    trade: "12.00",
    changepercent: 20,
    amount: 500_000_000,
    turnoverratio: 12.5,
  },
]

const TOP_LOSERS = [
  {
    symbol: "sh600001",
    code: "600001",
    name: "测试下跌",
    trade: "8.00",
    changepercent: -10,
    amount: 200_000_000,
    turnoverratio: 4.2,
  },
]

function overviewFetcher(): MarketOverviewFetcher {
  return async (url) => {
    if (url.includes("getTopicZDFenBu")) {
      return {
        ok: true,
        status: 200,
        body: JSON.stringify({
          data: {
            fenbu: [{ "-10": 2 }, { "-1": 10 }, { "0": 3 }, { "1": 20 }, { "10": 4 }, { "11": 6 }],
          },
        }),
      }
    }
    if (url.includes("newSinaHy")) {
      return {
        ok: true,
        status: 200,
        body: `var S_Finance_bankuai_sinaindustry = ${JSON.stringify(SECTORS)}`,
      }
    }
    const asc = new URL(url).searchParams.get("asc")
    return {
      ok: true,
      status: 200,
      body: JSON.stringify(asc === "1" ? TOP_LOSERS : TOP_GAINERS),
    }
  }
}

function overviewSnapshot(): MarketOverviewSnapshot {
  return {
    indices: [],
    breadth: {
      rising: 1,
      falling: 1,
      flat: 0,
      gainAtLeast10Percent: 0,
      lossAtLeast10Percent: 0,
      distribution: {},
    },
    sectors: { leaders: [], laggards: [], totalTurnover: 0 },
    movers: { gainers: [], losers: [] },
    availability: { indices: false, breadth: true, sectors: true, movers: true, errors: [] },
    source: "test",
    updatedAt: 1,
  }
}

describe("全市场大盘快照", () => {
  test("聚合指数、涨跌广度、行业强弱、成交额和极值股票", async () => {
    const source = new PublicMarketOverviewDataSource(
      { getStocks: async () => INDEX_QUOTES },
      overviewFetcher(),
      () => 1_783_992_000_000,
    )

    const snapshot = await source.loadOverview()

    expect(snapshot.indices[0]).toMatchObject({
      code: "SH000001",
      name: "上证指数",
      changePercent: 1.25,
      price: 3_900,
    })
    expect(snapshot.breadth).toMatchObject({
      rising: 30,
      falling: 12,
      flat: 3,
      gainAtLeast10Percent: 10,
      lossAtLeast10Percent: 2,
    })
    expect(snapshot.sectors?.leaders[0]).toMatchObject({ name: "传媒娱乐", changePercent: 2.05 })
    expect(snapshot.sectors?.laggards[0]).toMatchObject({ name: "煤炭行业", changePercent: -1.55 })
    expect(snapshot.sectors?.totalTurnover).toBe(45_405_198_728)
    expect(snapshot.movers?.gainers[0]).toMatchObject({ code: "SZ300001", name: "测试上涨" })
    expect(snapshot.movers?.losers[0]).toMatchObject({ code: "SH600001", name: "测试下跌" })
    expect(snapshot.updatedAt).toBe(1_783_992_000_000)
  })

  test("缓存大盘快照并允许显式刷新", async () => {
    let calls = 0
    const service = new MarketOverviewService(
      {
        async loadOverview(): Promise<MarketOverviewSnapshot> {
          calls++
          return overviewSnapshot()
        },
      },
      60_000,
      () => 10_000,
    )

    await service.getOverview()
    await service.getOverview()
    expect(calls).toBe(1)

    await service.refresh()
    expect(calls).toBe(2)
  })

  test("关键公共接口全部失败时明确拒绝不完整快照", async () => {
    const failedFetcher: MarketOverviewFetcher = async () => ({ ok: false, status: 503, body: "" })
    const source = new PublicMarketOverviewDataSource({ getStocks: async () => [] }, failedFetcher)

    await expect(source.loadOverview()).rejects.toThrow("大盘数据")
  })
})
