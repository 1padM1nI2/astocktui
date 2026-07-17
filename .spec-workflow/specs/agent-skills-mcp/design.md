# Design Document

## Overview

本设计将 OMP 的“轻量 Skill 元数据 + 按需正文读取”和“配置驱动 MCP manager + 命名空间工具桥接”移植到 AStockTUI 的 Pi Agent。应用启动时同步加载本地工具和 Skill 元数据；MCP server 在后台并行连接，成功后动态更新 `Agent.setTools()`。单个扩展故障被隔离，始终不影响行情、新闻、组合与模拟交易本地工具。

MCP 配置和 Skill 目录兼容 OMP 的优先级与文件形状，但本应用不实现 OMP 的 OAuth 凭据代理或自动学习 Skill：前者需要浏览器回调和安全凭据存储，后者不属于市场终端的运行时职责。远程认证使用显式 headers 或环境变量占位符。

## Steering Document Alignment

### Technical Standards (tech.md)

未提供 steering `tech.md`。设计遵循 `AGENTS.md`：Bun、TypeScript、行为测试先行、源文件不超过 250 个非空行、所有 TUI 文本用 `fitLine`/`visibleWidth` 收口。

### Project Structure (structure.md)

未提供 steering `structure.md`。新实现沿用既有扁平 `src/` 服务模块、`src/components/` 视图模块和 `test/*.test.ts` 行为测试布局；MCP 子系统使用 `src/mcp/` 按 config、manager、tool bridge 分层。

## Code Reuse Analysis

### Existing Components to Leverage

- **`Agent` / `AgentTool`（`@oh-my-pi/pi-agent-core`）**：`Agent.setTools()` 支持动态替换工具；`AgentTool.parameters` 接受 JSON Schema，可直接桥接 MCP `inputSchema`。
- **`PiAgentDriver`（`src/pi-agent.ts`）**：保留流式事件、`beforeToolCall` 模拟交易防线；扩展为接收能力运行时和在 MCP 工具变化时刷新 Agent 工具。
- **`createAStockAgentTools`（`src/agent-tools.ts`）**：持续作为基础本地工具集合；MCP 工具只追加，绝不替换。
- **`CommandPrompt` / `executeCommand`（`src/command-prompt.ts`、`src/commands.ts`）**：承载 `/mcp` 和动态 `/skill:<name>`，保留现有补全、错误和异步结果模式。
- **`MarketIntelligenceApp.onUpdate`（`src/app.ts`）**：在后台 MCP 连接、重连或 reload 完成时请求 TUI 重绘。
- **`fitLine` / `visibleWidth`（`src/width.ts`）**：用于所有 Skill/MCP 状态和命令输出。

### Integration Points

- **Agent 初始化**：`createPiAgentController` 创建 `AgentExtensionRuntime`。其同步返回 Skill 工具与元数据；其异步 manager 在连接状态变化时调用 `agent.setTools([...base, ...skill, ...mcp])`。
- **命令上下文**：`CommandContext` 新增受限的 `skills` 与 `mcp` 门面，避免 `commands.ts` 依赖 SDK transport。
- **应用退出**：`MarketIntelligenceApp` 暴露 `dispose()`；`main.ts` 的 `onQuit` 在停止 TUI 前关闭 MCP manager。reload 保证旧 transport 已关闭后才替换工具集。
- **依赖**：新增官方 `@modelcontextprotocol/sdk`，使用其 `Client`、`StdioClientTransport`、`StreamableHTTPClientTransport`、`SSEClientTransport`。不自行实现 JSON-RPC framing。

## Architecture

```mermaid
graph TD
    Config[OMP-compatible config discovery] --> Skills[SkillRegistry]
    Config --> MCPConfig[MCP config validation]
    Skills --> SkillRead[restricted read skill tool]
    Skills --> SkillCommands[/skill:name command resolver]
    MCPConfig --> Manager[MCPManager]
    Manager --> Client[official MCP SDK clients]
    Client --> Bridge[MCP tool bridge]
    SkillRead --> Runtime[AgentExtensionRuntime]
    SkillCommands --> Runtime
    Bridge --> Runtime
    Runtime --> Driver[PiAgentDriver]
    Driver --> Agent[Pi Agent setTools]
    Commands[/mcp commands] --> Runtime
    Runtime --> App[MarketIntelligenceApp redraw and shutdown]
```

