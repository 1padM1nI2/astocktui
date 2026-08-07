import type { AgentMessage } from "@oh-my-pi/pi-agent-core"
import type { AgentExchangeView } from "./controller"

const MAX_SUMMARY_LENGTH = 120

interface MutableExchange {
  user: string
  answer: string
  tools: MutableToolView[]
}

interface MutableToolView {
  id: string
  name: string
  label: string
  status: "completed" | "error"
  summary?: string
}

export function messagesToExchanges(
  messages: readonly AgentMessage[],
  label: (name: string) => string = (name) => name,
): AgentExchangeView[] {
  const exchanges: MutableExchange[] = []
  for (const message of messages) {
    if (message.role === "user") {
      const text = userText(message.content)
      if (text.trim().length === 0) continue
      exchanges.push({ user: text, answer: "", tools: [] })
      continue
    }
    const current = exchanges.at(-1)
    if (current === undefined) continue
    if (message.role === "assistant") appendAssistant(current, message, label)
    else if (message.role === "toolResult") appendToolResult(current, message)
  }
  return exchanges
}

function userText(content: string | readonly { type: string; text?: string }[]): string {
  if (typeof content === "string") return content
  return content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("\n")
}

function appendAssistant(
  exchange: MutableExchange,
  message: AgentMessage,
  label: (name: string) => string,
): void {
  if (message.role !== "assistant") return
  let text = ""
  for (const block of message.content) {
    if (block.type === "text") {
      text += block.text
    } else if (block.type === "toolCall") {
      exchange.tools.push({
        id: block.id,
        name: block.name,
        label: label(block.name),
        status: "completed",
      })
    }
  }
  if (text.trim().length === 0) return
  exchange.answer = exchange.answer.length === 0 ? text : `${exchange.answer}\n\n${text}`
}

function appendToolResult(exchange: MutableExchange, message: AgentMessage): void {
  if (message.role !== "toolResult") return
  const tool = exchange.tools.find((candidate) => candidate.id === message.toolCallId)
  if (tool === undefined) return
  tool.status = message.isError ? "error" : "completed"
  const summary = summarizeContent(message.content)
  if (summary.length > 0) tool.summary = summary
}

function summarizeContent(content: readonly { type: string; text?: string }[]): string {
  for (const block of content) {
    if (block.type !== "text" || typeof block.text !== "string") continue
    const compact = block.text.replace(/\s+/gu, " ").trim()
    if (compact.length === 0) continue
    return compact.length > MAX_SUMMARY_LENGTH
      ? `${compact.slice(0, MAX_SUMMARY_LENGTH - 3)}...`
      : compact
  }
  return ""
}
