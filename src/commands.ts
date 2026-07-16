import { ANSI } from "./colors"
import type { CommandContext, DataStatus, WorkspaceName } from "./command-context"
import { calculatePortfolio } from "./portfolio"
import { TRADING_COMMANDS } from "./trading-commands"
import { WATCHLIST_COMMANDS } from "./watchlist-commands"

export type * from "./command-context"

export interface CommandResult {
  readonly kind: "output" | "clear"
  readonly title: string
  readonly lines: readonly string[]
}
export type CommandExecution = CommandResult | Promise<CommandResult>

export interface AppCommand {
  readonly name: string
  readonly aliases: readonly string[]
  readonly category: "system" | "workspace" | "data" | "portfolio"
  readonly usage: string
  readonly description: string
  readonly bareNames?: readonly string[]
  execute(context: CommandContext, args: readonly string[]): CommandExecution
}

const MONEY_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const WORKSPACE_LABELS: Readonly<Record<WorkspaceName, string>> = {
  market: "行情",
  portfolio: "持仓",
  news: "新闻",
  agent: "Agent",
}

function output(title: string, lines: readonly string[]): CommandResult {
  return { kind: "output", title, lines }
}

function error(message: string, usage?: string): CommandResult {
  const lines = usage === undefined ? [message] : [message, `用法 ${usage}`]
  return output("命令错误", lines)
}

function findCommand(name: string): AppCommand | undefined {
  return APP_COMMANDS.find((command) => command.name === name || command.aliases.includes(name))
}

function dataStatusLabel(status: DataStatus): string {
  if (status.state === "loading") return "更新中"
  if (status.state === "error") return "获取失败"
  if (status.state === "ready") return status.source ?? "已加载"
  return "未加载"
}

function formatMoney(value: number, signed = false): string {
  const amount = MONEY_FORMATTER.format(Math.abs(value))
  if (!signed || value === 0) return `¥${amount}`
  return value > 0 ? `+¥${amount}` : `-¥${amount}`
}

function profitText(value: number): string {
  const color = value > 0 ? ANSI.red : value < 0 ? ANSI.green : ANSI.brightWhite
  return `${color}${formatMoney(value, true)}${ANSI.reset}`
}

