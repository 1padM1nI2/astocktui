import { describe, expect, test } from "bun:test"
import { stripVTControlCharacters } from "node:util"
import { visibleWidth } from "@oh-my-pi/pi-tui"
import type { AgentSessionView } from "../src/agent-controller"
import { ANSI } from "../src/colors"
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

  test("窄 Agent 面板在长输入后仍保留可见光标", () => {
    const lines = new AgentWorkspace("分析贵州茅台".repeat(12), true).renderAtHeight(24, 10)

    expect(lines.at(-2) ?? "").toContain(ANSI.reverse)
    expectLinesFit(lines, 24)
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
    }

    const lines = new AgentWorkspace("", true, undefined, view).renderAtHeight(32, 14)
    expect(stripVTControlCharacters(lines.join("\n"))).not.toContain("**")
    expectLinesFit(lines, 32)
  })
})
