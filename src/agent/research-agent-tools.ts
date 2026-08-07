import type { AgentTool } from "@oh-my-pi/pi-agent-core"
import type { CommandContext } from "../commands/commands"
import { createAStockAgentTools } from "./agent-tools"

/** refresh_data 语义是触发刷新并等待完成，调研子任务用它先拿到新鲜快照，单独放行 */
const EXTRA_TOOL_NAMES: ReadonlySet<string> = new Set(["refresh_data"])

/**
 * 只读调研子任务工具集：approval === "read" 的工具外加 refresh_data。
 * 交易、文件写入、记忆写入、任务/条件单/MCP 管理与 manage_watchlist（动态分级）一律排除。
 */
export function createResearchAgentTools(context: CommandContext): readonly AgentTool[] {
  return createAStockAgentTools(context).filter(
    (tool) => tool.approval === "read" || EXTRA_TOOL_NAMES.has(tool.name),
  )
}
