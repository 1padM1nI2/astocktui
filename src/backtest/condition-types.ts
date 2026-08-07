import type { KlineBar } from "../market/data"

export interface ScreenCondition {
  readonly name: string
  readonly summary: string
  /** 判定所需的历史 K 线根数（含当日） */
  readonly warmup: number
  /** 基于 bars[index]（含）之前的数据判定当日是否满足条件 */
  evaluate(bars: readonly KlineBar[], index: number): boolean
}

export interface ConditionParamInfo {
  readonly key: string
  readonly description: string
  readonly defaultValue: number
  /** true 时要求整数（period 类），否则允许小数（ratio、threshold 类） */
  readonly integer?: boolean
}

export interface ConditionInfo {
  readonly name: string
  readonly summary: string
  readonly params: readonly ConditionParamInfo[]
}

export interface ConditionDefinition extends ConditionInfo {
  readonly create: (params: Readonly<Record<string, number>>) => ScreenCondition | null
}

export interface ConditionSpec {
  readonly name: string
  readonly params: Readonly<Record<string, number>>
}
