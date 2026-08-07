import { ANSI } from "../app/colors"
import {
  createCondition,
  listConditions,
  parseConditionSpecs,
  type ScreenCondition,
} from "../backtest/conditions"
import type { BacktestHttp } from "../backtest/data"
import { screenByConditions, screenStocks } from "../backtest/screen"
import { createStrategy, listStrategies } from "../backtest/strategy"
import { parseStrategyTokens } from "./backtest"
import type { AppCommand, CommandResult } from "./commands"

const USAGE = "/screen [策略|条件(参数) …] [参数=值 …] [source=watch|hot]"
const HTTP_TIMEOUT_MS = 10_000
const HOT_LIMIT = 50

const defaultHttp: BacktestHttp = { fetch: (input) => fetch(input) }

export type ScreenArgs =
  | {
      readonly mode: "strategy"
      readonly strategyName: string
      readonly params: Readonly<Record<string, number>>
      readonly source: "watch" | "hot"
    }
  | {
      readonly mode: "conditions"
      readonly conditions: readonly ScreenCondition[]
      readonly source: "watch" | "hot"
    }

function isConditionToken(token: string): boolean {
  const name = /^([a-z_]+)/u.exec(token)?.[1] ?? ""
  return listConditions().some((info) => info.name === name) || token.includes("(")
}

export function parseScreenArgs(args: readonly string[]): ScreenArgs | { error: string } {
  const conditionMode = args.some(isConditionToken)
  if (conditionMode) {
    const positionals = args.filter((token) => !token.includes("=") || token.includes("("))
    const kv = args.filter((token) => token.includes("=") && !token.includes("("))
    let source: "watch" | "hot" = "watch"
    for (const token of kv) {
      const [key, raw] = token.split("=", 2)
      if (key !== "source") return { error: `条件模式只支持内联参数：${token}` }
      if (raw !== "watch" && raw !== "hot") return { error: "source 必须是 watch 或 hot" }
      source = raw
    }
    const specs = parseConditionSpecs(positionals)
    if ("error" in specs) return specs
    const conditions: ScreenCondition[] = []
    for (const spec of specs) {
      const condition = createCondition(spec.name, spec.params)
      if (condition === null) return { error: `条件创建失败：${spec.name}` }
      conditions.push(condition)
    }
    return { mode: "conditions", conditions, source }
  }
  const parsed = parseStrategyTokens(args)
  if ("error" in parsed) return parsed
  let source: "watch" | "hot" = "watch"
  for (const [key, raw] of Object.entries(parsed.rest)) {
    if (key !== "source") return { error: `未知参数：${key}` }
    if (raw !== "watch" && raw !== "hot") return { error: "source 必须是 watch 或 hot" }
    source = raw
  }
  return { mode: "strategy", strategyName: parsed.strategyName, params: parsed.params, source }
}

function failure(message: string, withUsage = true): CommandResult {
  const lines = withUsage ? [message, `用法 ${USAGE}`] : [message]
  return { kind: "output", title: "选股失败", lines }
}

function strategyUnavailable(name: string): CommandResult {
  const available = listStrategies()
    .map(
      (info) =>
        `${info.name}（${info.params.map((param) => `${param.key}=${param.defaultValue}`).join(" ")}）`,
    )
    .join("、")
  return failure(`策略不可用：${name}，可选 ${available}`)
}

async function resolveUniverse(
  context: Parameters<AppCommand["execute"]>[0],
  source: "watch" | "hot",
): Promise<{ codes: readonly string[]; label: string } | { error: string }> {
  if (source === "hot") {
    const snapshot = await context.hotRank?.()
    if (snapshot === undefined || snapshot === null) {
      return { error: "热榜数据不可用，稍后重试或改用 source=watch" }
    }
    return { codes: snapshot.items.slice(0, HOT_LIMIT).map((item) => item.code), label: "热榜" }
  }
  const codes = context.watchlist()
  if (codes.length === 0) return { error: "自选股为空，先用 /watch add <代码> 添加" }
  return { codes, label: "自选股" }
}

function failureLines(failures: readonly { code: string; error: string }[]): string[] {
  return failures.slice(0, 3).map((item) => `${item.code} ${item.error}`)
}

export function createScreenCommands(http: BacktestHttp = defaultHttp): readonly AppCommand[] {
  return [
    {
      name: "screen",
      aliases: [],
      category: "data",
      usage: USAGE,
      description:
        "按策略信号或条件组合筛选股票：扫描自选股或热榜，找出最新买入/卖出信号或满足全部条件的标的",
      async execute(context, args) {
        const parsed = parseScreenArgs(args)
        if ("error" in parsed) return failure(parsed.error)
        const universe = await resolveUniverse(context, parsed.source)
        if ("error" in universe) return failure(universe.error, false)
        const { codes, label } = universe

        if (parsed.mode === "conditions") {
          const result = await screenByConditions(http, HTTP_TIMEOUT_MS, codes, parsed.conditions)
          const summary = parsed.conditions.map((condition) => condition.summary).join(" 且 ")
          const lines: string[] = [`条件 ${summary} · ${label} ${codes.length} 只`]
          if (result.hits.length > 0) {
            lines.push(`${ANSI.red}满足条件${ANSI.reset}：`)
            for (const hit of result.hits) {
              lines.push(`${hit.code} 收盘 ${hit.close.toFixed(2)} · ${hit.date}`)
            }
          } else {
            lines.push("无满足全部条件的标的")
          }
          const stats = [`未满足 ${result.misses.length} 只`]
          if (result.failures.length > 0) stats.push(`失败 ${result.failures.length} 只`)
          lines.push(stats.join(" · "), ...failureLines(result.failures))
          return { kind: "output", title: `选股 条件组合 · ${label}`, lines }
        }

        const strategy = createStrategy(parsed.strategyName, parsed.params)
        if (strategy === null) return strategyUnavailable(parsed.strategyName)
        const result = await screenStocks(http, HTTP_TIMEOUT_MS, codes, strategy)
        const lines: string[] = [`策略 ${strategy.summary} · ${label} ${codes.length} 只`]
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
        const stats = [`无信号 ${result.quiet.length} 只`]
        if (result.failures.length > 0) stats.push(`失败 ${result.failures.length} 只`)
        lines.push(stats.join(" · "), ...failureLines(result.failures))
        return { kind: "output", title: `选股 ${strategy.name} · ${label}`, lines }
      },
    },
  ]
}

export const SCREEN_COMMANDS: readonly AppCommand[] = createScreenCommands()
