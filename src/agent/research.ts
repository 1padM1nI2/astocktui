import { Agent, type AgentMessage } from "@oh-my-pi/pi-agent-core"
import type { CommandContext } from "../commands/commands"
import { resolveAgentModelChain } from "./pi-agent"
import { PiAgentDriver } from "./pi-agent-driver"
import { createResearchAgentTools } from "./research-tools"

/** 只读调研子任务的系统提示，经 PiAgentDriver 的 promptExtras 追加到基础提示之后 */
export const RESEARCH_SYSTEM_PROMPT: readonly string[] = [
  "你现在是一个只读投研分析子任务，为 A 股个人投资者撰写定时复盘报告。",
  "工作方式：先用 refresh_data 刷新行情与新闻，再读取大盘、自选股、持仓、新闻和记忆，交叉整理后给出结论。",
  "严格只读：不能交易、不能修改自选股/定时任务/条件单/记忆，也不能写文件；报告由调用方负责落盘。",
  "输出为中文 markdown 复盘报告，建议结构：市场概览、持仓与自选股、要闻解读、风险与关注。",
  "报告末尾必须附一节标题为「## 摘要」的小结，不超过 10 行，用于回流主对话展示。",
]

export interface ResearchRunHandle {
  run(input: string): Promise<void>
  finalText(): string
}

export type ResearchRunnerFactory = (deps: {
  readonly context: CommandContext
  readonly systemPrompt: readonly string[]
}) => ResearchRunHandle

/**
 * 运行一次只读调研子任务：独立 Agent + 只读工具集，不带 sessionStore、emit 丢弃。
 * 返回最终 assistant 文本（markdown 报告全文），空产出视为失败。
 */
export async function runResearchTask(
  context: CommandContext,
  prompt: string,
  factory: ResearchRunnerFactory = defaultResearchRunner,
): Promise<string> {
  const handle = factory({ context, systemPrompt: RESEARCH_SYSTEM_PROMPT })
  await handle.run(prompt)
  const text = handle.finalText().trim()
  if (text.length === 0) throw new Error("调研子任务未产出任何报告内容")
  return text
}

function defaultResearchRunner(deps: {
  readonly context: CommandContext
  readonly systemPrompt: readonly string[]
}): ResearchRunHandle {
  const resolved = resolveAgentModelChain()
  const primary = resolved.chain[0]
  if (resolved.error !== null || primary === undefined)
    throw new Error(resolved.error ?? "模型链为空")
  const tools = [...createResearchAgentTools(deps.context)]
  const agent = new Agent({
    initialState: {
      systemPrompt: [...deps.systemPrompt],
      model: primary.model,
      tools,
    },
    ...(resolved.configuredApiKey === undefined
      ? {}
      : { getApiKey: () => resolved.configuredApiKey }),
    hideThinkingSummary: true,
  })
  // driver 会把基础 SYSTEM_PROMPT 与 promptExtras 组合，调研角色提示经 promptExtras 注入
  const driver = new PiAgentDriver(
    agent,
    resolved.chain,
    new Map(tools.map((tool) => [tool.name, tool.label])),
    () => [...deps.systemPrompt, ...(deps.context.memory?.().promptSupplement() ?? [])],
  )
  return {
    run: (input) => driver.run(input, () => {}),
    finalText: () => lastAssistantText(agent.state.messages as readonly AgentMessage[]),
  }
}

function lastAssistantText(messages: readonly AgentMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message === undefined || message.role !== "assistant") continue
    let text = ""
    for (const block of message.content) {
      if (block.type === "text") text += block.text
    }
    if (text.trim().length > 0) return text
  }
  return ""
}
