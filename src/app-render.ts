import type { Component } from "@oh-my-pi/pi-tui"
import type { AgentSessionView } from "./agent-controller"
import type { CommandPromptView } from "./command-prompt"
import type { WorkspaceName } from "./commands"
import { AgentWorkspace } from "./components/agent"
import { fitLine } from "./width"
import { renderWorkspacePanel, zipColumns } from "./workspace-layout"

export const MARKET = 0
export const PORTFOLIO = 1
export const NEWS = 2
export const AGENT = 3
export const TAB_COUNT = 4
export const WORKSPACE_INDEX: Readonly<Record<WorkspaceName, number>> = {
  market: MARKET,
  portfolio: PORTFOLIO,
  news: NEWS,
  agent: AGENT,
}
export const WORKSPACE_NAMES: readonly WorkspaceName[] = ["market", "portfolio", "news", "agent"]

export interface AppFrameState {
  readonly activeTab: number
  readonly viewportRows: number
  readonly market: Component
  readonly portfolio: Component
  readonly news: Component
  readonly prompt: CommandPromptView
  readonly agent: AgentSessionView
  readonly agentScrollOffset: number
  readonly tradeHistory: Component
}

export function renderAppFrame(width: number, state: AppFrameState): readonly string[] {
  const safeWidth = Math.max(0, width | 0)
  const viewportRows = Math.max(1, state.viewportRows | 0)
  const lines: string[] = []
  if (safeWidth >= 160) renderWide(lines, safeWidth, viewportRows, state)
  else lines.push(...renderActive(safeWidth, viewportRows, state))
  return lines.map((line) => fitLine(line, safeWidth))
}

function renderWide(
  lines: string[],
  width: number,
  viewportRows: number,
  state: AppFrameState,
): void {
  const agentHeight = Math.min(
    viewportRows,
    Math.max(Math.ceil(viewportRows / 2), Math.min(12, viewportRows)),
  )
  const topHeight = viewportRows - agentHeight
  const available = width - 2
  const marketWidth = Math.floor(available * 0.34)
  const portfolioWidth = Math.floor(available * 0.26)
  const newsWidth = available - marketWidth - portfolioWidth
  const columns = [
    {
      lines: renderWorkspacePanel(state.market, marketWidth, topHeight, state.activeTab === MARKET),
      width: marketWidth,
    },
    {
      lines: renderWorkspacePanel(
        state.portfolio,
        portfolioWidth,
        topHeight,
        state.activeTab === PORTFOLIO,
      ),
      width: portfolioWidth,
    },
    {
      lines: renderWorkspacePanel(state.news, newsWidth, topHeight, state.activeTab === NEWS),
      width: newsWidth,
    },
  ]
  lines.push(...zipColumns(columns, width, " ", topHeight))
  const bottomAvailable = width - 1
  const tradeHistoryWidth = Math.floor(bottomAvailable * 0.33)
  const agentWidth = bottomAvailable - tradeHistoryWidth
  const bottomColumns = [
    {
      lines: new AgentWorkspace(
        state.prompt.input,
        state.activeTab === AGENT,
        state.prompt,
        state.agent,
        state.agentScrollOffset,
      ).renderAtHeight(agentWidth, agentHeight),
      width: agentWidth,
    },
    {
      lines: renderWorkspacePanel(state.tradeHistory, tradeHistoryWidth, agentHeight, false),
      width: tradeHistoryWidth,
    },
  ]
  lines.push(...zipColumns(bottomColumns, width, " ", agentHeight))
}

function renderActive(width: number, height: number, state: AppFrameState): readonly string[] {
  if (state.activeTab === MARKET) return renderWorkspacePanel(state.market, width, height, true)
  if (state.activeTab === PORTFOLIO)
    return renderWorkspacePanel(state.portfolio, width, height, true)
  if (state.activeTab === NEWS) return renderWorkspacePanel(state.news, width, height, true)
  return new AgentWorkspace(
    state.prompt.input,
    true,
    state.prompt,
    state.agent,
    state.agentScrollOffset,
  ).renderAtHeight(width, height)
}
