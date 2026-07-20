import type { AgentTool, AgentToolResult } from "@oh-my-pi/pi-agent-core"
import { z } from "@oh-my-pi/pi-ai"
import type { CommandContext, RefreshTarget, WorkspaceName } from "./commands"
import { createConditionAgentTools } from "./condition-agent-tools"
import { createFileAgentTools } from "./file-agent-tools"
import { createMemoryAgentTools } from "./memory-agent-tools"
import { createScheduledTaskAgentTools } from "./task-agent-tools"
import type { OrderQuantity, TradeQuote, TradeSide } from "./trading"

function jsonResult(value: unknown): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    details: value,
  }
}

function requiredQuoteError(code: string): Error {
  return new Error(`无法获取股票行情：${code}`)
}

function tradeQuoteAtPrice(quote: TradeQuote, price: number | undefined): TradeQuote {
  return price === undefined ? quote : { ...quote, price }
}

const quantitySchema = z.union([z.number().int().positive(), z.literal("all")])
const priceSchema = z.number().positive()

interface WatchlistToolInput {
  readonly action: "list" | "add" | "remove"
  readonly code?: string
}

interface TradeToolInput {
  readonly side: TradeSide
  readonly code: string
  readonly quantity: OrderQuantity
  readonly price?: number
}

interface NewsToolInput {
  readonly query?: string
  readonly sources?: readonly string[]
  readonly limit?: number
}

