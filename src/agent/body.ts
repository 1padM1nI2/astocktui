import { ANSI } from "../app/colors"
import { fitLine } from "../app/width"
import type { AgentExchangeView, AgentSessionView, AgentToolView } from "./controller"
import { renderAgentMarkdown } from "./markdown"

export const EMPTY_AGENT_SESSION: AgentSessionView = {
  status: "idle",
  modelLabel: "Pi Agent",
  userInput: "",
  answer: "",
  tools: [],
  error: null,
  history: [],
}

export function renderAgentBody(view: AgentSessionView, width: number): readonly string[] {
  const safeWidth = Math.max(1, width | 0)
  if (view.status === "unconfigured") return unconfiguredBody(view)
  const lines: string[] = []
  for (const exchange of view.history) appendExchange(lines, exchange, safeWidth)
  if (view.userInput.length === 0) lines.push(...waitingBody(view))
  else appendActiveExchange(lines, view, safeWidth)
  return lines.map((line) => fitLine(line, safeWidth))
}

function unconfiguredBody(view: AgentSessionView): string[] {
  return [
    `${ANSI.brightWhite}Assistant${ANSI.reset} · Pi Agent 尚未配置`,
    `${ANSI.brightBlack}模型${ANSI.reset} ${view.modelLabel}`,
    `${ANSI.brightRed}${view.error ?? "缺少模型配置"}${ANSI.reset}`,
    "  设置 ASTOCK_AGENT_PROVIDER 与 ASTOCK_AGENT_MODEL，",
    "  并配置对应供应商 API Key 后重新启动。",
  ]
}

function waitingBody(view: AgentSessionView): string[] {
  return [
    `${ANSI.brightWhite}Assistant${ANSI.reset} · Pi Agent 已就绪`,
    `${ANSI.brightBlack}模型${ANSI.reset} ${view.modelLabel}`,
    "  可读取实时行情、财经新闻、模拟持仓和成交记录。",
    `${ANSI.brightBlack}├─ 能力${ANSI.reset} 多源行情与风险分析`,
    `${ANSI.brightBlack}├─ 能力${ANSI.reset} 自选股和工作区操作`,
    `${ANSI.brightBlack}└─ 能力${ANSI.reset} 模拟交易预览与自动执行`,
  ]
}

function appendExchange(lines: string[], exchange: AgentExchangeView, width: number): void {
  if (lines.length > 0) lines.push("")
  appendUser(lines, exchange.user)
  appendTools(lines, exchange.tools)
  if (exchange.answer.length === 0) return
  lines.push(`${ANSI.brightWhite}Assistant${ANSI.reset} · Pi Agent`)
  for (const part of renderAgentMarkdown(exchange.answer, Math.max(1, width - 2), false)) {
    lines.push(`  ${part}`)
  }
}

function appendActiveExchange(lines: string[], view: AgentSessionView, width: number): void {
  if (lines.length > 0) lines.push("")
  appendUser(lines, view.userInput)
  appendTools(lines, view.tools)
  if (view.answer.length > 0) {
    lines.push(`${ANSI.brightWhite}Assistant${ANSI.reset} · Pi Agent`)
    const streaming = view.status === "streaming" || view.status === "tool-running"
    for (const part of renderAgentMarkdown(view.answer, Math.max(1, width - 2), streaming)) {
      lines.push(`  ${part}`)
    }
  } else if (view.status === "streaming" || view.status === "tool-running") {
    lines.push(`${ANSI.brightWhite}Assistant${ANSI.reset} · 正在分析…`)
  }
  if (view.error !== null) lines.push(`${ANSI.brightRed}错误 · ${view.error}${ANSI.reset}`)
}

function appendUser(lines: string[], user: string): void {
  const parts = user.split("\n")
  lines.push(`${ANSI.brightWhite}User${ANSI.reset} · ${parts[0] ?? ""}`)
  for (const part of parts.slice(1)) lines.push(`  ${part}`)
}

function appendTools(lines: string[], tools: readonly AgentToolView[]): void {
  for (let index = 0; index < tools.length; index++) {
    const tool = tools[index]
    if (tool === undefined) continue
    const branch = index === tools.length - 1 ? "└─" : "├─"
    const status =
      tool.status === "running"
        ? `${ANSI.yellow}运行中${ANSI.reset}`
        : tool.status === "error"
          ? `${ANSI.brightRed}失败${ANSI.reset}`
          : `${ANSI.brightWhite}✓ 完成${ANSI.reset}`
    lines.push(`${ANSI.brightBlack}${branch}${ANSI.reset} Tool · ${tool.label}  ${status}`)
    if (tool.summary !== undefined) {
      lines.push(`${ANSI.brightBlack}│  ${tool.summary}${ANSI.reset}`)
    }
  }
}
