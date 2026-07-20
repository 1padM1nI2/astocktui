import type { AgentEventSink } from "./agent-scheduler"
import { ScheduledTaskService } from "./scheduled-task-service"
import { ScheduledTaskStore } from "./scheduled-task-store"

export function createScheduledTaskService(sink: AgentEventSink): ScheduledTaskService {
  return new ScheduledTaskService({ sink, store: new ScheduledTaskStore() })
}
