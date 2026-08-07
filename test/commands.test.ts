import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ScheduledTaskService } from "../src/agent/scheduled-task-service"
import { ScheduledTaskStore } from "../src/agent/scheduled-task-store"
import { CommandPrompt } from "../src/commands/command-prompt"
import {
  APP_COMMANDS,
  type CommandContext,
  type CommandResult,
  executeCommand,
  filterCommands,
} from "../src/commands/commands"
import { PaperTradingService } from "../src/trading/trading"

function commandContext(): CommandContext & {
  readonly focused: string[]
  readonly refreshed: string[]
  quitCalled: boolean
} {
  const trading = new PaperTradingService()
  const context = {
    focused: [] as string[],
    refreshed: [] as string[],
    quitCalled: false,
    focus(workspace: string): void {
      this.focused.push(workspace)
    },
    refresh(target: string) {
      this.refreshed.push(target)
      return {
        market: target === "news" ? ("skipped" as const) : ("started" as const),
        news: target === "market" ? ("skipped" as const) : ("started" as const),
      }
    },
    refreshAndWait: async () => {},
    quit(): void {
      this.quitCalled = true
    },
    clearAgent: () => {},
    marketOverview: async () => {
      throw new Error("大盘未加载")
    },
    status: () => ({
      activeWorkspace: "agent" as const,
      market: { state: "idle" as const, source: null },
      news: { state: "ready" as const, source: "NewsNow" },
      agent: "ready" as const,
    }),
    marketSnapshot: () => null,
    newsSnapshot: () => null,
    portfolio: () => trading.snapshot,
    quote: async () => undefined,
    trading: () => trading,
    portfolioChanged: () => {},
    watchlist: () => ["SH600519"],
    changeWatchlist: async (action: "add" | "remove", code: string) => ({
      ok: true,
      code,
      message: action === "add" ? `已添加 ${code}` : `已删除 ${code}`,
    }),
  }
  return context
}

function executeSync(input: string, context: CommandContext): CommandResult {
  const result = executeCommand(input, context)
  if (result instanceof Promise) throw new Error(`预期同步命令：${input}`)
  return result
}

describe("应用命令注册表", () => {
  test("首批命令由单一注册表提供", () => {
    expect(APP_COMMANDS.map((command) => command.name)).toEqual([
      "help",
      "status",
      "focus",
      "refresh",
      "watch",
      "portfolio",
      "preview",
      "buy",
      "sell",
      "trades",
      "account",
      "backtest",
      "screen",
      "mcp",
      "clear",
      "condition",
      "task",
      "memory",
      "model",
      "think",
      "quote",
      "quit",
    ])
  })

  test("按命令名过滤且忽略参数", () => {
    expect(filterCommands("/re").map((command) => command.name)).toEqual(["refresh"])
    expect(filterCommands("/focus portfolio").map((command) => command.name)).toEqual(["focus"])
    expect(filterCommands("/ex").map((command) => command.name)).toEqual(["quit"])
    expect(filterCommands("/missing")).toEqual([])
  })

  test("help、focus、refresh、portfolio 和未知命令产生结构化结果", () => {
    const context = commandContext()

    expect(executeSync("/help refresh", context).lines.join("\n")).toContain(
      "/refresh [market|news|all]",
    )
    expect(executeSync("/focus portfolio", context).title).toBe("切换工作区")
    expect(executeSync("/focus trade", context).title).toBe("切换工作区")
    expect(context.focused).toEqual(["portfolio", "trade"])
    expect(executeSync("/refresh all", context).title).toBe("刷新数据")
    expect(context.refreshed).toEqual(["all"])
    expect(executeSync("/portfolio", context).lines.join("\n")).toContain("¥100,000.00")
    expect(executeSync("/missing", context).title).toBe("命令错误")
  })

  test("status 使用实时上下文，clear 和 quit 保持明确副作用", () => {
    const context = commandContext()

    const status = executeSync("/status", context).lines.join("\n")
    expect(status).toContain("工作区 Agent")
    expect(status).toContain("行情 未加载")
    expect(status).toContain("财经新闻 NewsNow")
    expect(status).toContain("模拟账户 ¥100,000.00 · 空仓")
    expect(executeSync("/clear", context).kind).toBe("clear")
    executeCommand("/quit", context)
    expect(context.quitCalled).toBe(true)
    context.quitCalled = false
    executeCommand("/exit", context)
    expect(context.quitCalled).toBe(true)
  })
})