### Modular Design Principles

- **Single File Responsibility**：Skill 发现和 URI 读取不依赖 MCP；MCP config 不创建网络连接；manager 不直接渲染 TUI；tool bridge 不解析配置。
- **Component Isolation**：Agent 面板仅显示已有工具生命周期行；MCP/Skill 状态通过命令结果呈现，不在组件中发起 I/O。
- **Service Layer Separation**：`AgentExtensionRuntime` 是唯一面向应用的 facade，封装 registry、manager、工具合并和 shutdown。
- **Utility Modularity**：环境变量插值、frontmatter 解析、MCP 名称净化、JSON Schema 保护各自独立且可单测。

## Components and Interfaces

### `SkillRegistry` — `src/skills.ts`

- **Purpose:** 按 OMP 优先级扫描一层 Skill 目录、解析 `SKILL.md`、保留诊断并安全解析 `skill://` URI。
- **Interfaces:**

```ts
export interface DiscoveredSkill {
  readonly name: string
  readonly description: string
  readonly body: string
  readonly filePath: string
  readonly baseDir: string
  readonly source: SkillSource
  readonly hide: boolean
  readonly disableModelInvocation: boolean
  readonly alwaysApply: boolean
}

export interface SkillRegistry {
  readonly skills: readonly DiscoveredSkill[]
  readonly diagnostics: readonly ExtensionDiagnostic[]
  read(uri: string): Promise<{ text: string; path: string }>
  invoke(name: string, args: string): SkillInvocation
}
```

- **Dependencies:** Bun file APIs, `path`, OMP-compatible source roots.
- **Reuses:** `fitLine` for command output only; does not render itself.

Discovery priority is `native .omp` > `.agents` > `.claude` > `.codex` > `.github`; within one provider user scope precedes project scope. First valid name wins. Each root scans only `*/SKILL.md`.

`read()` rejects malformed scheme, unknown name, absolute path, `..`, and any resolved path outside the selected `baseDir`. `alwaysApply` bodies are included in the generated system-prompt supplement; all other visible skills contribute only `name + description` and are read on demand by the restricted `read` tool.

### Restricted Skill Read Tool — `src/skill-tool.ts`

- **Purpose:** 向 Agent 暴露 OMP-compatible `skill://` 内容而不增加通用文件系统读取权限。
- **Interfaces:**

```ts
createSkillReadTool(registry: SkillRegistry): AgentTool
buildSkillPrompt(skills: readonly DiscoveredSkill[]): readonly string[]
```

- **Dependencies:** `SkillRegistry`、Pi `AgentTool`。
- **Reuses:** 既有 `jsonResult` 格式和 Agent 工具生命周期渲染。

工具名为 `read`，schema 仅接受 `path: string`；只有 `skill://` scheme 有效。返回 `{ path, text }`，错误为清晰的工具结果。它不读取工作目录任意文件。

### MCP Config — `src/mcp/config.ts`

- **Purpose:** 发现、展开和验证 OMP 风格 MCP JSON。
- **Interfaces:**

```ts
export type McpTransportKind = "stdio" | "http" | "sse"
export interface McpServerConfig {
  readonly name: string
  readonly type: McpTransportKind
  readonly command?: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly cwd?: string
  readonly url?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly timeout: number
  readonly source: McpConfigSource
}
export interface McpConfigLoadResult {
  readonly servers: readonly McpServerConfig[]
  readonly diagnostics: readonly ExtensionDiagnostic[]
}
loadMcpConfigs(cwd: string, home: string, env: Record<string, string | undefined>): Promise<McpConfigLoadResult>
```

- **Dependencies:** Bun JSON file APIs and URL parser only.
- **Reuses:** OMP config precedence and validation rules from `mcp-config.md`.

Sources are evaluated in priority order: project `.omp/mcp.json`, project `mcp.json`, project `.mcp.json`, then user `~/.omp/agent/mcp.json`; first server name wins. User `disabledServers` suppresses all discovered servers. `${VAR}` and `${VAR:-default}` are expanded recursively for strings; unresolved placeholders remain literal. `!` shell interpolation is intentionally unsupported.