function helpCommand(_context: CommandContext, args: readonly string[]): CommandResult {
  const requested = args[0]?.replace(/^\//, "")
  if (requested !== undefined) {
    const command = findCommand(requested)
    if (command === undefined) return error(`未知命令 /${requested}`)
    return output(`命令帮助 · /${command.name}`, [command.usage, command.description])
  }
  return output(
    "命令帮助",
    APP_COMMANDS.map((command) => `${command.usage}  ${command.description}`),
  )
}

function statusCommand(context: CommandContext): CommandResult {
  const status = context.status()
  const snapshot = context.portfolio()
  const summary = calculatePortfolio(snapshot)
  const positionLabel =
    snapshot.positions.length === 0 ? "空仓" : `${snapshot.positions.length}只持仓`
  return output("工作台状态", [
    `工作区 ${WORKSPACE_LABELS[status.activeWorkspace]}`,
    `行情 ${dataStatusLabel(status.market)}`,
    `财经新闻 ${dataStatusLabel(status.news)}`,
    `模拟账户 ${formatMoney(summary.totalAssets)} · ${positionLabel}`,
    `Agent ${status.agent === "ready" ? "就绪" : "已完成"}`,
  ])
}

function focusCommand(context: CommandContext, args: readonly string[]): CommandResult {
  const workspace = args[0]
  if (
    workspace !== "market" &&
    workspace !== "portfolio" &&
    workspace !== "news" &&
    workspace !== "agent"
  ) {
    return error("工作区必须是 market、portfolio、news 或 agent", "/focus <workspace>")
  }
  context.focus(workspace)
  return output("切换工作区", [`已切换到 ${WORKSPACE_LABELS[workspace]}`])
}

function refreshCommand(context: CommandContext, args: readonly string[]): CommandResult {
  const target = args[0] ?? "all"
  if (target !== "market" && target !== "news" && target !== "all") {
    return error("刷新目标必须是 market、news 或 all", "/refresh [market|news|all]")
  }
  const report = context.refresh(target)
  const started: string[] = []
  const running: string[] = []
  if (report.market === "started") started.push("行情")
  else if (report.market === "running") running.push("行情")
  if (report.news === "started") started.push("财经新闻")
  else if (report.news === "running") running.push("财经新闻")
  const lines: string[] = []
  if (started.length > 0) lines.push(`已启动刷新：${started.join("、")}`)
  if (running.length > 0) lines.push(`刷新进行中：${running.join("、")}`)
  return output("刷新数据", lines)
}

function portfolioCommand(context: CommandContext): CommandResult {
  const snapshot = context.portfolio()
  const summary = calculatePortfolio(snapshot)
  const lines = [
    `总资产 ${formatMoney(summary.totalAssets)}`,
    `可用资金 ${formatMoney(snapshot.cash)}`,
    `持仓市值 ${formatMoney(summary.marketValue)}`,
    `累计盈亏 ${profitText(summary.totalProfit)}`,
    `持仓 ${snapshot.positions.length === 0 ? "空仓" : `${snapshot.positions.length}只`}`,
  ]
  for (const position of snapshot.positions) {
    lines.push(`${position.code} ${position.name} ${position.quantity}股`)
  }
  return output("模拟账户", lines)
}

export const APP_COMMANDS: readonly AppCommand[] = [
  {
    name: "help",
    aliases: [],
    category: "system",
    usage: "/help [command]",
    description: "查看命令帮助",
    execute: helpCommand,
  },
  {
    name: "status",
    aliases: [],
    category: "system",
    usage: "/status",
    description: "查看工作台和数据状态",
    execute: statusCommand,
  },
  {
    name: "focus",
    aliases: [],
    category: "workspace",
    usage: "/focus <workspace>",
    description: "切换工作区",
    execute: focusCommand,
  },
  {
    name: "refresh",
    aliases: [],
    category: "data",
    usage: "/refresh [market|news|all]",
    description: "刷新行情或财经新闻",
    execute: refreshCommand,
  },
  ...WATCHLIST_COMMANDS,
  {
    name: "portfolio",
    aliases: [],
    category: "portfolio",
    usage: "/portfolio",
    description: "查看模拟账户",
    execute: portfolioCommand,
  },
  ...TRADING_COMMANDS,
  {
    name: "clear",
    aliases: [],
    category: "system",
    usage: "/clear",
    description: "清理 Agent 输出",
    execute: (context) => {
      context.clearAgent()
      return { kind: "clear", title: "", lines: [] }
    },
  },
  {
    name: "quit",
    aliases: ["q", "exit"],
    category: "system",
    usage: "/quit | /exit",
    description: "退出程序",
    bareNames: ["quit", "exit"],
    execute: (context) => {
      context.quit()
      return output("退出", ["正在退出…"])
    },
  },
]

export function isBareCommand(input: string): boolean {
  const name = input.trim().toLowerCase()
  const command = findCommand(name)
  return command?.bareNames?.includes(name) === true && !/\s/.test(name)
}

export function filterCommands(input: string): readonly AppCommand[] {
  const trimmed = input.trimStart()
  const withoutSlash = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed
  const token = withoutSlash.split(/\s/, 1)[0]?.toLowerCase() ?? ""
  if (token.length === 0) return APP_COMMANDS
  return APP_COMMANDS.filter(
    (command) =>
      command.name.startsWith(token) || command.aliases.some((alias) => alias.startsWith(token)),
  )
}

export function executeCommand(input: string, context: CommandContext): CommandExecution {
  const trimmed = input.trim()
  const hasSlash = trimmed.startsWith("/")
  const parts = (hasSlash ? trimmed.slice(1) : trimmed).split(/\s+/)
  const name = parts.shift()?.toLowerCase() ?? ""
  const command = findCommand(name)
  if (command === undefined) return error(`未知命令 /${name}`, "/help [command]")
  if (!hasSlash && (command.bareNames?.includes(name) !== true || parts.length > 0)) {
    return error("命令必须以 / 开头")
  }
  return command.execute(context, parts)
}
