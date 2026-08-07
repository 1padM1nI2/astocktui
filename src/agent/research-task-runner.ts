import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fitLine } from "../app/width"
import type { CommandContext } from "../commands/commands"
import { defaultAppDataPath } from "../infra/json-file"
import { shanghaiDateTime } from "../trading/calendar"
import type { AgentEventSink, AgentSystemEvent } from "./event-dispatcher"

/** 摘要节标题与退化策略的最大行数 */
const SUMMARY_MAX_LINES = 10
/** 回流主对话的摘要行宽（TUI 可见行按此截断） */
const SUMMARY_WIDTH = 80

export interface ScheduledTaskResultMarker {
  markRunResult(id: string, state: "completed" | "failed", reason?: string): unknown
}

export interface ScheduledTaskSinkDeps {
  readonly context: CommandContext
  readonly dispatcher: AgentEventSink
  /** 延迟取任务服务，规避 AutomationRuntime 构造顺序的循环依赖 */
  readonly tasks: () => ScheduledTaskResultMarker
  readonly runResearch: (context: CommandContext, prompt: string) => Promise<string>
  readonly reportsDir?: string
  readonly width?: number
  readonly now?: () => Date
}

export interface ScheduledTaskRoutingSink extends AgentEventSink {
  /** 等待进行中的调研子任务全部结束（测试与退出前使用） */
  whenIdle(): Promise<void>
}

/**
 * 定时任务路由 sink：research 模式交给只读调研子任务，报告全文写 reviews/ 目录，
 * 摘要经 dispatcher 回流主对话；其余事件原样转发主 agent。
 */
export function createScheduledTaskSink(deps: ScheduledTaskSinkDeps): ScheduledTaskRoutingSink {
  const pending = new Set<Promise<void>>()
  return {
    enqueue(event) {
      if (event.kind === "custom" && event.mode === "research" && event.taskId !== undefined) {
        const run = runResearchEvent(deps, event)
        pending.add(run)
        void run.finally(() => pending.delete(run))
        return "queued"
      }
      return deps.dispatcher.enqueue(event)
    },
    async whenIdle() {
      await Promise.all([...pending])
    },
  }
}

/** 提取「摘要」节（≤10 行，按宽度截断）；缺失时退化为全文前 10 行 */
export function extractSummary(report: string, width: number): string {
  const lines = report.split(/\r?\n/u)
  const heading = lines.findIndex((line) => /^#{1,6}\s*摘要/u.test(line.trim()))
  const picked = heading >= 0 ? lines.slice(heading + 1) : lines
  return picked
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, SUMMARY_MAX_LINES)
    .map((line) => fitLine(line, width))
    .join("\n")
}

async function runResearchEvent(
  deps: ScheduledTaskSinkDeps,
  event: AgentSystemEvent,
): Promise<void> {
  const taskId = event.taskId as string
  const taskName = event.taskName ?? event.title
  try {
    await deps.context.refreshAndWait("all")
    const report = await deps.runResearch(deps.context, event.prompt)
    const path = writeReport(deps, taskName, report)
    const summary = extractSummary(report, deps.width ?? SUMMARY_WIDTH)
    deps.dispatcher.enqueue(
      feedback(event, `[定时任务·${taskName}] 复盘报告已生成：${path}\n${summary}`),
    )
    mark(deps, taskId, "completed")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    mark(deps, taskId, "failed", message)
    deps.dispatcher.enqueue(
      feedback(event, `[定时任务·${taskName}] 调研子任务执行失败：${message}`),
    )
  }
}

function feedback(event: AgentSystemEvent, prompt: string): AgentSystemEvent {
  return { ...event, kind: "research", prompt }
}

/** 任务可能已被删除，回写状态失败不能炸掉调度循环 */
function mark(
  deps: ScheduledTaskSinkDeps,
  taskId: string,
  state: "completed" | "failed",
  reason?: string,
): void {
  try {
    deps.tasks().markRunResult(taskId, state, reason)
  } catch {
    // 忽略状态回写失败
  }
}

function writeReport(deps: ScheduledTaskSinkDeps, taskName: string, report: string): string {
  const directory = deps.reportsDir ?? defaultAppDataPath("reviews")
  const date = shanghaiDateTime((deps.now ?? (() => new Date()))()).date
  const cleaned =
    taskName
      .replace(/[\\/:*?"<>|\s]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 40) || "task"
  const path = join(directory, `${date}-${cleaned}.md`)
  writeTextFileAtomically(path, report)
  return path
}

function writeTextFileAtomically(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(temporaryPath, content, { encoding: "utf8", mode: 0o600 })
    renameSync(temporaryPath, path)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}
