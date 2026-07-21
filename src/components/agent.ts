import type { Component } from "@oh-my-pi/pi-tui"
import { visibleWidth, wrapTextWithAnsi } from "@oh-my-pi/pi-tui"
import { EMPTY_AGENT_SESSION, renderAgentBody } from "../agent-body"
import type { AgentSessionView } from "../agent-controller"
import { ANSI } from "../colors"
import type { CommandPromptView } from "../command-prompt"
import type { ScheduledTaskSummary } from "../scheduled-task-service"
import { fitLine } from "../width"
import { renderFramedPanel } from "./framed-panel"

const DEFAULT_HEIGHT = 15
const MAX_INPUT_LINES = 3
const INPUT_PROMPT = `${ANSI.cyan}>_${ANSI.reset} `
const INPUT_PROMPT_WIDTH = 3

function alignSides(left: string, right: string, width: number): string {
  const gap = width - visibleWidth(left) - visibleWidth(right)
  if (gap < 1) return fitLine(left, width)
  return `${left}${" ".repeat(gap)}${right}`
}

function agentInputLines(input: string, cursor: string, right: string, width: number): string[] {
  const contentWidth = Math.max(1, width - INPUT_PROMPT_WIDTH)
  const wrapped = input.split("\n").flatMap((segment) => wrapTextWithAnsi(segment, contentWidth))
  const truncated = wrapped.length > MAX_INPUT_LINES
  const visible = truncated ? wrapped.slice(-MAX_INPUT_LINES) : wrapped
  return visible.map((segment, index) => {
    const prefix =
      index === 0 && !truncated
        ? INPUT_PROMPT
        : index === 0
          ? `${ANSI.brightBlack}…${ANSI.reset}  `
          : "   "
    let line = `${prefix}${segment}`
    if (index === visible.length - 1) line += cursor
    if (index === 0 && right.length > 0) return alignSides(fitLine(line, width), right, width)
    return fitLine(line, width)
  })
}

function ruleWithLabel(label: string, width: number): string {
  const prefix = `─ ${label} `
  const fill = Math.max(0, width - visibleWidth(prefix))
  return `${ANSI.brightBlack}${prefix}${"─".repeat(fill)}${ANSI.reset}`
}

function agentStatusLabel(status: AgentSessionView["status"]): string {
  if (status === "unconfigured") return "未配置"
  if (status === "streaming") return "分析中"
  if (status === "tool-running") return "工具调用"
  if (status === "completed") return "已完成"
  if (status === "error") return "错误"
  return "就绪"
}

export class AgentWorkspace implements Component {
  readonly #input: string
  readonly #agentView: AgentSessionView
  readonly #active: boolean
  readonly #commandView: CommandPromptView | undefined
  readonly #scrollOffset: number
  readonly #memoryCount: number
  readonly #scheduledTasks: ScheduledTaskSummary

  constructor(
    input: string,
    active = true,
    commandView?: CommandPromptView,
    agentView: AgentSessionView = EMPTY_AGENT_SESSION,
    scrollOffset = 0,
    memoryCount = 0,
    scheduledTasks: ScheduledTaskSummary = {
      enabledCount: 0,
      nextTask: null,
      lastTask: null,
      diagnostic: null,
    },
  ) {
    this.#input = input
    this.#active = active
    this.#commandView = commandView
    this.#agentView = agentView
    this.#scrollOffset = Number.isFinite(scrollOffset) ? Math.max(0, Math.trunc(scrollOffset)) : 0
    this.#memoryCount = Number.isFinite(memoryCount) ? Math.max(0, Math.trunc(memoryCount)) : 0
    this.#scheduledTasks = scheduledTasks
  }

  render(width: number): readonly string[] {
    return this.renderAtHeight(width, DEFAULT_HEIGHT)
  }