### MCP Manager — `src/mcp/manager.ts`

- **Purpose:** 用官方 SDK 建立/关闭连接、列出工具、隔离错误、有限重连并通知工具变化。
- **Interfaces:**

```ts
export type McpConnectionState = "connecting" | "connected" | "disconnected" | "error"
export interface McpServerStatus {
  readonly name: string
  readonly state: McpConnectionState
  readonly source: McpConfigSource
  readonly toolCount: number
  readonly error?: string
}
export interface McpManager {
  connect(): Promise<void>
  reload(): Promise<void>
  reconnect(name: string): Promise<void>
  getStatuses(): readonly McpServerStatus[]
  getTools(): readonly AgentTool[]
  dispose(): Promise<void>
}
```

- **Dependencies:** `@modelcontextprotocol/sdk`, `McpConfigLoadResult`, `McpToolBridge`.
- **Reuses:** `AbortSignal.timeout`, existing application update callback.

Per server the manager constructs a transport, calls `client.connect()`, `listTools()`, then stores the client and server tools. `stdio` uses command/args/env/cwd; `http` and `sse` require HTTP(S) URLs. Each connection is independently awaited with timeout. A closed/error transport retries with 500/1000/2000/4000 ms delay and trips a five-failure/30-second circuit breaker. `reload()` tears down all existing clients before rediscovery and reconnect; `dispose()` cancels timers and closes every SDK client.

### MCP Tool Bridge — `src/mcp/tool-bridge.ts`

- **Purpose:** 将 SDK MCP tool definition 和 `callTool` 结果转换为 Pi `AgentTool`。
- **Interfaces:**

```ts
bridgeMcpTools(server: McpServerConnection, definitions: readonly McpToolDefinition[]): readonly AgentTool[]
sanitizeMcpToolName(serverName: string, remoteName: string): string
```

- **Dependencies:** MCP SDK types、Pi `AgentTool`、`jsonResult` equivalent.
- **Reuses:** Pi AI 支持的 JSON Schema `parameters` 类型。

工具名固定为 `mcp__<sanitized-server>_<sanitized-tool>`。桥接保留 remote description 和 JSON Schema；调用时传递 validated arguments 给 `client.callTool({ name, arguments })`，把 text/image content 与 `isError` 转为 Agent tool result。远端 schema/内容异常产生该工具的错误结果，不抛出到整个 Agent session。

### Agent Extension Runtime — `src/agent-extensions.ts`

- **Purpose:** 聚合 Skill 与 MCP 能力，动态构造 Agent system prompt 和工具集，暴露命令门面。
- **Interfaces:**

```ts
export interface AgentExtensionRuntime {
  initialize(): Promise<void>
  getSystemPromptSupplement(): readonly string[]
  getTools(): readonly AgentTool[]
  invokeSkill(name: string, args: string): Promise<SkillInvocation>
  mcpCommand(args: readonly string[]): Promise<CommandResult>
  dispose(): Promise<void>
}
```

- **Dependencies:** `SkillRegistry`、Skill read tool、`McpManager`。
- **Reuses:** `Agent.setSystemPrompt`, `Agent.setTools`, `CommandResult`。

初始化同步加载 skills 并立即注册 Skill read 工具；MCP 在后台连接。manager 每次工具集或状态变更时，runtime 重新合并基础本地工具、Skill read 工具和 MCP tools，并通过回调由 `PiAgentDriver` 调用 `agent.setTools()`。同一时刻不修改现有本地工具的定义或模拟交易 gate。

### Commands and UI Wiring

- **Purpose:** 通过既有命令面板提供显式 Skill 注入和 MCP 运维。
- **Interfaces:**

```text
/skill:<name> [args]  -> 注入 Skill 正文与 User args 后提交给 Agent
/mcp list             -> 显示 server、来源、状态、工具数、诊断
/mcp reload           -> 关闭、重发现、重连并刷新 Agent tools
/mcp reconnect <name> -> 重连单个 server
```

- **Dependencies:** `CommandContext` 新增 extension facade；`CommandPrompt` 增加运行时 Skill suggestion provider。
- **Reuses:** `filterCommands`、`CommandResult`、底部命令面板、`AgentController.prompt`。

