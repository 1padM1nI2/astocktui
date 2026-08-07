import type { AgentTool, AgentToolResult } from "@oh-my-pi/pi-agent-core"
import { z } from "@oh-my-pi/pi-ai"
import { isAshareCode, normalizeMarketCode } from "../market/market-code"
import type { StockDetail } from "../market/stock-detail"
import type { StockSearchMatch } from "../market/stock-search"
import type { TradeQuote } from "../trading/trading"

/** 个股搜索与详情工具依赖的最小上下文，CommandContext 结构兼容 */
export interface StockToolContext {
  quote(code: string): Promise<TradeQuote | undefined>
  quoteDetail?(code: string): Promise<StockDetail | undefined>
  searchStocks?(query: string): Promise<readonly StockSearchMatch[]>
}

function jsonResult(value: unknown): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    details: value,
  }
}

/** 名称搜索 + 任意个股详情：与 manage_watchlist 互补，全程不改动自选股 */
export function createStockAgentTools(context: StockToolContext): readonly AgentTool[] {
  return [
    {
      name: "search_stock",
      label: "搜索股票",
      description:
        "按名称、拼音或代码片段搜索沪深 A 股，返回规范化代码（如 SH600519）与名称。用户给出股票名称时先用本工具解析代码，再调 get_stock_detail 查详情，全程无需加入自选股。",
      parameters: z.object({ query: z.string().min(1) }),
      intent: "omit",
      approval: "read",
      execute: async (_id, params) => {
        const { query } = params as { readonly query: string }
        const search = context.searchStocks
        if (search === undefined) throw new Error("当前环境不支持股票搜索")
        const matches = await search(query)
        return jsonResult({ query, total: matches.length, matches })
      },
    },
    {
      name: "get_stock_detail",
      label: "查询个股详情",
      description:
        "查询任意 A 股实时详情：最新价、五档盘口、52 周高低、估值与市值，无需加入自选股。参数为六位代码或 SH/SZ 前缀代码；只知道名称时先用 search_stock 解析。",
      parameters: z.object({ code: z.string().min(1) }),
      intent: "omit",
      approval: "read",
      execute: async (_id, params) => {
        const raw = (params as { readonly code: string }).code
        const code = normalizeMarketCode(raw)
        if (code === null) throw new Error(`代码无效：${raw}`)
        if (!isAshareCode(code)) throw new Error("个股详情仅支持 A 股代码")
        const [quote, detail] = await Promise.all([
          context.quote(code).catch(() => undefined),
          context.quoteDetail?.(code).catch(() => undefined),
        ])
        if (quote === undefined && detail === undefined)
          throw new Error(`无法获取 ${code} 的行情，请检查代码或稍后重试`)
        return jsonResult({
          code,
          name: quote?.name ?? detail?.name ?? code,
          price: quote?.price ?? detail?.open ?? null,
          detail: detail ?? null,
        })
      },
    },
  ]
}
