import type { AppCommand, CommandResult } from "./commands"
import type { ScheduledTaskInput, ScheduledTaskSchedule } from "./scheduled-tasks"

const USAGE =
  "/task [list|builtin|add|update|pause|resume|remove|run]；新增：/task add <once|daily|interval> … <名称> :: <提示>"

function output(title: string, lines: readonly string[]): CommandResult {
  return { kind: "output", title, lines }
}

function error(message: string): CommandResult {
  return output("命令错误", [message, `用法 ${USAGE}`])
}

function taskInput(args: readonly string[], start: number): ScheduledTaskInput | CommandResult {
  const separator = args.indexOf("::", start)
  if (separator < 0 || separator === args.length - 1) return error("任务名称与提示必须以 :: 分隔")
  const kind = args[start]
  const prompt = args.slice(separator + 1).join(" ")
  if (kind === "once")
    return createInput(args, start + 2, separator, prompt, { kind, at: args[start + 1] ?? "" })
  if (kind === "interval") {
    const minutes = Number(args[start + 1])
    return createInput(args, start + 2, separator, prompt, { kind, minutes })
  }
  if (kind === "daily") {
    const weekdaysOnly = args[start + 2] === "weekdays"
    return createInput(args, start + (weekdaysOnly ? 3 : 2), separator, prompt, {
      kind,
      time: args[start + 1] ?? "",
      weekdaysOnly,
    })
  }
  return error("调度规则必须是 once、daily 或 interval")
}

function createInput(
  args: readonly string[],
  nameStart: number,
  separator: number,
  prompt: string,
  schedule: ScheduledTaskSchedule,
): ScheduledTaskInput | CommandResult {
  const name = args.slice(nameStart, separator).join(" ")
  if (name.length === 0) return error("任务名称不能为空")
  return { name, prompt, schedule }
}

function isCommandResult(value: ScheduledTaskInput | CommandResult): value is CommandResult {
  return "kind" in value
}

function scheduleLabel(schedule: ScheduledTaskSchedule): string {
  if (schedule.kind === "once") return `一次 ${schedule.at}`
  if (schedule.kind === "daily")
    return `${schedule.weekdaysOnly ? "每日工作日" : "每日"} ${schedule.time}`
  return `每 ${schedule.minutes} 分钟`
}

export const TASK_COMMANDS: readonly AppCommand[] = [
  {
    name: "task",
    aliases: [],
    category: "system",
    usage: USAGE,
    description: "管理自定义 Agent 定时任务",
    execute: (context, args) => {
      const service = context.scheduledTasks?.()
      if (service === undefined) return output("定时任务", ["定时任务服务尚未就绪"])
      const action = args[0] ?? "list"
      if (action === "builtin")
        return output("内置自动化任务", [
          "盘前计划与盘中检查：使用 /schedule 管理",
          "记忆整理：使用 /memory dream 手动触发",
        ])
      if (action === "list") {
        const tasks = service.list()
        return output(
          "自定义定时任务",
          tasks.length === 0
            ? ["暂无自定义任务"]
            : tasks.map((task) =>
                [
                  task.id,
                  task.enabled ? "已启用" : "已暂停",
                  task.name,
                  scheduleLabel(task.schedule),
                  task.nextRunAt === null ? "无下次运行" : `下次 ${task.nextRunAt}`,
                ].join(" · "),
              ),
        )
      }
      try {
        if (action === "add") {
          const input = taskInput(args, 1)
          if (isCommandResult(input)) return input
          const task = service.create(input, "user")
          return output("创建定时任务", [
            `${task.id} ${task.name}`,
            `下次 ${task.nextRunAt ?? "无"}`,
          ])
        }
        if (action === "update") {
          const id = args[1]
          if (id === undefined) return error("缺少任务标识")
          const input = taskInput(args, 2)
          if (isCommandResult(input)) return input
          const task = service.update(id, input, "user")
          return output("更新定时任务", [
            `${task.id} ${task.name}`,
            `下次 ${task.nextRunAt ?? "无"}`,
          ])
        }
        const id = args[1]
        if (id === undefined) return error("缺少任务标识")
        if (action === "pause") return output("定时任务", [`${service.pause(id).name} 已暂停`])
        if (action === "resume") return output("定时任务", [`${service.resume(id).name} 已恢复`])
        if (action === "remove") {
          service.remove(id)
          return output("定时任务", [`${id} 已删除`])
        }
        if (action === "run") {
          const result = service.runNow(id)
          return output("定时任务", [result === "queued" ? `${id} 已排队` : `${id} 已在队列中`])
        }
        return error("未知任务操作")
      } catch (exception) {
        return error(exception instanceof Error ? exception.message : String(exception))
      }
    },
  },
]
