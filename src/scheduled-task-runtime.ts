import type { AgentEventSink } from "./agent-event-dispatcher"
import type { RefreshScheduler } from "./auto-refresh"
import { ScheduledTaskService } from "./scheduled-task-service"
import { ScheduledTaskStore } from "./scheduled-task-store"

export function createScheduledTaskService(
  sink: AgentEventSink,
  timer?: RefreshScheduler,
  store?: ScheduledTaskStore,
): ScheduledTaskService {
  return new ScheduledTaskService({ sink, store: store ?? new ScheduledTaskStore(), timer })
}
