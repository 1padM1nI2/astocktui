import { CONDITION_DEFINITIONS } from "./condition-definitions"
import type { ConditionInfo, ConditionSpec, ScreenCondition } from "./condition-types"

export type {
  ConditionInfo,
  ConditionParamInfo,
  ConditionSpec,
  ScreenCondition,
} from "./condition-types"

export function listConditions(): readonly ConditionInfo[] {
  return CONDITION_DEFINITIONS.map(({ name, summary, params }) => ({ name, summary, params }))
}

export function createCondition(
  name: string,
  params: Readonly<Record<string, number>>,
): ScreenCondition | null {
  const definition = CONDITION_DEFINITIONS.find((item) => item.name === name)
  if (definition === undefined) return null
  for (const key of Object.keys(params)) {
    if (!definition.params.some((param) => param.key === key)) return null
  }
  for (const info of definition.params) {
    const value = params[info.key]
    if (value === undefined) continue
    if (!Number.isFinite(value) || value === 0) return null
    if (info.integer === true && (!Number.isInteger(value) || value < 1)) return null
  }
  return definition.create(params)
}

/** 解析 `name` 或 `name(key=value,…)` 形式的条件串并实例化校验 */
export function parseConditionSpecs(
  tokens: readonly string[],
): readonly ConditionSpec[] | { error: string } {
  if (tokens.length === 0) return { error: "缺少筛选条件" }
  const specs: ConditionSpec[] = []
  for (const token of tokens) {
    const matched = /^([a-z_]+)(?:\(([^)]*)\))?$/u.exec(token)
    if (matched === null) return { error: `条件格式无效：${token}` }
    const name = matched[1] ?? ""
    const params: Record<string, number> = {}
    const inner = matched[2]
    if (inner !== undefined) {
      for (const pair of inner.split(",")) {
        const eq = pair.indexOf("=")
        const value = Number(pair.slice(eq + 1))
        if (eq < 1 || !Number.isFinite(value)) return { error: `条件参数无效：${pair}` }
        params[pair.slice(0, eq)] = value
      }
    }
    if (createCondition(name, params) === null) {
      const available = listConditions()
        .map((info) => info.name)
        .join("、")
      return { error: `条件不可用：${token}，可选 ${available}` }
    }
    specs.push({ name, params })
  }
  return specs
}
