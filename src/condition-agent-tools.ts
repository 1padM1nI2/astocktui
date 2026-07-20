import type { AgentTool, AgentToolResult } from "@oh-my-pi/pi-agent-core"
import { z } from "@oh-my-pi/pi-ai"
import type { CommandContext } from "./commands"

function result(value: unknown): AgentToolResult<unknown> {
  return { content: [{ type: "text", text: JSON.stringify(value) }], details: value }
}

export function createConditionAgentTools(context: CommandContext): readonly AgentTool[] {
  return [
    {
      name: "manage_condition_order",
      label: "管理模拟盘条件单",
      description: "查看、暂停、恢复或取消本地模拟盘条件单；条件触发后由 Agent 决定是否交易。",
      parameters: z.object({
        action: z.enum(["list", "cancel", "pause", "resume"]),
        id: z.string().optional(),
      }),
      intent: "omit",
      approval: "write",
      execute: async (_id, params) => {
        const service = context.conditionalOrders?.()
        if (service === undefined) throw new Error("条件单服务尚未就绪")
        const input = params as { action: "list" | "cancel" | "pause" | "resume"; id?: string }
        if (input.action === "cancel") service.cancel(input.id ?? "")
        if (input.action === "pause") service.pause(input.id ?? "")
        if (input.action === "resume") service.resume(input.id ?? "")
        return result(service.orders)
      },
    },
  ]
}
