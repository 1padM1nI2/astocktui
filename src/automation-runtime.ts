import { type AgentEventSink, AgentTaskScheduler, type AutomationTimer } from "./agent-scheduler"
import { ConditionalOrderService } from "./conditional-order-service"
import { ConditionalOrderStore } from "./conditional-order-store"
import { createScheduledTaskService } from "./scheduled-task-runtime"
import type { ScheduledTaskService } from "./scheduled-task-service"

export interface AutomationRuntimeOptions {
  readonly sink: AgentEventSink
  readonly timer?: AutomationTimer | undefined
  readonly lastActivityAt: () => number
  readonly lotSize: number
}

export class AutomationRuntime {
  readonly conditions: ConditionalOrderService
  readonly tasks: ScheduledTaskService
  readonly scheduler: AgentTaskScheduler

  constructor(options: AutomationRuntimeOptions) {
    this.conditions = new ConditionalOrderService({
      sink: options.sink,
      lotSize: options.lotSize,
      store: new ConditionalOrderStore(),
    })
    this.tasks = createScheduledTaskService(options.sink)
    this.scheduler = new AgentTaskScheduler({
      sink: options.sink,
      timer: options.timer,
      lastActivityAt: options.lastActivityAt,
      tasks: this.tasks,
    })
  }
}
