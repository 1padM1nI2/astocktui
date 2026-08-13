import type { Agent } from "@oh-my-pi/pi-agent-core"
import { isUsageLimit } from "@oh-my-pi/pi-ai/error"
import { type GeneratedProvider, getBundledModel } from "@oh-my-pi/pi-catalog"

export interface AgentModelOption {
  readonly model: Parameters<Agent["setModel"]>[0]
  readonly label: string
}

export interface FallbackModelSpec {
  readonly provider: string
  readonly model: string
}

export interface ResolvedModelChain {
  readonly chain: readonly AgentModelOption[]
  readonly error: string | null
}

export function parseFallbackModelList(value: string | undefined): readonly FallbackModelSpec[] {
  if (value === undefined) return []
  const entries: FallbackModelSpec[] = []
  for (const item of value.split(",")) {
    const trimmed = item.trim()
    const slash = trimmed.indexOf("/")
    if (slash <= 0 || slash === trimmed.length - 1) continue
    entries.push({ provider: trimmed.slice(0, slash), model: trimmed.slice(slash + 1) })
  }
  return entries
}

const QUOTA_EXHAUSTED_PATTERN =
  /用量上限|额度不足|额度耗尽|余额不足|积分补充|配额不足|配额已满|超出.*配额/u

export function isQuotaExhaustedError(message: string): boolean {
  return isUsageLimit(message) || QUOTA_EXHAUSTED_PATTERN.test(message)
}

const CONTEXT_OVERFLOW_PATTERN =
  /context\s*(window|length|size)\s*(exceeds?|is\s*exceeded|overflow|too\s*long|limit)|maximum\s*context|too\s*many\s*tokens|上下文.*(超限|超出|过长)|超[出过].*上下文/iu

export function isContextOverflowError(message: string): boolean {
  return CONTEXT_OVERFLOW_PATTERN.test(message)
}

