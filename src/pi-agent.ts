import { Agent, type AgentMessage, generateSummary } from "@oh-my-pi/pi-agent-core"
import { getEnvApiKey, getEnvApiKeyName } from "@oh-my-pi/pi-ai"
import { AgentController, type AgentDriver } from "./agent-controller"
import type { AgentExtensionRuntime } from "./agent-extensions"
import { messagesToExchanges } from "./agent-history"
import { parseFallbackModelList, resolveModelChain } from "./agent-models"
import { AgentSessionStore } from "./agent-session-store"
import { createAStockAgentTools } from "./agent-tools"
import type { CommandContext } from "./commands"
import { PiAgentDriver, SYSTEM_PROMPT } from "./pi-agent-driver"
import { ToolCallLogger } from "./tool-call-log"

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
}

export function createPiAgentController(
  context: CommandContext,
  config: PiAgentConfig = {},
  extensions?: AgentExtensionRuntime,
): AgentController {
  const provider = config.provider ?? configuredValue("ASTOCK_AGENT_PROVIDER") ?? "openai"
  const modelId = config.model ?? configuredValue("ASTOCK_AGENT_MODEL") ?? "gpt-4o-mini"
  const modelLabel = `${provider}/${modelId}`
  const configuredBaseUrl =
    config.baseUrl ??
    configuredValue("ASTOCK_AGENT_BASE_URL") ??
    (provider === "openai" ? configuredValue("OPENAI_BASE_URL") : undefined)
  const fallbackSpecs =
    config.fallbackModels === undefined
      ? parseFallbackModelList(configuredValue("ASTOCK_AGENT_FALLBACK_MODELS"))
      : config.fallbackModels.flatMap((entry) => parseFallbackModelList(entry))
  const resolved = resolveModelChain({
    provider,
    modelId,
    baseUrl: configuredBaseUrl,
    fallbackSpecs,
  })
  if (resolved.error !== null || resolved.chain.length === 0)
    return new AgentController(
      new UnavailableAgentDriver(),
      modelLabel,
      resolved.error ?? undefined,
    )
  const primary = resolved.chain[0]
  if (primary === undefined)
    return new AgentController(new UnavailableAgentDriver(), modelLabel, "模型链为空")

  const apiKey = config.apiKey ?? getEnvApiKey(provider)
  const apiKeyName = getEnvApiKeyName(provider)
  const configurationError =
    apiKeyName !== undefined && apiKey === undefined ? `未配置 ${apiKeyName}` : undefined
  const configuredApiKey = config.apiKey
  const tools = createAStockAgentTools(context)
  const toolCallLog = new ToolCallLogger()
  toolCallLog.recordEvent("agent_model_chain", {
    models: resolved.chain.map((option) => option.label),
    apiKeyConfigured: apiKey !== undefined,
    configurationError: configurationError ?? "none",
  })
  const sessionStore = new AgentSessionStore()
  const restoredMessages = sessionStore.load().state.messages
  const agent = new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model: primary.model,
      tools: [...tools],
      ...(restoredMessages.length === 0
        ? {}
        : { messages: [...restoredMessages] as AgentMessage[] }),
    },
    ...(configuredApiKey === undefined ? {} : { getApiKey: () => configuredApiKey }),
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
    resolved.chain,
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
  if (extensions !== undefined) {
    const sync = () => driver.setExtensions(tools, extensions)
    extensions.subscribe(sync)
    sync()
  }
  return new AgentController(driver, () => driver.modelLabel, configurationError, restoredHistory, {
    current: () => driver.modelLabel,
    list: () => driver.modelLabels(),
    select: (target) => driver.selectModel(target),
  })
}

function configuredValue(name: string): string | undefined {
  const value = Reflect.get(Bun.env, name)
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}
