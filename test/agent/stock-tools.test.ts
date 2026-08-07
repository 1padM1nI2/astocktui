import { describe, expect, test } from "bun:test"
import type { AgentTool } from "@oh-my-pi/pi-agent-core"
import { createStockAgentTools, type StockToolContext } from "../../src/agent/stock-tools"
import type { StockDetail } from "../../src/market/stock-detail"
import type { StockSearchMatch } from "../../src/market/stock-search"
import type { TradeQuote } from "../../src/trading/trading"

const QUOTE: TradeQuote = { code: "SH600519", name: "贵州茅台", price: 1688 }

const DETAIL: StockDetail = {
  code: "SH600519",
  name: "贵州茅台",
  open: 1670,
  peTtm: 24.5,
  pb: 8.1,
  limitUp: 1856.8,
  limitDown: 1519.2,
}

const MATCHES: readonly StockSearchMatch[] = [
  { code: "SH600519", name: "贵州茅台", pinyin: "GZMT" },
]

async function runTool(
  tools: readonly AgentTool[],
  name: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const tool = tools.find((candidate) => candidate.name === name)
  if (tool === undefined) throw new Error(`工具不存在：${name}`)
  const result = await tool.execute("test-call", params)
  const text = result.content.find((item) => item.type === "text")?.text
  return text === undefined ? null : JSON.parse(text)
}

function fakeContext(overrides: Partial<StockToolContext> = {}): StockToolContext {
  return {
    quote: async () => QUOTE,
    quoteDetail: async () => DETAIL,
    searchStocks: async () => MATCHES,
    ...overrides,
  }
}

describe("search_stock 工具", () => {
  test("返回匹配列表并透传查询词", async () => {
    const tools = createStockAgentTools(fakeContext())
    const result = (await runTool(tools, "search_stock", { query: "茅台" })) as {
      query: string
      total: number
      matches: readonly StockSearchMatch[]
    }
    expect(result.query).toBe("茅台")
    expect(result.total).toBe(1)
    expect(result.matches).toEqual(MATCHES)
  })

  test("环境不支持搜索时抛出错误", async () => {
    const tools = createStockAgentTools({ quote: async () => QUOTE })
    await expect(runTool(tools, "search_stock", { query: "茅台" })).rejects.toThrow("搜索")
  })

  test("全部为 read 分级", () => {
    for (const tool of createStockAgentTools(fakeContext())) {
      expect(tool.approval).toBe("read")
    }
  })
})

describe("get_stock_detail 工具", () => {
  test("六位代码规范化后返回报价与详情", async () => {
    const seen: string[] = []
    const tools = createStockAgentTools(
      fakeContext({
        quote: async (code) => {
          seen.push(code)
          return QUOTE
        },
      }),
    )
    const result = (await runTool(tools, "get_stock_detail", { code: "600519" })) as {
      code: string
      name: string
      price: number
      detail: StockDetail
    }
    expect(seen).toEqual(["SH600519"])
    expect(result.code).toBe("SH600519")
    expect(result.name).toBe("贵州茅台")
    expect(result.price).toBe(1688)
    expect(result.detail.peTtm).toBe(24.5)
  })

  test("详情缺失时退化为仅报价", async () => {
    const tools = createStockAgentTools({ quote: async () => QUOTE })
    const result = (await runTool(tools, "get_stock_detail", { code: "SH600519" })) as {
      price: number
      detail: StockDetail | null
    }
    expect(result.price).toBe(1688)
    expect(result.detail).toBeNull()
  })

  test("报价缺失时用详情名称与今开兜底", async () => {
    const tools = createStockAgentTools(fakeContext({ quote: async () => undefined }))
    const result = (await runTool(tools, "get_stock_detail", { code: "SH600519" })) as {
      name: string
      price: number
    }
    expect(result.name).toBe("贵州茅台")
    expect(result.price).toBe(1670)
  })

  test("无效代码与非 A 股代码报错", async () => {
    const tools = createStockAgentTools(fakeContext())
    await expect(runTool(tools, "get_stock_detail", { code: "茅台" })).rejects.toThrow("无效")
    await expect(runTool(tools, "get_stock_detail", { code: "US:AAPL" })).rejects.toThrow("A 股")
  })

  test("行情与详情都不可用时抛出错误", async () => {
    const tools = createStockAgentTools(
      fakeContext({
        quote: async () => undefined,
        quoteDetail: async () => undefined,
      }),
    )
    await expect(runTool(tools, "get_stock_detail", { code: "SH600519" })).rejects.toThrow(
      "无法获取",
    )
  })
})