export function withAgentBaseUrl<TModel extends { readonly baseUrl: string }>(
  model: TModel,
  baseUrl: string | undefined,
): TModel {
  if (baseUrl === undefined) return model
  let parsed: URL
  try {
    parsed = new URL(baseUrl.trim())
  } catch {
    throw new Error(`Agent Base URL 无效：${baseUrl}`)
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Agent Base URL 仅支持 HTTP 或 HTTPS：${baseUrl}`)
  }
  const normalized = parsed.toString().replace(/\/+$/u, "")
  return { ...model, baseUrl: normalized }
}

export function resolveModelChain(options: {
  readonly provider: string
  readonly modelId: string
  readonly baseUrl?: string | undefined
  readonly fallbackSpecs: readonly FallbackModelSpec[]
  /** 按 provider 的备用模型端点覆盖；非法 URL 返回错误而不是静默回退官方端点 */
  readonly fallbackBaseUrls?: Readonly<Record<string, string>> | undefined
}): ResolvedModelChain {
  const label = `${options.provider}/${options.modelId}`
  const bundled = getBundledModel(options.provider as GeneratedProvider, options.modelId)
  if (bundled === undefined) return { chain: [], error: `Pi 模型不存在：${label}` }
  let primary: typeof bundled
  try {
    primary = withAgentBaseUrl(bundled, options.baseUrl)
  } catch (error) {
    return { chain: [], error: error instanceof Error ? error.message : String(error) }
  }
  const chain: AgentModelOption[] = [{ model: primary, label }]
  for (const spec of options.fallbackSpecs) {
    if (spec.provider === options.provider && spec.model === options.modelId) continue
    const fallback = getBundledModel(spec.provider as GeneratedProvider, spec.model)
    if (fallback === undefined) continue
    let model: typeof fallback
    try {
      model = withAgentBaseUrl(fallback, options.fallbackBaseUrls?.[spec.provider])
    } catch (error) {
      return { chain: [], error: error instanceof Error ? error.message : String(error) }
    }
    chain.push({ model, label: `${spec.provider}/${spec.model}` })
  }
  return { chain, error: null }
}

/** provider 专属端点环境变量：ASTOCK_AGENT_BASE_URL_<PROVIDER>（provider 大写、非字母数字转下划线） */
export function providerBaseUrlEnvName(provider: string): string {
  return `ASTOCK_AGENT_BASE_URL_${provider.toUpperCase().replace(/[^A-Z0-9]/gu, "_")}`
}

/** 额度回退后重新尝试主模型的间隔（额度通常按数小时窗口重置） */
export const FALLBACK_RETRY_MS = 60 * 60 * 1000

/** 回切决策：clear 表示应清除回退标记；primary 非空表示间隔已满，应切回该主模型 */
export interface PrimaryRevert {
  readonly clear: boolean
  readonly primary: AgentModelOption | undefined
}

export function decidePrimaryRevert(
  modelIndex: number,
  quotaFellBackAt: number | null,
  models: readonly AgentModelOption[],
): PrimaryRevert {
  if (quotaFellBackAt === null) return { clear: false, primary: undefined }
  if (modelIndex === 0) return { clear: true, primary: undefined }
  if (Date.now() - quotaFellBackAt < FALLBACK_RETRY_MS) return { clear: false, primary: undefined }
  return { clear: true, primary: models[0] }
}

export type ModelTargetResolution =
  | { readonly index: number; readonly models: readonly AgentModelOption[] }
  | { readonly error: string }

/** 把用户输入（序号 / 标签 / 链外 provider/model）解析为模型链中的下标，链外模型追加进链 */
export function resolveModelTarget(
  models: readonly AgentModelOption[],
  target: string,
): ModelTargetResolution {
  const ordinal = Number(target)
  const index =
    Number.isInteger(ordinal) && ordinal >= 1
      ? ordinal - 1
      : models.findIndex((option) => option.label === target)
  if (index >= 0 && index < models.length) return { index, models }
  const spec = parseFallbackModelList(target)[0]
  if (spec === undefined) return { error: `无效模型：${target}` }
  const resolved = resolveModelChain({
    provider: spec.provider,
    modelId: spec.model,
    fallbackSpecs: [],
  })
  const option = resolved.chain[0]
  if (resolved.error !== null || option === undefined) {
    return { error: resolved.error ?? `模型不存在：${target}` }
  }
  return { index: models.length, models: [...models, option] }
}

export interface ModelChainHooks {
  readonly onDebug?: ((kind: string, fields: Record<string, unknown>) => void) | undefined
  readonly onModelChange?: (() => void) | undefined
}

/** 模型链游标：当前模型、手动切换、额度耗尽回退与定时回切的有状态封装 */
export class ModelChainCursor {
  #models: readonly AgentModelOption[]
  #index = 0
  #quotaFellBackAt: number | null = null
  readonly #hooks: ModelChainHooks

  constructor(models: readonly AgentModelOption[], hooks: ModelChainHooks = {}) {
    this.#models = models
    this.#hooks = hooks
  }

  get current(): AgentModelOption | undefined {
    return this.#models[this.#index]
  }

  get currentLabel(): string {
    return this.current?.label ?? ""
  }

  get hasNext(): boolean {
    return this.#index + 1 < this.#models.length
  }

  labels(): readonly string[] {
    return this.#models.map((option) => option.label)
  }

  select(agent: Agent, target: string): string {
    const resolution = resolveModelTarget(this.#models, target)
    if ("error" in resolution) throw new Error(resolution.error)
    this.#models = resolution.models
    // 手动选择生效即视为用户接管，取消额度回退的自动回切
    this.#quotaFellBackAt = null
    if (resolution.index === this.#index) return this.currentLabel
    this.#index = resolution.index
    const option = this.#models[resolution.index]
    if (option === undefined) throw new Error(`无效模型：${target}`)
    this.#switch(agent, option, "agent_model_switch", { to: option.label })
    return option.label
  }

  /** 额度回退后按重试间隔切回主模型；返回是否发生了切换 */
  revertToPrimaryIfDue(agent: Agent): boolean {
    const revert = decidePrimaryRevert(this.#index, this.#quotaFellBackAt, this.#models)
    if (revert.clear) this.#quotaFellBackAt = null
    if (revert.primary === undefined) return false
    this.#index = 0
    this.#switch(agent, revert.primary, "agent_fallback_retry", { to: revert.primary.label })
    return true
  }

  /** 额度耗尽时切到下一个备用模型；无备用可切返回 undefined */
  advanceToFallback(agent: Agent, reason: string): AgentModelOption | undefined {
    if (!this.hasNext) return undefined
    const from = this.currentLabel
    this.#index++
    this.#quotaFellBackAt = Date.now()
    const next = this.#models[this.#index]
    if (next === undefined) return undefined
    this.#switch(agent, next, "agent_fallback", { from, to: next.label, reason })
    return next
  }

  #switch(
    agent: Agent,
    option: AgentModelOption,
    kind: string,
    fields: Record<string, unknown>,
  ): void {
    agent.setModel(option.model)
    this.#hooks.onDebug?.(kind, fields)
    this.#hooks.onModelChange?.()
  }
}
