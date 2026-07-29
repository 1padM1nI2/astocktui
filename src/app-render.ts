import type { Component } from "@oh-my-pi/pi-tui"
import type { AgentSessionView } from "./agent-controller"
import type { CommandPromptView } from "./command-prompt"
import type { WorkspaceName } from "./commands"
import { AgentWorkspace } from "./components/agent"
import { agentPanelHeight, layoutTier } from "./layout-tiers"
import type { ScheduledTaskSummary } from "./scheduled-task-service"
import { fitLine } from "./width"
import { renderWorkspacePanel, zipColumns } from "./workspace-layout"

export const MARKET = 0
export const PORTFOLIO = 1
export const NEWS = 2
export const AGENT = 3
export const TRADE = 4
export const TAB_COUNT = 5
export const WORKSPACE_INDEX: Readonly<Record<WorkspaceName, number>> = {
  market: MARKET,
  portfolio: PORTFOLIO,
  news: NEWS,
  agent: AGENT,
  trade: TRADE,
}
export const WORKSPACE_NAMES: readonly WorkspaceName[] = [
  "market",
  "portfolio",
  "news",
  "agent",
  "trade",
]

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
  readonly memoryCount: number
  readonly scheduledTasks: ScheduledTaskSummary
}

export function renderAppFrame(width: number, state: AppFrameState): readonly string[] {
  const safeWidth = Math.max(0, width | 0)
  const viewportRows = Math.max(1, state.viewportRows | 0)
  const lines: string[] = []
  const tier = layoutTier(safeWidth)
  if (tier === "wide") renderWide(lines, safeWidth, viewportRows, state)
  else if (tier === "medium") renderMedium(lines, safeWidth, viewportRows, state)
  else lines.push(...renderActive(safeWidth, viewportRows, state))
  return lines.map((line) => fitLine(line, safeWidth))
}

function renderWide(
  lines: string[],
  width: number,
  viewportRows: number,
  state: AppFrameState,
): void {
  const agentHeight = agentPanelHeight(width, viewportRows)
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
        state.memoryCount,
        state.scheduledTasks,
      ).renderAtHeight(agentWidth, agentHeight),
      width: agentWidth,
    },
    {
      lines: renderWorkspacePanel(
        state.tradeHistory,
        tradeHistoryWidth,
        agentHeight,
        state.activeTab === TRADE,
      ),
      width: tradeHistoryWidth,
    },
  ]
  lines.push(...zipColumns(bottomColumns, width, " ", agentHeight))
}

function renderMedium(
  lines: string[],
  width: number,
  viewportRows: number,
  state: AppFrameState,
): void {
  const agentHeight = agentPanelHeight(width, viewportRows)
  const panelsRows = viewportRows - agentHeight
  const topHeight = Math.ceil(panelsRows / 2)
  const midHeight = panelsRows - topHeight
  const available = width - 1
  const leftWidth = Math.floor(available * 0.55)
  const rightWidth = available - leftWidth
  const topColumns = [
    {
      lines: renderWorkspacePanel(state.market, leftWidth, topHeight, state.activeTab === MARKET),
      width: leftWidth,
    },
    {
      lines: renderWorkspacePanel(
        state.portfolio,
        rightWidth,
        topHeight,
        state.activeTab === PORTFOLIO,
      ),
      width: rightWidth,
    },
  ]
  lines.push(...zipColumns(topColumns, width, " ", topHeight))
  const midColumns = [
    {
      lines: renderWorkspacePanel(state.news, leftWidth, midHeight, state.activeTab === NEWS),
      width: leftWidth,
    },
    {
      lines: renderWorkspacePanel(
        state.tradeHistory,
        rightWidth,
        midHeight,
        state.activeTab === TRADE,
      ),
      width: rightWidth,
    },
  ]
  lines.push(...zipColumns(midColumns, width, " ", midHeight))
  lines.push(
    ...new AgentWorkspace(
      state.prompt.input,
      state.activeTab === AGENT,
      state.prompt,
      state.agent,
      state.agentScrollOffset,
      state.memoryCount,
      state.scheduledTasks,
    ).renderAtHeight(width, agentHeight),
  )
}

function renderActive(width: number, height: number, state: AppFrameState): readonly string[] {
  if (state.activeTab === MARKET) return renderWorkspacePanel(state.market, width, height, true)
  if (state.activeTab === PORTFOLIO)
    return renderWorkspacePanel(state.portfolio, width, height, true)
  if (state.activeTab === NEWS) return renderWorkspacePanel(state.news, width, height, true)
  if (state.activeTab === TRADE)
    return renderWorkspacePanel(state.tradeHistory, width, height, true)
  return new AgentWorkspace(
    state.prompt.input,
    true,
    state.prompt,
    state.agent,
    state.agentScrollOffset,
    state.memoryCount,
    state.scheduledTasks,
  ).renderAtHeight(width, height)
}
