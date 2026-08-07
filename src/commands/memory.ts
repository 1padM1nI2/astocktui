import { MEMORY_KIND_LABELS, MEMORY_SOURCE_LABELS } from "../agent/memory"
import { shanghaiDateTime } from "../trading/calendar"
import type { AppCommand, CommandResult } from "./commands"

const DREAM_PROMPT =
  "[记忆整理·做梦] 现在是闲暇时段。请整理你的长期记忆：" +
  "1. 调用 list_memories 读取全部记忆（系统成交评估与你记录的规律）。" +
  "2. 梳理：合并重复或相似的规律；把多条同类操作评估归纳为更通用的规律（保留关键数据）；删除已被证伪、过时或空泛的条目。" +
  "3. 调用 replace_memories 一次性写回整理后的完整列表（仍有效条目保留 id，新归纳条目不带 id）。" +
  "4. 用不超过三句话总结本次整理。不要执行交易或修改自选股。"

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
        const sink = context.systemEvents?.()
        if (sink === undefined) return output("长期记忆", ["自动化服务尚未就绪"])
        const now = new Date()
        const result = sink.enqueue({
          kind: "dream",
          dedupeKey: `dream:${shanghaiDateTime(now).date}`,
          title: "记忆整理",
          createdAt: now.toISOString(),
          prompt: DREAM_PROMPT,
        })
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
