import { describe, expect, test } from "bun:test"
import { createResearchAgentTools } from "../../src/agent/research-tools"
import type { CommandContext } from "../../src/commands/commands"

// 工具列表在创建期不触碰 context，仅断言集合与分级
const context = undefined as unknown as CommandContext

describe("只读调研子任务工具集", () => {
  test("包含只读数据工具、refresh_data 与文件 read/list", () => {
    const names = createResearchAgentTools(context).map((tool) => tool.name)
    for (const expected of [
      "get_app_status",
      "get_market_snapshot",
      "get_market_overview",
      "get_financial_news",
      "get_portfolio",
      "get_hot_rank",
      "get_trade_history",
      "preview_trade",
      "refresh_data",
      "read",
      "list",
      "list_memories",
    ]) {
      expect(names).toContain(expected)
    }
  })

  test("排除写入、交易、审批与管理类工具", () => {
    const names = createResearchAgentTools(context).map((tool) => tool.name)
    for (const excluded of [
      "execute_trade",
      "reset_paper_account",
      "manage_watchlist",
      "focus_workspace",
      "write",
      "edit",
      "move",
      "mkdir",
      "delete",
      "manage_scheduled_task",
      "manage_condition_order",
      "manage_mcp_server",
      "remember_memory",
      "forget_memory",
      "replace_memories",
    ]) {
      expect(names).not.toContain(excluded)
    }
  })

  test("除 refresh_data 外全部为 read 分级", () => {
    for (const tool of createResearchAgentTools(context)) {
      if (tool.name === "refresh_data") continue
      expect(tool.approval).toBe("read")
    }
  })
})
