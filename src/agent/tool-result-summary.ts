/** 从工具结果中提取首段文本作为摘要，供面板展示 */
export function summarizeToolResult(result: unknown): string {
  if (typeof result !== "object" || result === null) return "工具调用完成"
  const content = Reflect.get(result, "content")
  if (!Array.isArray(content)) return "工具调用完成"
  for (const item of content) {
    if (typeof item !== "object" || item === null || Reflect.get(item, "type") !== "text") continue
    const text = Reflect.get(item, "text")
    if (typeof text !== "string") continue
    const compact = text.replace(/\s+/gu, " ").trim()
    if (compact.length > 0) return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact
  }
  return "工具调用完成"
}
