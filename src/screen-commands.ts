import { parseStrategyTokens } from "./backtest-commands"
import type { BacktestHttp } from "./backtest-data"
import { createStrategy, listStrategies } from "./backtest-strategy"
import { ANSI } from "./colors"
import type { AppCommand, CommandResult } from "./commands"
import { screenStocks } from "./stock-screen"

const USAGE = "/screen [策略] [参数=值 …] [source=watch|hot]"
const HTTP_TIMEOUT_MS = 10_000
const HOT_LIMIT = 50

const defaultHttp: BacktestHttp = { fetch: (input) => fetch(input) }

export interface ScreenArgs {
  readonly strategyName: string
  readonly params: Readonly<Record<string, number>>
  readonly source: "watch" | "hot"
}

export function parseScreenArgs(args: readonly string[]): ScreenArgs | { error: string } {
  const parsed = parseStrategyTokens(args)
  if ("error" in parsed) return parsed
  let source: "watch" | "hot" = "watch"
  for (const [key, raw] of Object.entries(parsed.rest)) {
    if (key !== "source") return { error: `未知参数：${key}` }
    if (raw !== "watch" && raw !== "hot") return { error: "source 必须是 watch 或 hot" }
    source = raw
  }
  return { strategyName: parsed.strategyName, params: parsed.params, source }
}

function failure(message: string, withUsage = true): CommandResult {
  const lines = withUsage ? [message, `用法 ${USAGE}`] : [message]
  return { kind: "output", title: "选股失败", lines }
}

export function createScreenCommands(http: BacktestHttp = defaultHttp): readonly AppCommand[] {
  return [
    {
      name: "screen",
      aliases: [],
      category: "data",
      usage: USAGE,
      description: "按策略信号筛选股票：扫描自选股或热榜，找出最新买入/卖出信号",
      async execute(context, args) {
        const parsed = parseScreenArgs(args)
        if ("error" in parsed) return failure(parsed.error)
        const strategy = createStrategy(parsed.strategyName, parsed.params)
        if (strategy === null) {
          const available = listStrategies()
            .map(
              (info) =>
                `${info.name}（${info.params.map((param) => `${param.key}=${param.defaultValue}`).join(" ")}）`,
            )
            .join("、")
          return failure(`策略不可用：${parsed.strategyName}，可选 ${available}`)
        }
        let codes: readonly string[]
        let sourceLabel: string
        if (parsed.source === "hot") {
          const snapshot = await context.hotRank?.()
          if (snapshot === undefined || snapshot === null) {
            return failure("热榜数据不可用，稍后重试或改用 source=watch", false)
          }
          codes = snapshot.items.slice(0, HOT_LIMIT).map((item) => item.code)
          sourceLabel = "热榜"
        } else {
          codes = context.watchlist()
          sourceLabel = "自选股"
        }
        if (codes.length === 0) return failure("自选股为空，先用 /watch add <代码> 添加", false)
        const result = await screenStocks(http, HTTP_TIMEOUT_MS, codes, strategy)
        const lines: string[] = [`策略 ${strategy.summary} · ${sourceLabel} ${codes.length} 只`]
        const buys = result.hits.filter((hit) => hit.signal === "buy")
        const sells = result.hits.filter((hit) => hit.signal === "sell")
        if (buys.length > 0) {
          lines.push(`${ANSI.red}买入信号${ANSI.reset}：`)
          for (const hit of buys)
            lines.push(`${hit.code} 收盘 ${hit.close.toFixed(2)} · ${hit.date}`)
        }
        if (sells.length > 0) {
          lines.push(`${ANSI.green}卖出信号${ANSI.reset}：`)
          for (const hit of sells)
            lines.push(`${hit.code} 收盘 ${hit.close.toFixed(2)} · ${hit.date}`)
        }
        if (result.hits.length === 0) lines.push("无买入或卖出信号")
        const summary = [`无信号 ${result.quiet.length} 只`]
        if (result.failures.length > 0) summary.push(`失败 ${result.failures.length} 只`)
        lines.push(summary.join(" · "))
        for (const item of result.failures.slice(0, 3)) {
          lines.push(`${item.code} ${item.error}`)
        }
        return {
          kind: "output",
          title: `选股 ${strategy.name} · ${sourceLabel}`,
          lines,
        }
      },
    },
  ]
}

export const SCREEN_COMMANDS: readonly AppCommand[] = createScreenCommands()
