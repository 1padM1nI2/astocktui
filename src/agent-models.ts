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
    chain.push({ model: fallback, label: `${spec.provider}/${spec.model}` })
  }
  return { chain, error: null }
}
