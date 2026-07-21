import type { AgentEventSink } from "./agent-event-dispatcher"
import type { RefreshScheduler } from "./auto-refresh"
import { ConditionalOrderService } from "./conditional-order-service"
import { ConditionalOrderStore } from "./conditional-order-store"
import { createScheduledTaskService } from "./scheduled-task-runtime"
import type { ScheduledTaskService } from "./scheduled-task-service"

export interface AutomationRuntimeOptions {
  readonly sink: AgentEventSink
  readonly timer?: RefreshScheduler | undefined
  readonly lotSize: number
}

export class AutomationRuntime {
  readonly conditions: ConditionalOrderService
  readonly tasks: ScheduledTaskService

  constructor(options: AutomationRuntimeOptions) {
    this.conditions = new ConditionalOrderService({
      sink: options.sink,
      lotSize: options.lotSize,
      store: new ConditionalOrderStore(),
    })
    this.tasks = createScheduledTaskService(options.sink, options.timer)
  }
}
