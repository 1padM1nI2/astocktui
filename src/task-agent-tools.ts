import type { AgentTool, AgentToolResult } from "@oh-my-pi/pi-agent-core"
import { z } from "@oh-my-pi/pi-ai"
import type { CommandContext } from "./commands"
import type { ScheduledTaskService } from "./scheduled-task-service"
import type { ScheduledTaskInput } from "./scheduled-tasks"

const scheduleSchema = z.object({
  kind: z.enum(["once", "daily", "interval"]),
  at: z.string().min(1).optional(),
  time: z.string().min(1).optional(),
  weekdaysOnly: z.boolean().optional(),
  minutes: z.number().int().positive().optional(),
})

const parameters = z.object({
  action: z.enum(["list", "create", "update", "pause", "resume", "remove", "run"]),
  id: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  schedule: scheduleSchema.optional(),
  mode: z.enum(["agent", "research"]).optional(),
})

type TaskToolSchedule = {
  readonly kind: "once" | "daily" | "interval"
  readonly at?: string
  readonly time?: string
  readonly weekdaysOnly?: boolean
  readonly minutes?: number
}

type TaskToolInput = {
  readonly action: "list" | "create" | "update" | "pause" | "resume" | "remove" | "run"
  readonly id?: string
  readonly name?: string
  readonly prompt?: string
  readonly schedule?: TaskToolSchedule
  readonly mode?: "agent" | "research"
}

function result(value: unknown): AgentToolResult<unknown> {
  return { content: [{ type: "text", text: JSON.stringify(value) }], details: value }
}

function normalizeSchedule(schedule: TaskToolSchedule): ScheduledTaskInput["schedule"] {
  if (schedule.kind === "once") {
    if (schedule.at === undefined) throw new Error("一次性任务需要 at(未来 ISO 时间)")
    return { kind: "once", at: schedule.at }
  }
  if (schedule.kind === "daily") {
    if (schedule.time === undefined) throw new Error("每日任务需要 time(HH:mm)")
    const match = /^(\d{1,2}):(\d{2})$/.exec(schedule.time)
    const time = match === null ? schedule.time : `${match[1]?.padStart(2, "0")}:${match[2]}`
    return { kind: "daily", time, weekdaysOnly: schedule.weekdaysOnly ?? false }
  }
  if (schedule.minutes === undefined) throw new Error("间隔任务需要 minutes(1-1440 分钟整数)")
  return { kind: "interval", minutes: schedule.minutes }
}

function taskInput(input: TaskToolInput): ScheduledTaskInput {
  if (input.name === undefined || input.prompt === undefined || input.schedule === undefined)
    throw new Error("创建或更新定时任务必须提供名称、提示和调度规则")
  return {
    name: input.name,
    prompt: input.prompt,
    schedule: normalizeSchedule(input.schedule),
    ...(input.mode === undefined ? {} : { mode: input.mode }),
  }
}

export function createScheduledTaskAgentTools(context: CommandContext): readonly AgentTool[] {
  const service = (): ScheduledTaskService => {
    const tasks = context.scheduledTasks?.()
    if (tasks === undefined) throw new Error("定时任务服务尚未就绪")
    return tasks
  }
  return [
    {
      name: "manage_scheduled_task",
      label: "管理定时任务",
      description:
        "创建、查看、更新、暂停、恢复、删除或立即运行本地 Agent 定时任务。schedule 是扁平对象:kind 取 once/daily/interval;once 需填 at(未来 ISO 时间);daily 需填 time(HH:mm 上海时间,weekdaysOnly 可省略);interval 需填 minutes(1-1440 整数)。mode 可省略,默认 agent(主对话执行);research 表示由只读调研子任务生成复盘报告并回流摘要。",
      parameters,
      intent: "omit",
      approval: "write",
      execute: async (_id, params) => {
        const input = params as TaskToolInput
        const tasks = service()
        if (input.action === "list")
          return result({
            total: tasks.list().length,
            tasks: tasks.list().map((task) => ({ ...task, mode: task.mode ?? "agent" })),
          })
        if (input.action === "create") return result(tasks.create(taskInput(input), "agent"))
        const id = input.id
        if (id === undefined) throw new Error("操作定时任务必须提供 id")
        if (input.action === "update") return result(tasks.update(id, taskInput(input), "agent"))
        if (input.action === "pause") return result(tasks.pause(id))
        if (input.action === "resume") return result(tasks.resume(id))
        if (input.action === "remove") return result({ ok: tasks.remove(id), id })
        return result({ id, result: tasks.runNow(id) })
      },
    },
  ]
}
