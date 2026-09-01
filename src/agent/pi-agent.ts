import { Agent, type AgentMessage, generateSummary } from "@oh-my-pi/pi-agent-core"
import { getEnvApiKey, getEnvApiKeyName } from "@oh-my-pi/pi-ai"
import type { CommandContext } from "../commands/commands"
import { AgentController, type AgentDriver } from "./controller"
import type { AgentExtensionRuntime } from "./extensions"
import { messagesToExchanges } from "./history"
import { createMcpAgentTools } from "./mcp-tools"
import {
  type AgentModelOption,
  parseFallbackModelList,
  providerBaseUrlEnvName,
  resolveModelChain,
} from "./models"
import { PiAgentDriver, SYSTEM_PROMPT } from "./pi-agent-driver"
import { AgentSessionStore } from "./session-store"
import { ToolCallLogger } from "./tool-call-log"
import { createAStockAgentTools } from "./tools"

export interface PiAgentConfig {
  readonly provider?: string
  readonly model?: string
  readonly apiKey?: string
  readonly baseUrl?: string
  readonly fallbackModels?: readonly string[]
}

/** 上下文压缩摘要的长度预算（generateSummary 按 80% 折算输出上限） */
const CONTEXT_SUMMARY_RESERVE_TOKENS = 2048

class UnavailableAgentDriver implements AgentDriver {
  async run(): Promise<void> {}
  clear(): void {}
  abort(): void {}
  usageSummary(): string {
    return ""
  }
}

/** 模型链解析结果，主 agent 与只读调研子任务共用 */
export interface AgentModelChainResolution {
  readonly modelLabel: string
  readonly chain: readonly AgentModelOption[]
  readonly error: string | null
  readonly apiKey: string | undefined
  readonly configuredApiKey: string | undefined
  readonly configurationError: string | undefined
}

/** env（ASTOCK_AGENT_*）与显式配置合并后解析模型链和 API Key，行为与主 agent 一致 */
export function resolveAgentModelChain(config: PiAgentConfig = {}): AgentModelChainResolution {
  const provider = config.provider ?? configuredValue("ASTOCK_AGENT_PROVIDER") ?? "openai"
  const modelId = config.model ?? configuredValue("ASTOCK_AGENT_MODEL") ?? "gpt-4o-mini"
  const fallbackSpecs =
    config.fallbackModels === undefined
      ? parseFallbackModelList(configuredValue("ASTOCK_AGENT_FALLBACK_MODELS"))
      : config.fallbackModels.flatMap((entry) => parseFallbackModelList(entry))
  // 专属 > 全局 > openai 历史变量；备用模型只读自己 provider 的专属变量（openai 兼容历史变量）
  const providerBaseUrl = (name: string): string | undefined =>
    configuredValue(providerBaseUrlEnvName(name)) ??
    (name === "openai" ? configuredValue("OPENAI_BASE_URL") : undefined)
  const configuredBaseUrl =
    config.baseUrl ?? providerBaseUrl(provider) ?? configuredValue("ASTOCK_AGENT_BASE_URL")
  const fallbackBaseUrls: Record<string, string> = {}
  for (const spec of fallbackSpecs) {
    const value = providerBaseUrl(spec.provider)
    if (value !== undefined) fallbackBaseUrls[spec.provider] = value
  }
  const contextWindowRaw = configuredValue("ASTOCK_AGENT_CONTEXT_WINDOW")
  const contextWindow = contextWindowRaw === undefined ? undefined : Number(contextWindowRaw)
  const resolved = resolveModelChain({
    provider,
    modelId,
    baseUrl: configuredBaseUrl,
    contextWindow,
    fallbackSpecs,
    fallbackBaseUrls,
  })
  const apiKey = config.apiKey ?? getEnvApiKey(provider) ?? configuredValue("ASTOCK_AGENT_API_KEY")
  const apiKeyName = getEnvApiKeyName(provider)
  return {
    modelLabel: `${provider}/${modelId}`,
    chain: resolved.chain,
    error: resolved.error,
    apiKey,
    configuredApiKey: config.apiKey,
    configurationError:
      apiKeyName !== undefined && apiKey === undefined ? `未配置 ${apiKeyName}` : undefined,
  }
}

export function createPiAgentController(
  context: CommandContext,
  config: PiAgentConfig = {},
  extensions?: AgentExtensionRuntime,
): AgentController {
  const { modelLabel, chain, error, apiKey, configurationError } = resolveAgentModelChain(config)
  if (error !== null || chain.length === 0)
    return new AgentController(new UnavailableAgentDriver(), modelLabel, error ?? undefined)
  const primary = chain[0]
  if (primary === undefined)
    return new AgentController(new UnavailableAgentDriver(), modelLabel, "模型链为空")

  const tools = [
    ...createAStockAgentTools(context),
    ...(extensions === undefined ? [] : createMcpAgentTools(extensions)),
  ]
  const toolCallLog = new ToolCallLogger()
  toolCallLog.recordEvent("agent_model_chain", {
    models: chain.map((option) => option.label),
    apiKeyConfigured: apiKey !== undefined,
    configurationError: configurationError ?? "none",
  })
  const sessionStore = new AgentSessionStore()
  const sessionState = sessionStore.load().state
  const restoredMessages = sessionState.messages
  const agent = new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model: primary.model,
      tools: [...tools],
      ...(restoredMessages.length === 0
        ? {}
        : { messages: [...restoredMessages] as AgentMessage[] }),
    },
    ...(apiKey === undefined ? {} : { getApiKey: () => apiKey }),
    hideThinkingSummary: true,
  })
  agent.subscribe((event) => {
    if (event.type === "tool_execution_start") {
      toolCallLog.recordStart({ id: event.toolCallId, name: event.toolName, args: event.args })
      return
    }
    if (event.type === "tool_execution_end") {
      toolCallLog.recordEnd({
        id: event.toolCallId,
        name: event.toolName,
        isError: event.isError === true,
        result: event.result,
      })
    }
  })
  const driver: PiAgentDriver = new PiAgentDriver(
    agent,
    chain,
    new Map(tools.map((tool) => [tool.name, tool.label])),
    () => context.memory?.().promptSupplement() ?? [],
    sessionStore,
    undefined,
    (kind, fields) => toolCallLog.recordEvent(kind, fields),
    async (messages) => {
      const model = driver.activeModel
      if (model === undefined || apiKey === undefined) {
        throw new Error("模型或 API Key 未配置，无法压缩上下文")
      }
      return generateSummary([...messages], model, CONTEXT_SUMMARY_RESERVE_TOKENS, apiKey)
    },
  )
  const restoredHistory = messagesToExchanges(restoredMessages as AgentMessage[], (name) =>
    driver.toolLabel(name),
  )
  if (sessionState.thinkingLevel !== undefined) {
    try {
      driver.setThinkingLevel(sessionState.thinkingLevel)
    } catch {
      // 忽略会话中已失效的思考等级
    }
  }
  if (extensions !== undefined) {
    const sync = () => driver.setExtensions(tools, extensions)
    extensions.subscribe(sync)
    sync()
  }
  return new AgentController(
    driver,
    () => driver.modelLabel,
    configurationError,
    restoredHistory,
    {
      current: () => driver.modelLabel,
      list: () => driver.modelLabels(),
      select: (target) => driver.selectModel(target),
    },
    {
      current: () => driver.thinkingLevel,
      list: () => driver.thinkingLevels(),
      select: (target) => driver.setThinkingLevel(target),
    },
  )
}

function configuredValue(name: string): string | undefined {
  const value = Reflect.get(Bun.env, name)
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}
