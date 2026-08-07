import { describe, expect, test } from "bun:test"
import { stripVTControlCharacters } from "node:util"
import { visibleWidth } from "@oh-my-pi/pi-tui"
import type { AgentSessionView } from "../src/agent/agent-controller"
import { ANSI } from "../src/app/colors"
import { AgentWorkspace } from "../src/components/agent"

function expectLinesFit(lines: readonly string[], width: number): void {
  for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width)
}

describe("Agent 主聊天面板", () => {
  test("使用完整边框并将输入区固定在面板底部", () => {
    const lines = new AgentWorkspace("分析贵州茅台", true).renderAtHeight(100, 15)

    expect(lines).toHaveLength(15)
    expect(lines[0]).toContain("╭")
    expect(lines[0]).toContain("Agent / 上下文")
    expect(lines[0]).not.toContain("600519 贵州茅台")
    expect(lines[0]).toContain("╮")
    expect(lines.at(-1)).toContain("╯")
    expect(lines.at(-2)).toContain(">_")
    expect(lines.join("\n")).toContain("Pi Agent 已就绪")
    expect(lines.join("\n")).toContain("Enter 发送")
    expect(lines.join("\n")).not.toContain("Esc 取消")
    expectLinesFit(lines, 100)
  })

  test("焦点 Agent 在输入末尾渲染可见光标", () => {
    const activeInput = new AgentWorkspace("分析贵州茅台", true).renderAtHeight(80, 15).at(-2) ?? ""
    const inactiveInput =
      new AgentWorkspace("分析贵州茅台", false).renderAtHeight(80, 15).at(-2) ?? ""

    expect(activeInput).toContain(`分析贵州茅台${ANSI.reverse} ${ANSI.reset}`)
    expect(inactiveInput).not.toContain(ANSI.reverse)
  })

  test("副标题展示长期记忆条数", () => {
    const frame = new AgentWorkspace("", true, undefined, undefined, 0, 3)
      .renderAtHeight(100, 15)
      .join("\n")
    expect(frame).toContain("记忆 3 条")

    const empty = new AgentWorkspace("", true).renderAtHeight(100, 15).join("\n")
    expect(empty).toContain("记忆 0 条")
  })

  test("副标题展示并截断自定义定时任务摘要", () => {
    const lines = new AgentWorkspace("", true, undefined, undefined, 0, 0, {
      enabledCount: 2,
      nextTask: {
        id: "TASK-0001",
        name: "盘前风险检查任务名称很长",
        prompt: "",
        schedule: { kind: "interval", minutes: 5 },
        createdBy: "user",
        createdAt: "2026-07-17T01:00:00.000Z",
        updatedAt: "2026-07-17T01:00:00.000Z",
        enabled: true,
        nextRunAt: "2026-07-17T01:05:00.000Z",
      },
      lastTask: null,
      diagnostic: null,
    }).renderAtHeight(32, 12)
    expect(lines.join("\n")).toContain("任务 2")
    expectLinesFit(lines, 32)
  })

  test("窄 Agent 面板在长输入后仍保留可见光标", () => {
    const lines = new AgentWorkspace("分析贵州茅台".repeat(12), true).renderAtHeight(24, 10)

    expect(lines.at(-2) ?? "").toContain(ANSI.reverse)
    expectLinesFit(lines, 24)
  })

  test("多行输入在输入区折行显示且光标停留在末行", () => {
    const lines = new AgentWorkspace("第一段分析\n第二段结论", true).renderAtHeight(80, 15)
    const frame = lines.join("\n")

    expect(frame).toContain("第一段分析")
    expect(frame).toContain("第二段结论")
    const cursorLine = lines.find((line) => line.includes(`${ANSI.reverse} ${ANSI.reset}`)) ?? ""
    expect(cursorLine).toContain("第二段结论")
    expectLinesFit(lines, 80)
  })

  test("超过三行的输入只显示末尾并给出省略提示", () => {
    const lines = new AgentWorkspace("行甲\n行乙\n行丙\n行丁\n行戊", true).renderAtHeight(40, 12)
    const frame = lines.join("\n")

    expect(frame).toContain("行戊")
    expect(frame).not.toContain("行甲")
    expect(frame).toContain("…")
    expectLinesFit(lines, 40)
  })

  test("长单行输入自动折行且光标仍在末行", () => {
    const lines = new AgentWorkspace("分析贵州茅台".repeat(10), true).renderAtHeight(60, 15)

    expect(lines.join("\n")).toContain("分析贵州茅台")
    expect(lines.at(-2)).toContain(ANSI.reverse)
    expectLinesFit(lines, 60)
  })

  test("正文溢出时输入框上方仍为内嵌滚动提示的分隔线", () => {
    const view: AgentSessionView = {
      status: "completed",
      modelLabel: "test/model",
      userInput: "当前问题",
      answer: "",
      tools: [],
      error: null,
      history: [
        { user: "问题一", answer: "回答一", tools: [] },
        { user: "问题二", answer: "回答二", tools: [] },
      ],
    }
    const lines = new AgentWorkspace("", true, undefined, view).renderAtHeight(80, 12)
    const inputIndex = lines.findIndex((line) => line.includes(">_"))
    const above = stripVTControlCharacters(lines[inputIndex - 1] ?? "")

    expect(above).toContain("─")
    expect(above).toContain("↑↓ 滚动 · PgUp/PgDn 翻页 · Home/End 首尾")
    expectLinesFit(lines, 80)
  })

  test("历史问答显示在当前对话上方", () => {
    const view: AgentSessionView = {
      status: "completed",
      modelLabel: "test/model",
      userInput: "现在的提问",
      answer: "现在的回答",
      tools: [],
      error: null,
      history: [
        {
          user: "上次的问题",
          answer: "上次的回答",
          tools: [
            {
              id: "t1",
              name: "get_market_snapshot",
              label: "实时行情",
              status: "completed",
              summary: "返回 4 只股票",
            },
          ],
        },
      ],
    }
    const frame = new AgentWorkspace("", true, undefined, view).renderAtHeight(100, 20).join("\n")

    const oldIndex = frame.indexOf("上次的问题")
    const newIndex = frame.indexOf("现在的提问")
    expect(oldIndex).toBeGreaterThan(-1)
    expect(newIndex).toBeGreaterThan(oldIndex)
    expect(frame).toContain("上次的回答")
    expect(frame).toContain("返回 4 只股票")
  })

  test("提交后呈现角色、工具调用和综合回答层级", () => {
    const view: AgentSessionView = {
      status: "completed",
      modelLabel: "test/model",
      userInput: "分析午后拉升",
      answer: "贵州茅台短线动能偏强，但仍需关注成交量。",
      tools: [
        {
          id: "market",
          name: "get_market_snapshot",
          label: "实时行情",
          status: "completed",
        },
        {
          id: "news",
          name: "get_financial_news",
          label: "财经新闻",
          status: "completed",
        },
      ],
      error: null,
      history: [],
    }
    const frame = new AgentWorkspace("", true, undefined, view).renderAtHeight(100, 15).join("\n")

    expect(frame).toContain("User")
    expect(frame).toContain("分析午后拉升")
    expect(frame).toContain("Assistant")
    expect(frame).toContain("Tool · 实时行情")
    expect(frame).toContain("Tool · 财经新闻")
    expect(frame).toContain("✓ 完成")
    expect(frame).toContain("贵州茅台短线动能偏强")
  })

  test("较窄和较矮的面板仍保留上下文与输入区", () => {
    const lines = new AgentWorkspace("继续分析", true).renderAtHeight(24, 10)
    const frame = lines.join("\n")

    expect(lines).toHaveLength(10)
    expect(frame).toContain("Agent")
    expect(frame).toContain(">_")
    expectLinesFit(lines, 24)
  })

  test("Pi 回答将 Markdown 标题、强调和列表渲染为终端样式", () => {
    const view: AgentSessionView = {
      status: "completed",
      modelLabel: "minimax-code-cn/MiniMax-M3",
      userInput: "你能做什么",
      answer:
        "### 模拟交易\n\n- **预览买卖**：检查金额、费用和资金\n- `T+1` 校验\n\n请告诉我你的需求。",
      tools: [],
      error: null,
      history: [],
    }

    const lines = new AgentWorkspace("", true, undefined, view).renderAtHeight(52, 20)
    const rawFrame = lines.join("\n")
    const frame = stripVTControlCharacters(rawFrame)

    expect(frame).toContain("模拟交易")
    expect(frame).toContain("• 预览买卖")
    expect(frame).toContain("T+1")
    expect(frame).not.toContain("###")
    expect(frame).not.toContain("**")
    expect(rawFrame).toContain(`${ANSI.bold}预览买卖`)
    expectLinesFit(lines, 52)
  })

  test("Markdown 长列表项在窄 Agent 面板中换行且不溢出", () => {
    const view: AgentSessionView = {
      status: "completed",
      modelLabel: "test/model",
      userInput: "说明交易能力",
      answer: "- **执行模拟成交**：复用整手、印花税、佣金和 T+1 风控规则",
      tools: [],
      error: null,
      history: [],
    }

    const lines = new AgentWorkspace("", true, undefined, view).renderAtHeight(32, 14)
    expect(stripVTControlCharacters(lines.join("\n"))).not.toContain("**")
    expectLinesFit(lines, 32)
  })
})
