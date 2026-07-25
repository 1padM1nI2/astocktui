import type { AppCommand, CommandResult } from "./commands"
import { isAshareCode, normalizeMarketCode } from "./market-code"
import type { OrderBookLevel, StockDetail } from "./stock-detail"

const USAGE = "/quote <代码>"

function output(title: string, lines: readonly string[]): CommandResult {
  return { kind: "output", title, lines }
}

function formatAmount(value: number): string {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿`
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`
  return `${Math.round(value)}`
}

function formatLevel(label: string, level: OrderBookLevel): string {
  return `${label} ${level.price.toFixed(2)} ×${formatAmount(level.volume)}手`
}

function detailLines(detail: StockDetail, price: number | undefined): string[] {
  const lines: string[] = []
  const basics: string[] = []
  if (detail.open !== undefined) basics.push(`今开 ${detail.open.toFixed(2)}`)
  if (detail.limitUp !== undefined && detail.limitDown !== undefined)
    basics.push(`涨停 ${detail.limitUp.toFixed(2)} · 跌停 ${detail.limitDown.toFixed(2)}`)
  if (detail.week52High !== undefined && detail.week52Low !== undefined)
    basics.push(`52周 ${detail.week52Low.toFixed(2)} ~ ${detail.week52High.toFixed(2)}`)
  if (basics.length > 0) lines.push(basics.join(" · "))

  const volume: string[] = []
  if (detail.volume !== undefined) volume.push(`量 ${formatAmount(detail.volume)}手`)
  if (detail.turnover !== undefined)
    volume.push(
      `成交额 ${detail.turnover >= 10_000 ? `${(detail.turnover / 10_000).toFixed(1)}亿` : `${Math.round(detail.turnover)}万`}`,
    )
  if (detail.averagePrice !== undefined) volume.push(`均价 ${detail.averagePrice.toFixed(2)}`)
  if (detail.volumeRatio !== undefined) volume.push(`量比 ${detail.volumeRatio.toFixed(2)}`)
  if (volume.length > 0) lines.push(volume.join(" · "))

  const ratios: string[] = []
  if (detail.turnoverRate !== undefined) ratios.push(`换手 ${detail.turnoverRate.toFixed(2)}%`)
  if (detail.amplitude !== undefined) ratios.push(`振幅 ${detail.amplitude.toFixed(2)}%`)
  if (detail.peTtm !== undefined) ratios.push(`PE ${detail.peTtm.toFixed(1)}`)
  if (detail.pb !== undefined) ratios.push(`PB ${detail.pb.toFixed(2)}`)
  if (ratios.length > 0) lines.push(ratios.join(" · "))

  const caps: string[] = []
  if (detail.totalMarketCap !== undefined)
    caps.push(
      `总市值 ${detail.totalMarketCap >= 10_000 ? `${(detail.totalMarketCap / 10_000).toFixed(2)}万亿` : `${detail.totalMarketCap.toFixed(0)}亿`}`,
    )
  if (detail.circMarketCap !== undefined)
    caps.push(
      `流通 ${detail.circMarketCap >= 10_000 ? `${(detail.circMarketCap / 10_000).toFixed(2)}万亿` : `${detail.circMarketCap.toFixed(0)}亿`}`,
    )
  if (caps.length > 0) lines.push(caps.join(" · "))

  const asks = detail.asks ?? []
  const bids = detail.bids ?? []
  if (asks.length > 0 || bids.length > 0) {
    const labels5 = ["卖五", "卖四", "卖三", "卖二", "卖一"]
    const askLines = [...asks]
      .reverse()
      .map((level, index) => formatLevel(labels5[index] ?? "卖", level))
    const bidLabels = ["买一", "买二", "买三", "买四", "买五"]
    const bidLines = bids.map((level, index) => formatLevel(bidLabels[index] ?? "买", level))
    lines.push(
      ...askLines,
      ...(price === undefined ? [] : [`—— 现价 ${price.toFixed(2)} ——`]),
      ...bidLines,
    )
  }
  return lines
}

export const QUOTE_COMMANDS: readonly AppCommand[] = [
  {
    name: "quote",
    aliases: [],
    category: "data",
    usage: USAGE,
    description: "查看个股详情（五档、52 周、估值与市值）",
    execute: async (context, args) => {
      const raw = args[0]
      if (raw === undefined) return output("命令错误", [`用法 ${USAGE}`])
      const code = normalizeMarketCode(raw)
      if (code === null) return output("命令错误", [`代码无效：${raw}`, `用法 ${USAGE}`])
      if (!isAshareCode(code)) return output("命令错误", ["个股详情仅支持 A 股代码"])

      const [quote, detail] = await Promise.all([
        context.quote(code).catch(() => undefined),
        context.quoteDetail?.(code).catch(() => undefined),
      ])
      if (quote === undefined && detail === undefined)
        return output("命令错误", [`无法获取 ${code} 的行情，请检查代码或稍后重试`])

      const name = quote?.name ?? detail?.name ?? code
      const price = quote?.price ?? detail?.open
      const title =
        price === undefined ? `${name} ${code}` : `${name} ${code} · ${price.toFixed(2)}`
      if (detail === undefined) return output(title, ["详情数据暂不可用"])
      return output(title, detailLines(detail, quote?.price))
    },
  },
]
