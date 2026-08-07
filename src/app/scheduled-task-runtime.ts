import type { AgentEventSink } from "../agent/agent-event-dispatcher"
import { ScheduledTaskService } from "../agent/scheduled-task-service"
import { ScheduledTaskStore } from "../agent/scheduled-task-store"
import type { RefreshScheduler } from "./auto-refresh"

export function createScheduledTaskService(
  sink: AgentEventSink,
  timer?: RefreshScheduler,
  store?: ScheduledTaskStore,
): ScheduledTaskService {
  return new ScheduledTaskService({ sink, store: store ?? new ScheduledTaskStore(), timer })
}
