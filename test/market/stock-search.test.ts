import { describe, expect, test } from "bun:test"
import type { StockSearchHttpResult } from "../../src/market/stock-search"
import { createEastmoneyStockSearcher, parseEastmoneySuggest } from "../../src/market/stock-search"

function entry(fields: Record<string, unknown>): Record<string, unknown> {
  return { Classify: "AStock", MktNum: "1", PinYin: "", ...fields }
}

describe("parseEastmoneySuggest", () => {
  test("解析沪深 A 股并规范化为 SH/SZ 前缀代码", () => {
    const payload = {
      QuotationCodeTable: {
        Data: [
          entry({ Code: "600519", Name: "贵州茅台", PinYin: "GZMT", MktNum: "1" }),
          entry({ Code: "000858", Name: "五粮液", PinYin: "WLY", MktNum: "0" }),
        ],
      },
    }
    expect(parseEastmoneySuggest(payload)).toEqual([
      { code: "SH600519", name: "贵州茅台", pinyin: "GZMT" },
      { code: "SZ000858", name: "五粮液", pinyin: "WLY" },
    ])
  })

  test("过滤北交所、非 A 股与无效代码", () => {
    const payload = {
      QuotationCodeTable: {
        Data: [
          entry({ Code: "830799", Name: "艾融软件", MktNum: "0" }),
          entry({ Code: "920001", Name: "北证新股", MktNum: "0" }),
          entry({ Code: "430047", Name: "诺思兰德", MktNum: "0" }),
          entry({ Code: "AAPL", Name: "苹果", Classify: "USStock", MktNum: "105" }),
          entry({ Code: "00700", Name: "腾讯控股", Classify: "HKStock", MktNum: "116" }),
          entry({ Code: "600519", Name: "贵州茅台" }),
        ],
      },
    }
    expect(parseEastmoneySuggest(payload)).toEqual([
      { code: "SH600519", name: "贵州茅台", pinyin: "" },
    ])
  })

  test("剔除带终端控制字符的名称并按代码去重", () => {
    const payload = {
      QuotationCodeTable: {
        Data: [
          entry({ Code: "600519", Name: "贵州茅台" }),
          entry({ Code: "600519", Name: "贵州茅台", MktNum: "1" }),
          entry({ Code: "000001", Name: "平安银行\u001B[31m", MktNum: "0" }),
        ],
      },
    }
    expect(parseEastmoneySuggest(payload)).toEqual([
      { code: "SH600519", name: "贵州茅台", pinyin: "" },
    ])
  })

  test("畸形载荷返回空数组", () => {
    expect(parseEastmoneySuggest(null)).toEqual([])
    expect(parseEastmoneySuggest({})).toEqual([])
    expect(parseEastmoneySuggest({ QuotationCodeTable: { Data: "oops" } })).toEqual([])
    expect(parseEastmoneySuggest({ QuotationCodeTable: { Data: [null, 42, {}] } })).toEqual([])
  })
})

describe("createEastmoneyStockSearcher", () => {
  const okHttp = async (): Promise<StockSearchHttpResult> => ({
    ok: true,
    status: 200,
    body: JSON.stringify({
      QuotationCodeTable: {
        Data: [entry({ Code: "600519", Name: "贵州茅台", PinYin: "GZMT" })],
      },
    }),
  })

  test("拼接编码后的查询地址并解析结果", async () => {
    const urls: string[] = []
    const search = createEastmoneyStockSearcher(async (url) => {
      urls.push(url)
      return okHttp()
    })
    const matches = await search("茅台")
    expect(matches).toEqual([{ code: "SH600519", name: "贵州茅台", pinyin: "GZMT" }])
    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain("input=%E8%8C%85%E5%8F%B0")
    expect(urls[0]).toContain("type=14")
  })

  test("空白查询不发起请求", async () => {
    let called = 0
    const search = createEastmoneyStockSearcher(async () => {
      called += 1
      return okHttp()
    })
    expect(await search("   ")).toEqual([])
    expect(called).toBe(0)
  })

  test("HTTP 失败抛出带状态码的错误", async () => {
    const search = createEastmoneyStockSearcher(async () => ({
      ok: false,
      status: 503,
      body: "",
    }))
    await expect(search("茅台")).rejects.toThrow("503")
  })

  test("非 JSON 响应抛出解析错误", async () => {
    const search = createEastmoneyStockSearcher(async () => ({
      ok: true,
      status: 200,
      body: "<html>blocked</html>",
    }))
    await expect(search("茅台")).rejects.toThrow("非 JSON")
  })
})
