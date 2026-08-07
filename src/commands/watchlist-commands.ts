import type { AppCommand, CommandContext, CommandExecution, CommandResult } from "./commands"

function output(title: string, lines: readonly string[]): CommandResult {
  return { kind: "output", title, lines }
}

function error(message: string, usage: string): CommandResult {
  return output("命令错误", [message, `用法 ${usage}`])
}

function watchCommand(context: CommandContext, args: readonly string[]): CommandExecution {
  const action = args[0] ?? "list"
  if (action === "list") {
    if (args.length > 1) return error("list 不接受额外参数", "/watch list")
    return output(
      "行情自选股",
      context.watchlist().map((code, index) => `${index + 1}. ${code}`),
    )
  }
  if (action !== "add" && action !== "remove") {
    return error("操作必须是 list、add 或 remove", "/watch [list|add <code>|remove <code>]")
  }
  const code = args[1]
  if (code === undefined || args.length > 2) {
    return error("需要提供一只股票代码", `/watch ${action} <code>`)
  }
  return context
    .changeWatchlist(action, code)
    .then((change) => output(change.ok ? "自选股已更新" : "自选股修改失败", [change.message]))
}

export const WATCHLIST_COMMANDS: readonly AppCommand[] = [
  {
    name: "watch",
    aliases: [],
    category: "data",
    usage: "/watch [list|add <code>|remove <code>]",
    description: "查看、添加或删除行情自选股",
    execute: watchCommand,
  },
]
