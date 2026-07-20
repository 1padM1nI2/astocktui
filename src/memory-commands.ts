import type { AppCommand, CommandResult } from "./commands"
import { MEMORY_KIND_LABELS, MEMORY_SOURCE_LABELS } from "./memory"

const output = (title: string, lines: readonly string[]): CommandResult => ({
  kind: "output",
  title,
  lines,
})

export const MEMORY_COMMANDS: readonly AppCommand[] = [
  {
    name: "memory",
    aliases: [],
    category: "system",
    usage: "/memory [list|clear|dream]",
    description: "查看或管理 Agent 长期记忆，手动触发做梦整理",
    execute: (context, args) => {
      const memory = context.memory?.()
      if (memory === undefined) return output("长期记忆", ["记忆服务尚未就绪"])
      const action = args[0] ?? "list"
      if (action === "clear") {
        memory.clear()
        return output("长期记忆", ["已清空全部记忆（系统成交评估标记保留，不会重放历史记录）"])
      }
      if (action === "dream") {
        const schedule = context.agentSchedule?.()
        if (schedule === undefined) return output("长期记忆", ["自动化服务尚未就绪"])
        const result = schedule.runNow("dream")
        return output("长期记忆", [
          result === "queued"
            ? "已触发记忆整理（做梦），Agent 空闲时自动执行"
            : "今日已整理过记忆，明天再试",
        ])
      }
      if (action !== "list") return output("命令错误", ["用法 /memory [list|clear|dream]"])
      const entries = memory.list()
      if (entries.length === 0) return output("长期记忆", ["暂无记忆"])
      const lines = [...entries]
        .reverse()
        .map(
          (entry) =>
            `[${entry.id} ${MEMORY_KIND_LABELS[entry.kind]}] ${entry.content}` +
            `（${MEMORY_SOURCE_LABELS[entry.source]} · ${entry.updatedAt.slice(0, 10)}）`,
        )
      if (memory.lastDreamAt !== null) lines.push(`上次做梦整理 ${memory.lastDreamAt.slice(0, 10)}`)
      return output(`长期记忆（${entries.length} 条）`, lines)
    },
  },
]
