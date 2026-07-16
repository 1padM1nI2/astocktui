import { expect, test } from "bun:test"
import { authorizeAgentTool, withAgentBaseUrl } from "../src/pi-agent"

test("只有用户明确授权时 Pi Agent 才能执行模拟交易", () => {
  expect(authorizeAgentTool("execute_trade", "只分析贵州茅台，不要交易")).toBe(false)
  expect(authorizeAgentTool("execute_trade", "帮我买入 100 股贵州茅台")).toBe(true)
  expect(authorizeAgentTool("execute_trade", "分析当前市场并自动操作模拟账户")).toBe(true)
  expect(authorizeAgentTool("execute_trade", "analysis only, do not trade")).toBe(false)
  expect(authorizeAgentTool("execute_trade", "buy 100 shares of 600519")).toBe(true)
})

test("重置账户需要单独明确授权，读取和刷新工具不受交易门禁影响", () => {
  expect(authorizeAgentTool("reset_paper_account", "帮我分析持仓")).toBe(false)
  expect(authorizeAgentTool("reset_paper_account", "确认重置模拟账户")).toBe(true)
  expect(authorizeAgentTool("get_market_snapshot", "只分析，不要交易")).toBe(true)
  expect(authorizeAgentTool("refresh_data", "刷新全部数据")).toBe(true)
})

test("自定义 Base URL 覆盖模型端点且不修改模型目录对象", () => {
  const bundled = { id: "gpt-4o-mini", baseUrl: "https://api.openai.com/v1" }

  const configured = withAgentBaseUrl(bundled, "https://gateway.example.com/v1/")

  expect(configured.baseUrl).toBe("https://gateway.example.com/v1")
  expect(bundled.baseUrl).toBe("https://api.openai.com/v1")
  expect(() => withAgentBaseUrl(bundled, "not-a-url")).toThrow("Base URL")
})
