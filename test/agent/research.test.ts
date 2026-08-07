import { describe, expect, test } from "bun:test"
import { RESEARCH_SYSTEM_PROMPT, runResearchTask } from "../../src/agent/research"
import type { CommandContext } from "../../src/commands/commands"

const context = undefined as unknown as CommandContext

describe("只读调研子任务", () => {
  test("系统提示要求只读、输出 markdown 报告并以「摘要」节收尾", () => {
    const prompt = RESEARCH_SYSTEM_PROMPT.join("\n")
    expect(prompt).toContain("只读")
    expect(prompt).toContain("markdown")
    expect(prompt).toContain("摘要")
  })

  test("运行后返回最终 assistant 文本", async () => {
    const runs: string[] = []
    const text = await runResearchTask(context, "复盘今日市场", ({ systemPrompt }) => {
      expect(systemPrompt).toBe(RESEARCH_SYSTEM_PROMPT)
      return {
        run: async (input) => {
          runs.push(input)
        },
        finalText: () => "# 收盘复盘\n\n## 摘要\n- 市场缩量上涨\n",
      }
    })
    expect(runs).toEqual(["复盘今日市场"])
    expect(text).toContain("# 收盘复盘")
    expect(text).toContain("## 摘要")
  })

  test("子任务没有产出任何文本时报错", async () => {
    await expect(
      runResearchTask(context, "复盘", () => ({
        run: async () => {},
        finalText: () => "   ",
      })),
    ).rejects.toThrow("未产出")
  })
})
