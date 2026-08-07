import type { AgentTool, AgentToolResult } from "@oh-my-pi/pi-agent-core"
import { z } from "@oh-my-pi/pi-ai"
import type { CommandContext } from "../commands/commands"
import type { MemoryInput, MemoryKind } from "./memory"
import type { MemoryService } from "./memory-service"

function result(value: unknown): AgentToolResult<unknown> {
  return { content: [{ type: "text", text: JSON.stringify(value) }], details: value }
}

interface RememberInput {
  readonly kind: MemoryKind
  readonly content: string
  readonly tags?: readonly string[]
}

interface ReplaceInput {
  readonly entries: readonly MemoryInput[]
}

const kindSchema = z.enum(["pattern", "evaluation"])
const entrySchema = z.object({
  id: z.string().optional(),
  kind: kindSchema,
  content: z.string().min(1),
  tags: z.array(z.string()).optional(),
})

export function createMemoryAgentTools(context: CommandContext): readonly AgentTool[] {
  const service = (): MemoryService => {
    const memory = context.memory?.()
    if (memory === undefined) throw new Error("记忆服务尚未就绪")
    return memory
  }
  return [
    {
      name: "remember_memory",
      label: "记录记忆",
      description:
        "把一条有价值的规律（pattern）或操作评估（evaluation）写入长期记忆；内容精炼、可复用，不超过 500 字。",
      parameters: z.object({
        kind: kindSchema,
        content: z.string().min(1),
        tags: z.array(z.string()).optional(),
      }),
      intent: "omit",
      approval: "write",
      execute: async (_id, params) => {
        const input = params as RememberInput
        return result(
          service().remember({ kind: input.kind, content: input.content, tags: input.tags ?? [] }),
        )
      },
    },
    {
      name: "list_memories",
      label: "读取记忆",
      description: "读取全部长期记忆（系统成交评估、主动记录的规律与做梦整理结果）。",
      parameters: z.object({}),
      intent: "omit",
      approval: "read",
      execute: async () => {
        const entries = service().list()
        return result({ total: entries.length, entries })
      },
    },
    {
      name: "forget_memory",
      label: "删除记忆",
      description: "按 id 删除一条长期记忆，例如 MEM-0001。",
      parameters: z.object({ id: z.string().min(1) }),
      intent: "omit",
      approval: "write",
      execute: async (_id, params) => {
        const input = params as { readonly id: string }
        return result({ ok: service().forget(input.id), id: input.id })
      },
    },
    {
      name: "replace_memories",
      label: "重写记忆",
      description:
        "做梦整理后一次性写回完整记忆列表：仍有效的条目保留其 id，新增归纳条目不带 id；未包含的旧条目将被移除。",
      parameters: z.object({ entries: z.array(entrySchema) }),
      intent: "omit",
      approval: "write",
      concurrency: "exclusive",
      execute: async (_id, params) => {
        const input = params as ReplaceInput
        const memory = service()
        const entries = memory.replaceAll(input.entries)
        return result({ total: entries.length, lastDreamAt: memory.lastDreamAt, entries })
      },
    },
  ]
}