  renderAtHeight(width: number, height: number): readonly string[] {
    const safeWidth = Math.max(0, width | 0)
    const safeHeight = Math.max(0, height | 0)
    const inputCursor = this.#active ? `${ANSI.reverse} ${ANSI.reset}` : ""
    if (safeHeight === 0) return []
    if (safeHeight < 3 || safeWidth < 5) {
      const compact = [
        "Agent / 上下文",
        agentInputLines(this.#input, inputCursor, "", safeWidth)[0] ?? "",
      ]
      return Array.from({ length: safeHeight }, (_, index) =>
        fitLine(compact[index] ?? "", safeWidth),
      )
    }

    const contentHeight = safeHeight - 2
    const contentWidth = Math.max(1, safeWidth - 4)
    const paletteOpen = this.#commandView?.isPaletteOpen === true
    const inputLines = agentInputLines(
      this.#input,
      inputCursor,
      paletteOpen ? "" : `${ANSI.brightBlack}Enter 发送${ANSI.reset}`,
      contentWidth,
    )
    const bodyCapacity = Math.max(0, contentHeight - 2 - inputLines.length)
    const statusColor = this.#active ? ANSI.cyan : ANSI.brightBlack
    let status = `${statusColor}● 就绪${ANSI.reset}`
    if (paletteOpen) {
      status = `${statusColor}● 命令${ANSI.reset}`
    } else if (this.#commandView?.result !== null && this.#commandView?.result !== undefined) {
      const label = this.#commandView.result.title === "命令执行中" ? "执行中" : "已执行"
      status = `${statusColor}● ${label}${ANSI.reset}`
    } else {
      const label = agentStatusLabel(this.#agentView.status)
      status = `${statusColor}● ${label}${ANSI.reset}`
    }
    const focusMarker = this.#active ? "◆ " : ""
    const title = alignSides(`${focusMarker}Agent / 上下文`, status, Math.max(0, safeWidth - 5))
    let taskSummary = `任务 ${this.#scheduledTasks.enabledCount}`
    if (this.#scheduledTasks.diagnostic !== null) taskSummary = "任务存储异常"
    else if (this.#scheduledTasks.nextTask !== null)
      taskSummary += ` · 下次 ${this.#scheduledTasks.nextTask.name}`
    const lines: string[] = [
      fitLine(
        `${ANSI.brightBlack}会话 1 · ${taskSummary} · 记忆 ${this.#memoryCount} 条 · 模型 ${this.#agentView.modelLabel} · 上下文 行情 + 持仓 + 财经新闻${ANSI.reset}`,
        contentWidth,
      ),
    ]

    const body = this.#activeBody(bodyCapacity, contentWidth)
    const maxScrollOffset = Math.max(0, body.length - bodyCapacity)
    const scrollOffset = paletteOpen ? 0 : Math.min(this.#scrollOffset, maxScrollOffset)
    const bodyStart = Math.max(0, body.length - bodyCapacity - scrollOffset)
    const bodyPadding = paletteOpen ? Math.max(0, bodyCapacity - body.length) : 0
    for (let index = 0; index < bodyCapacity; index++) {
      lines.push(index < bodyPadding ? "" : (body[bodyStart + index - bodyPadding] ?? ""))
    }

    lines.push(
      paletteOpen
        ? `${ANSI.brightBlack}↑↓ 选择 · Tab 补全 · Esc 关闭${ANSI.reset}`
        : body.length > bodyCapacity
          ? ruleWithLabel("↑↓ 滚动 · PgUp/PgDn 翻页 · Home/End 首尾", contentWidth)
          : `${ANSI.brightBlack}${"─".repeat(contentWidth)}${ANSI.reset}`,
    )
    lines.push(...inputLines)

    return renderFramedPanel(title, lines, safeWidth, safeHeight, this.#active ? "accent" : "muted")
  }

  #activeBody(capacity: number, width: number): readonly string[] {
    const commandView = this.#commandView
    if (commandView?.isPaletteOpen === true) {
      const lines = [`${ANSI.brightWhite}Command${ANSI.reset} · 命令列表`]
      if (commandView.suggestions.length === 0) {
        lines.push(`${ANSI.brightBlack}没有匹配命令 · 输入 /help 查看帮助${ANSI.reset}`)
        return lines
      }
      const visibleCount = Math.max(0, capacity - 1)
      if (visibleCount === 0) return lines
      const start = Math.min(
        Math.max(0, commandView.suggestions.length - visibleCount),
        Math.max(0, commandView.selectedIndex - visibleCount + 1),
      )
      const end = Math.min(commandView.suggestions.length, start + visibleCount)
      for (let index = start; index < end; index++) {
        const command = commandView.suggestions[index]
        if (command === undefined) continue
        const marker = index === commandView.selectedIndex ? "›" : " "
        let line = `${marker} ${command.usage}  ${command.description}`
        if (index === commandView.selectedIndex) {
          line = `${ANSI.cyan}${ANSI.reverse}${line}${ANSI.reset}`
        }
        lines.push(line)
      }
      return lines
    }
    if (commandView?.result !== null && commandView?.result !== undefined) {
      return [
        `${ANSI.brightWhite}Command${ANSI.reset} · ${commandView.result.title}`,
        ...commandView.result.lines,
      ]
    }
    return renderAgentBody(this.#agentView, width)
  }
}
