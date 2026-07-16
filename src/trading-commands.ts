import { ANSI } from "./colors"
import type { AppCommand, CommandContext, CommandResult } from "./commands"
import { normalizeAshareCode } from "./market-data"
import type { OrderQuantity, TradePreview, TradeSide } from "./trading"

const MONEY_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function money(value: number): string {
  const sign = value < 0 ? "-" : ""
  return `${sign}¥${MONEY_FORMATTER.format(Math.abs(value))}`
}

function output(title: string, lines: readonly string[]): CommandResult {
  return { kind: "output", title, lines }
}

function error(message: string, usage: string): CommandResult {
  return output("交易命令错误", [message, `用法 ${usage}`])
}

function parseQuantity(value: string | undefined): OrderQuantity | null {
  if (value === "all") return "all"
  if (value === undefined || value.trim().length === 0) return null
  const quantity = Number(value)
  return Number.isFinite(quantity) ? quantity : null
}

function previewLines(preview: TradePreview, executed: boolean): string[] {
  const sideLabel = preview.side === "buy" ? "买入" : "卖出"
  const cashLabel =
    preview.side === "buy"
      ? executed
        ? "实际支出"
        : "预计支出"
      : executed
        ? "实际到账"
        : "预计到账"
  const lines = [
    `${sideLabel} ${preview.code} ${preview.name} ${preview.quantity}股`,
    `成交价 ${money(preview.price)}`,
    `成交金额 ${money(preview.grossAmount)}`,
    `费用 ${money(preview.totalFees)}（佣金 ${money(preview.commission)} · 印花税 ${money(preview.stampDuty)} · 过户费 ${money(preview.transferFee)}）`,
    `${cashLabel} ${money(Math.abs(preview.cashChange))}`,
    `成交后可用资金 ${money(preview.cashAfter)}`,
  ]
  if (preview.side === "sell") {
    const color =
      preview.realizedProfit > 0
        ? ANSI.red
        : preview.realizedProfit < 0
          ? ANSI.green
          : ANSI.brightWhite
    const sign = preview.realizedProfit > 0 ? "+" : ""
    lines.push(`实现盈亏 ${color}${sign}${money(preview.realizedProfit)}${ANSI.reset}`)
  }
  return lines
}

async function runOrder(
  context: CommandContext,
  side: TradeSide,
  args: readonly string[],
  previewOnly: boolean,
): Promise<CommandResult> {
  const usage = previewOnly
    ? "/preview <buy|sell> <code> <quantity|all>"
    : `/${side} <code> <quantity|all>`
  const code = args[0]
  const quantity = parseQuantity(args[1])
  if (code === undefined || quantity === null) return error("股票代码或数量无效", usage)
  const normalizedCode = normalizeAshareCode(code)
  if (normalizedCode === null) {
    return error("股票代码格式无效，需使用 600519、SH600519 或 SZ000001", usage)
  }
  const quote = await context.quote(normalizedCode)
  if (quote === undefined) {
    return output("交易拒绝", [`行情获取失败：${normalizedCode}`, "请稍后重试"])
  }
  const service = context.trading()
  const result = previewOnly
    ? service.preview(side, quote, quantity)
    : service.execute(side, quote, quantity)
  if (!result.ok || result.preview === undefined) {
    return output("交易拒绝", [result.message])
  }
  if (!previewOnly) context.portfolioChanged()
  const title = previewOnly ? "交易预览" : result.message
  const lines = previewLines(result.preview, !previewOnly)
  if (result.trade !== undefined) lines.unshift(`成交编号 ${result.trade.id}`)
  return output(title, lines)
}

async function previewCommand(
  context: CommandContext,
  args: readonly string[],
): Promise<CommandResult> {
  const side = args[0]
  if (side !== "buy" && side !== "sell") {
    return error("方向必须是 buy 或 sell", "/preview <buy|sell> <code> <quantity|all>")
  }
  return runOrder(context, side, args.slice(1), true)
}

async function buyCommand(
  context: CommandContext,
  args: readonly string[],
): Promise<CommandResult> {
  return runOrder(context, "buy", args, false)
}

async function sellCommand(
  context: CommandContext,
  args: readonly string[],
): Promise<CommandResult> {
  return runOrder(context, "sell", args, false)
}

function tradesCommand(context: CommandContext, args: readonly string[]): CommandResult {
  const filter = args[0]?.toUpperCase()
  const matches = context
    .trading()
    .trades.filter(
      (trade) => filter === undefined || trade.code === filter || trade.code.endsWith(filter),
    )
  if (matches.length === 0)
    return output("成交记录", [filter === undefined ? "暂无成交" : `暂无 ${filter} 的成交`])
  const lines: string[] = []
  for (let index = matches.length - 1; index >= 0 && lines.length < 8; index--) {
    const trade = matches[index]
    if (trade === undefined) continue
    const side = trade.side === "buy" ? "买入" : "卖出"
    lines.push(
      `${trade.id} ${side} ${trade.code} ${trade.quantity}股 @ ${money(trade.price)} 费用 ${money(trade.totalFees)}`,
    )
  }
  return output("成交记录", lines)
}

function accountCommand(context: CommandContext, args: readonly string[]): CommandResult {
  if (args[0] !== "reset") return error("仅支持 reset 操作", "/account reset confirm")
  if (args[1] !== "confirm") {
    return output("账户重置", [
      "需要确认：/account reset confirm",
      "此操作会清空全部持仓和成交记录",
    ])
  }
  const service = context.trading()
  service.reset()
  context.portfolioChanged()
  return output("账户重置", [`模拟账户已重置为 ${money(service.snapshot.initialCapital)}`])
}

export const TRADING_COMMANDS: readonly AppCommand[] = [
  {
    name: "preview",
    aliases: [],
    category: "portfolio",
    usage: "/preview <buy|sell> <code> <quantity|all>",
    description: "预览模拟交易费用和资金变化",
    execute: previewCommand,
  },
  {
    name: "buy",
    aliases: [],
    category: "portfolio",
    usage: "/buy <code> <quantity>",
    description: "按最新行情模拟买入",
    execute: buyCommand,
  },
  {
    name: "sell",
    aliases: [],
    category: "portfolio",
    usage: "/sell <code> <quantity|all>",
    description: "按最新行情模拟卖出",
    execute: sellCommand,
  },
  {
    name: "trades",
    aliases: [],
    category: "portfolio",
    usage: "/trades [code]",
    description: "查看最近模拟成交",
    execute: tradesCommand,
  },
  {
    name: "account",
    aliases: [],
    category: "portfolio",
    usage: "/account reset confirm",
    description: "重置模拟账户",
    execute: accountCommand,
  },
]