test("/task 创建并管理自定义定时任务", () => {
  const directory = mkdtempSync(join(tmpdir(), "astocktui-task-commands-"))
  try {
    const context = commandContext()
    const service = new ScheduledTaskService({
      store: new ScheduledTaskStore(join(directory, "scheduled-tasks.json")),
      sink: { enqueue: () => "queued" },
      now: () => new Date("2026-07-17T01:00:00.000Z"),
    })
    context.scheduledTasks = () => service

    expect(
      executeSync("/task add daily 15:10 weekdays 收盘 复盘 :: 总结市场和持仓", context).lines.join(
        "\n",
      ),
    ).toContain("收盘 复盘")
    expect(executeSync("/task list", context).lines.join("\n")).toContain("每日工作日 15:10")
    expect(executeSync("/task pause TASK-0001", context).lines.join("\n")).toContain("已暂停")
    expect(executeSync("/task resume TASK-0001", context).lines.join("\n")).toContain("已恢复")
    expect(executeSync("/task run TASK-0001", context).lines.join("\n")).toContain("已排队")
    expect(executeSync("/task add interval 0 错误 :: 无效", context).title).toBe("命令错误")
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("命令输入状态机", () => {
  test("斜杠打开候选列表，输入过滤并由 Tab 补全", () => {
    const prompt = new CommandPrompt()
    const context = commandContext()
    const execute = (input: string) => executeCommand(input, context)

    for (const character of "/re") prompt.handleInput(character, execute)
    expect(prompt.view.isPaletteOpen).toBe(true)
    expect(prompt.view.suggestions.map((command) => command.name)).toEqual(["refresh"])

    prompt.handleInput("\t", execute)
    expect(prompt.view.input).toBe("/refresh ")
    prompt.handleInput("\x1b", execute)
    expect(prompt.view.isPaletteOpen).toBe(false)
  })

  test("上下键选择命令，Enter 执行并保留结构化输出", () => {
    const prompt = new CommandPrompt()
    const context = commandContext()
    const execute = (input: string) => executeCommand(input, context)

    prompt.handleInput("/", execute)
    prompt.handleInput("\x1b[B", execute)
    expect(prompt.view.selectedIndex).toBe(1)
    prompt.handleInput("\t", execute)
    expect(prompt.view.input).toBe("/status ")
    prompt.handleInput("\r", execute)

    expect(prompt.view.input).toBe("")
    expect(prompt.view.result?.title).toBe("工作台状态")
    expect(prompt.view.submitted).toBeNull()
  })

  test("Tab 补全命令名时保留已输入参数", () => {
    const prompt = new CommandPrompt()
    const context = commandContext()
    const execute = (input: string) => executeCommand(input, context)

    for (const character of "/focus portfolio") prompt.handleInput(character, execute)
    prompt.handleInput("\t", execute)

    expect(prompt.view.input).toBe("/focus portfolio")
  })

  test("Shift+Enter 与 Alt+Enter 在提问输入中插入换行", () => {
    const prompt = new CommandPrompt()
    const context = commandContext()
    const execute = (input: string) => executeCommand(input, context)
    const submitted: string[] = []

    prompt.handleInput("分", execute)
    prompt.handleInput("\x1b[13;2u", execute)
    prompt.handleInput("析", execute)
    expect(prompt.view.input).toBe("分\n析")

    prompt.handleInput("\x1b\r", execute)
    expect(prompt.view.input).toBe("分\n析\n")

    prompt.handleInput("\x7f", execute)
    expect(prompt.view.input).toBe("分\n析")

    prompt.handleInput(
      "\r",
      execute,
      () => {},
      (input) => submitted.push(input),
    )
    expect(submitted).toEqual(["分\n析"])
  })

  test("粘贴的普通文本保留换行，命令粘贴仍折叠为单行", () => {
    const prompt = new CommandPrompt()
    prompt.pasteText("第一行\r\n第二行\t第三列")
    expect(prompt.view.input).toBe("第一行\n第二行 第三列")

    const command = new CommandPrompt()
    command.pasteText("/task list\n")
    expect(command.view.input).toBe("/task list ")
  })

  test("未知命令按 Enter 后显示错误而不是静默停留", () => {
    const prompt = new CommandPrompt()
    const context = commandContext()
    const execute = (input: string) => executeCommand(input, context)

    for (const character of "/missing") prompt.handleInput(character, execute)
    prompt.handleInput("\r", execute)

    expect(prompt.view.input).toBe("")
    expect(prompt.view.result?.title).toBe("命令错误")
    expect(prompt.view.result?.lines.join("\n")).toContain("未知命令 /missing")
  })

  test("quit 和 exit 可作为裸命令退出，普通句子仍提交给 Agent", () => {
    for (const bareCommand of ["quit", "exit"]) {
      const prompt = new CommandPrompt()
      const context = commandContext()
      const execute = (input: string) => executeCommand(input, context)
      for (const character of bareCommand) prompt.handleInput(character, execute)
      prompt.handleInput("\r", execute)

      expect(context.quitCalled).toBe(true)
      expect(prompt.view.submitted).toBeNull()
    }

    const prompt = new CommandPrompt()
    const context = commandContext()
    const execute = (input: string) => executeCommand(input, context)
    for (const character of "exit strategy") prompt.handleInput(character, execute)
    prompt.handleInput("\r", execute)
    expect(context.quitCalled).toBe(false)
    expect(prompt.view.submitted).toBe("exit strategy")

    const qPrompt = new CommandPrompt()
    const qContext = commandContext()
    const executeQ = (input: string) => executeCommand(input, qContext)
    qPrompt.handleInput("q", executeQ)
    qPrompt.handleInput("\r", executeQ)
    expect(qContext.quitCalled).toBe(false)
    expect(qPrompt.view.submitted).toBe("q")
  })

  test("异步命令先显示处理中并在完成后更新结果", async () => {
    const prompt = new CommandPrompt()
    const deferred = Promise.withResolvers<CommandResult>()
    let updates = 0
    for (const character of "/status") {
      prompt.handleInput(
        character,
        () => deferred.promise,
        () => {
          updates++
        },
      )
    }

    prompt.handleInput(
      "\r",
      () => deferred.promise,
      () => {
        updates++
      },
    )
    expect(prompt.view.result?.title).toBe("命令执行中")

    deferred.resolve({ kind: "output", title: "工作台状态", lines: ["完成"] })
    await prompt.whenIdle()
    expect(prompt.view.result?.title).toBe("工作台状态")
    expect(updates).toBe(1)
  })
})