export function createAStockAgentTools(context: CommandContext): readonly AgentTool[] {
  return [
    {
      name: "get_app_status",
      label: "读取工作台状态",
      description: "读取当前焦点、行情、新闻和 Agent 状态。",
      parameters: z.object({}),
      intent: "omit",
      approval: "read",
      execute: async () => jsonResult(context.status()),
    },
    {
      name: "get_market_snapshot",
      label: "读取实时行情",
      description: "读取当前自选股报价、涨跌幅和走势图数据。分析股票前优先调用。",
      parameters: z.object({}),
      intent: "omit",
      approval: "read",
      execute: async () => jsonResult(context.marketSnapshot() ?? { status: "not_loaded" }),
    },
    {
      name: "get_market_overview",
      label: "读取全市场大盘",
      description:
        "读取主要 A 股指数、涨跌家数与分布、行业领涨领跌、市场成交额和极值股票。分析大盘、风格、板块或市场情绪时必须调用。",
      parameters: z.object({ refresh: z.boolean().optional() }),
      intent: "omit",
      approval: "read",
      execute: async (_id, params) => {
        const refresh = (params as { readonly refresh?: boolean }).refresh === true
        return jsonResult(await context.marketOverview(refresh))
      },
    },
    {
      name: "get_financial_news",
      label: "检索财经新闻",
      description:
        "读取或按关键词、来源筛选多源财经快讯、深度新闻、热门股票和宏观事件。分析事件影响前调用。",
      parameters: z.object({
        query: z.string().optional(),
        sources: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      intent: "omit",
      approval: "read",
      execute: async (_id, params) => {
        const snapshot = context.newsSnapshot()
        if (snapshot === null) return jsonResult({ status: "not_loaded" })
        const input = params as NewsToolInput
        const query = input.query?.trim().toLocaleLowerCase()
        const sources = input.sources === undefined ? null : new Set(input.sources)
        const matches = snapshot.items.filter(
          (item) =>
            (query === undefined ||
              item.title.toLocaleLowerCase().includes(query) ||
              item.source.toLocaleLowerCase().includes(query)) &&
            (sources === null || sources.has(item.source)),
        )
        const limit = Math.min(50, Math.max(1, input.limit ?? 40))
        return jsonResult({
          source: snapshot.source,
          total: matches.length,
          availableSources: [...new Set(snapshot.items.map((item) => item.source))],
          items: matches.slice(0, limit),
        })
      },
    },
    {
      name: "get_portfolio",
      label: "读取模拟账户",
      description: "读取模拟账户现金、持仓、成本、现价和可卖数量。",
      parameters: z.object({}),
      intent: "omit",
      approval: "read",
      execute: async () => jsonResult(context.portfolio()),
    },
    {
      name: "get_trade_history",
      label: "读取成交记录",
      description: "读取本地模拟账户的完整成交记录。",
      parameters: z.object({}),
      intent: "omit",
      approval: "read",
      execute: async () => jsonResult(context.trading().trades),
    },
    {
      name: "refresh_data",
      label: "刷新市场数据",
      description: "刷新行情、财经新闻或全部数据，并等待刷新完成。",
      parameters: z.object({ target: z.enum(["market", "news", "all"]) }),
      intent: "omit",
      approval: "write",
      execute: async (_id, params) => {
        const target = (params as { readonly target: RefreshTarget }).target
        await context.refreshAndWait(target)
        return jsonResult({ target, status: "completed" })
      },
    },
    {
      name: "manage_watchlist",
      label: "管理行情自选股",
      description: "查看、添加或删除行情窗口自选股。股票代码支持六位代码或 SH/SZ 前缀。",
      parameters: z.object({
        action: z.enum(["list", "add", "remove"]),
        code: z.string().optional(),
      }),
      intent: "omit",
      approval: (params) =>
        typeof params === "object" && params !== null && Reflect.get(params, "action") === "list"
          ? "read"
          : "write",
      execute: async (_id, params) => {
        const input = params as WatchlistToolInput
        if (input.action === "list") return jsonResult({ codes: context.watchlist() })
        if (input.code === undefined) throw new Error(`${input.action} 操作需要股票代码`)
        const change = await context.changeWatchlist(input.action, input.code)
        if (!change.ok) throw new Error(change.message)
        return jsonResult({ ...change, codes: context.watchlist() })
      },
    },
    {
      name: "preview_trade",
      label: "预览模拟交易",
      description:
        "按最新行情或用户指定的历史、假设价格预览模拟买卖的金额、费用、资金和实现盈亏，不会成交。",
      parameters: z.object({
        side: z.enum(["buy", "sell"]),
        code: z.string(),
        quantity: quantitySchema,
        price: priceSchema.optional(),
      }),
      intent: "omit",
      approval: "read",
      execute: async (_id, params) => {
        const input = params as TradeToolInput
        const quote = await context.quote(input.code)
        if (quote === undefined) throw requiredQuoteError(input.code)
        const result = context
          .trading()
          .preview(input.side, tradeQuoteAtPrice(quote, input.price), input.quantity)
        if (!result.ok || result.preview === undefined) throw new Error(result.message)
        return jsonResult(result.preview)
      },
    },
    {
      name: "execute_trade",
      label: "执行模拟交易",
      description:
        "Agent 可基于已读取数据自主执行本地模拟买卖，无需逐笔用户确认；复用 A 股整手、资金、费用和 T+1 风控，绝不连接真实券商。",
      parameters: z.object({
        side: z.enum(["buy", "sell"]),
        code: z.string(),
        quantity: quantitySchema,
        price: priceSchema.optional(),
      }),
      intent: "omit",
      approval: "write",
      concurrency: "exclusive",
      execute: async (_id, params) => {
        const input = params as TradeToolInput
        const quote = await context.quote(input.code)
        if (quote === undefined) throw requiredQuoteError(input.code)
        const result = context
          .trading()
          .execute(input.side, tradeQuoteAtPrice(quote, input.price), input.quantity)
        if (!result.ok) throw new Error(result.message)
        context.portfolioChanged()
        return jsonResult(result)
      },
    },
    {
      name: "reset_paper_account",
      label: "重置模拟账户",
      description: "仅在用户明确要求重置时清空模拟持仓和成交记录。必须传入 RESET。",
      parameters: z.object({ confirmation: z.string() }),
      intent: "omit",
      approval: { tier: "exec", reason: "将清空并持久化全部模拟持仓和成交记录", override: true },
      concurrency: "exclusive",
      execute: async (_id, params) => {
        const input = params as { readonly confirmation: string }
        if (input.confirmation !== "RESET") throw new Error("重置模拟账户必须确认 RESET")
        context.trading().reset()
        context.portfolioChanged()
        return jsonResult({ status: "reset", account: context.portfolio() })
      },
    },
    {
      name: "focus_workspace",
      label: "切换工作区",
      description: "切换 TUI 焦点到行情、持仓、新闻、Agent 或交易记录工作区。",
      parameters: z.object({
        workspace: z.enum(["market", "portfolio", "news", "agent", "trade"]),
      }),
      intent: "omit",
      approval: "write",
      execute: async (_id, params) => {
        const input = params as { readonly workspace: WorkspaceName }
        context.focus(input.workspace)
        return jsonResult({ workspace: input.workspace })
      },
    },
    ...createFileAgentTools(),
    ...createConditionAgentTools(context),
    ...createScheduledTaskAgentTools(context),
    ...createMemoryAgentTools(context),
  ]
}
