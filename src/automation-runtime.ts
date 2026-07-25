import { stocks } from "stock-api"
import type { AgentEventSink } from "./agent-event-dispatcher"
import type { RefreshScheduler } from "./auto-refresh"
import { ConditionalOrderService, type VolumeBaselineFetcher } from "./conditional-order-service"
import { ConditionalOrderStore } from "./conditional-order-store"
import { createScheduledTaskService } from "./scheduled-task-runtime"
import type { ScheduledTaskService } from "./scheduled-task-service"
import type { ScheduledTaskStore } from "./scheduled-task-store"
import { shanghaiDateTime } from "./trading-calendar"

export interface AutomationRuntimeOptions {
  readonly sink: AgentEventSink
  readonly timer?: RefreshScheduler | undefined
  readonly lotSize: number
  readonly volumeBaseline?: VolumeBaselineFetcher | undefined
  readonly conditionalOrderStore?: ConditionalOrderStore | undefined
  readonly scheduledTaskStore?: ScheduledTaskStore | undefined
}

async function defaultVolumeBaseline(code: string): Promise<number | null> {
  try {
    const klines = await stocks.auto.getKlines(code, { period: "day", count: 8 })
    const today = shanghaiDateTime(new Date()).date
    const volumes = klines
      .filter((kline) => kline.date < today && typeof kline.volume === "number" && kline.volume > 0)
      .slice(-5)
      .map((kline) => kline.volume as number)
    if (volumes.length < 3) return null
    return volumes.reduce((sum, volume) => sum + volume, 0) / volumes.length
  } catch {
    return null
  }
}

export class AutomationRuntime {
  readonly conditions: ConditionalOrderService
  readonly tasks: ScheduledTaskService

  constructor(options: AutomationRuntimeOptions) {
    this.conditions = new ConditionalOrderService({
      sink: options.sink,
      lotSize: options.lotSize,
      store: options.conditionalOrderStore ?? new ConditionalOrderStore(),
      volumeBaseline: options.volumeBaseline ?? defaultVolumeBaseline,
    })
    this.tasks = createScheduledTaskService(options.sink, options.timer, options.scheduledTaskStore)
  }
}