`/skill:<name>` 不注册成静态命令名：`executeCommand` 在未知命令分支识别 `skill:` 前缀并委托 runtime。`CommandPrompt.view` 接收动态 command provider，将可模型调用的 Skill 以 `skill:<name>` 加入 suggestion 列表。隐藏或 `disableModelInvocation` 的 Skill 不在 suggestions 中，但 `hide` Skill 仍可显式调用。

## Data Models

### Skill Source and Diagnostic

```ts
type SkillSource = "omp-project" | "omp-user" | "agents-project" | "agents-user" |
  "claude-project" | "claude-user" | "codex-project" | "codex-user" | "github-project"

interface ExtensionDiagnostic {
  scope: "skill" | "mcp"
  subject: string
  source?: string
  message: string
}
```

### MCP Raw Config and Status

```ts
interface McpConfigDocument {
  $schema?: string
  mcpServers?: Record<string, RawMcpServerConfig>
  disabledServers?: string[]
}

interface RawMcpServerConfig {
  type?: "stdio" | "http" | "sse"
  enabled?: boolean
  timeout?: number
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
}
```

### Runtime Tool Set

```ts
interface ExtensionToolSet {
  readonly local: readonly AgentTool[]
  readonly skill: readonly AgentTool[]
  readonly mcp: readonly AgentTool[]
}
```

The final Agent tool order is local → skill → MCP, with duplicate names rejected and diagnostic output retained.

## Error Handling

### Error Scenarios

1. **Skill discovery/file/frontmatter error**
   - **Handling:** Record `ExtensionDiagnostic`; skip only that Skill.
   - **User Impact:** `/mcp list` diagnostics and `/skill:<name>` explanatory error; other Skills remain usable.

2. **Skill URI escape or unknown asset**
   - **Handling:** Reject before filesystem read; report tool error without attempted fallback.
   - **User Impact:** Agent receives a bounded "Skill path invalid/not found" result.

3. **Invalid MCP config**
   - **Handling:** Validate name, type, command/url exclusivity, URL protocol, numeric timeout and string maps before SDK construction.
   - **User Impact:** `/mcp list` marks that server as error; local Agent remains ready.

4. **MCP connect/list/call failure**
   - **Handling:** Per-server state becomes error/disconnected; retry only unexpected closure with capped backoff. `callTool` returns tool-level error.
   - **User Impact:** Healthy MCP and local tools continue; tool row shows failure reason.

5. **Reload/shutdown race**
   - **Handling:** Generation token invalidates late connect callbacks; all client close promises are awaited through `Promise.allSettled`.
   - **User Impact:** No stale MCP tool appears after reload; no orphan stdio process remains on exit.

6. **Secret expansion or diagnostics**
   - **Handling:** Never retain expanded header/env values in status, prompt, errors or serialized diagnostics; retain only server name/source and generic failure message.
   - **User Impact:** Config debugging remains possible without token exposure.

## Testing Strategy

### Unit Testing

- `skills.test.ts`: source order, duplicate first-wins, frontmatter flags, malformed file isolation, non-recursive scanning, `skill://` traversal/absolute escape rejection, always-apply/system-prompt rendering.
- `mcp-config.test.ts`: config precedence, `disabledServers`, `${VAR}`/default/literal behavior, field validation, URL and secret-redaction behavior.
- `mcp-tool-bridge.test.ts`: name sanitization, JSON Schema preservation, text/image/error result conversion and remote exception containment.
- `agent-extensions.test.ts`: local/skill/MCP tool merge, dynamic agent update callback and stale generation suppression.

### Integration Testing

- Spawn a deterministic JSONL fixture MCP server to verify stdio initialize/list/call/close and no process leak.
- Use local Bun HTTP and SSE fixture servers to verify initialize/list/call, timeout and failure isolation.
- Exercise `/mcp list`, `/mcp reload`, `/mcp reconnect` and `/skill:<name>` through `MarketIntelligenceApp.handleInput`.

### End-to-End Testing

- Start `createDemo` with project `.omp/skills` and `.omp/mcp.json`; verify the Agent advertises skills, reads `skill://`, calls a namespaced MCP tool, reloads after config change, and exits without remaining fixture process.
- Verify no-extension startup remains byte-compatible in visible local tool behavior and all output lines fit terminal widths.
