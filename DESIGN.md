# AStockTUI Design System

## 0. Research Log

- Embedded references: shortlisted `kraken.md`, `warp.md`, and `clickhouse.md`; picked the operational `taste-skill.md` direction with `kraken.md` only for data-dense financial hierarchy, while excluding its purple accent because A-share price semantics dominate.
- Lazyweb: skipped because this terminal-native demo has no browser-surface research requirement.
- Imagen drafts: skipped because the product is a text TUI; real terminal rendering is the visual contract.

## 1. Atmosphere & Identity

A quiet market-intelligence console: dense, stable, and keyboard-led. Its signature is three synchronized workspaces, where market facts, news events, and agent reasoning keep one shared stock context without competing for attention.

## 2. Color

| Role | Terminal token | Usage |
| --- | --- | --- |
| Surface | default background | Main canvas |
| Text | bright white | Primary data |
| Muted | bright black | Labels and dividers |
| Up | red | Positive price and buying pressure |
| Down | green | Negative price and selling pressure |
| Flat | white | Unchanged values |
| Focus | cyan reverse-video | Active tab and focused row |
| Pending | yellow | News urgency and running tools |
| Error | bright red | Failures and stale connections |

Rules: color is semantic, never decorative. Each rendered line closes ANSI styling. Red means up and green means down throughout the application.

## 3. Typography

- Primary and numeric font: the terminal's configured monospace font.
- Chinese text uses `visibleWidth()` and `truncateToWidth()`; JavaScript string length is never used for visible layout.
- Numbers are right-aligned: price and percent use two decimal places; stock codes use six cells.

## 4. Spacing & Layout

- Base spacing is one terminal cell.
- `>= 160` columns: watchlist, simulated portfolio, and news share the upper region; Agent and recent trades share the lower region, with Agent as the wider primary panel and the lower region occupying at least half of the terminal height.
- `120-159` columns: the active workspace has a compact header and data body.
- `80-119` columns: one workspace occupies the screen; keyboard switching retains the shared context.
- `< 80` columns: the narrow layout remains usable through truncation, with no line overflow.

## 5. Components

### WorkspaceFocus
- Structure: no standalone tab row; the active panel uses a cyan border and a visible `◆` title marker.
- States: active, inactive, focused.
- Keyboard: Tab, Shift+Tab, Left, Right cycle focus without changing panel content state.

### MarketWorkspace
- Structure: quote header, ASCII price chart, and a runtime-configurable watchlist table.
- States: placeholder, populated, compact, refreshing, and refresh-failed; at least one stock must remain so the trend focus is defined.
- Management: `/watch list`, `/watch add <code>`, and `/watch remove <code>` update the table immediately; added codes are normalized to `SH` or `SZ` and fetched without restarting.
- Storage: watchlist order is atomically persisted as versioned JSON beside the paper account in `watchlist.json`; invalid files abort loading instead of silently replacing user selections.
- Accessibility: every field has stable textual labels; color is supplemental to sign text.
- Keyboard: Up, Down, PageUp, PageDown, Home, End scroll the watchlist when it overflows the panel.

### HotRankWorkspace
- Structure: an alternate view of the market panel showing the Eastmoney 股吧 popularity board: rank, code, name, latest price, change percent, and rank shift (red `↑N` rising, green `↓N` falling); suspended quotes render as `--`.
- Data: loads lazily on first view via the login-free popularity API, then batches quote enrichment; quote failure degrades to bare codes without failing the board.
- States: placeholder, populated, refreshing, refresh-failed; header shows source, update time, and the `R刷新 · H返回` hints.
- Keyboard: `h` toggles the market panel between watchlist and popularity board; `R` refreshes whichever board is visible; Up, Down, PageUp, PageDown, Home, End scroll the board when it overflows the panel.

### MarketOverviewService
- Coverage: seven major A-share indices, market-wide rise/fall distribution, counts at or beyond ±10%, industry leaders and laggards, aggregated industry turnover, and top gaining/losing stocks.
- Sources: index quotes use `stock-api`; breadth uses Eastmoney's public distribution endpoint; industry and mover rankings use Sina Finance public endpoints with GB18030 decoding where required.
- Reliability: the snapshot is cached for 60 seconds, supports explicit refresh, marks each dataset in `availability`, and reports partial-source errors instead of representing missing data as zero.
- Agent contract: `get_market_overview` is mandatory for broad-market, style, sector, and sentiment analysis; watchlist quotes remain the source for individual-stock analysis.

### PortfolioWorkspace
- Structure: simulated account summary, available cash, market value, unrealized profit, total return, and position rows.
- States: empty, populated, profit, loss; the default account starts with ¥100,000 cash and no positions.
- Scope: both manual commands and Pi Agent tools reuse the same paper-trading service and risk checks.
- Keyboard: Up, Down, PageUp, PageDown, Home, End scroll summary and position rows when they overflow the panel.

### PaperTradingService
- Execution: market-style simulated fills use the latest loaded quote; if a valid stock code is missing, the original command fetches that quote on demand and continues automatically without a second command.
- A-share rules: buy and sell quantities use 100-share lots; shares bought today become sellable on a later Shanghai calendar date as a session-level T+1 approximation; insufficient cash or sellable shares reject the order.
- Costs: both sides charge 0.03% commission with a ¥5 minimum and 0.001% transfer fee; sells additionally charge 0.05% stamp duty.
- Accounting: buy fees enter average cost, sells record realized profit, quote refreshes mark positions to market, and every fill has an immutable `SIM-NNNN` record.
- Lifecycle: the default account starts with ¥100,000 and persists cash, positions, T+1 lots, mark prices, sequence, and trade records after every successful mutation; reset requires `/account reset confirm` and persists immediately.
- Storage: versioned JSON is atomically replaced at `%LOCALAPPDATA%\\AStockTUI\\paper-account.json` on Windows, `$XDG_DATA_HOME/astocktui/paper-account.json` when configured, or `~/.astocktui/paper-account.json` as fallback. Invalid state aborts loading instead of silently resetting assets.

### BacktestCommand
- Scope: `/backtest <代码[,代码…]|watch> [策略] [参数=值 …]`（别名 `/bt`）用东财前复权日 K 回测 A 股交易策略，验证策略在历史数据上的可行性；逗号分隔多代码（上限 20 只）或 `watch`（整个自选股列表）进入批量模式。
- Strategies: `ma-cross`（fast=5 slow=20 双均线交叉）、`rsi`（period=14 oversold=30 overbought=70 超买超卖）、`breakout`（entry=20 exit=10 通道突破）；`days`（30–1000，默认 250）与 `cash`（默认 ¥100,000）为保留参数，未知策略或参数键报错并列出可选项。
- Execution: 策略在第 i 日收盘出信号，第 i+1 日开盘成交；买入按含费用可负担的最大整手满仓，卖出清仓；信号成交机制天然满足 T+1。费用口径与 PaperTradingService 一致（佣金万三最低五元、卖出印花税万五、过户费十万分之一）。
- Output: 单只标的输出区间与交易日数、期末资产、总收益、年化（252 个交易日折算）、最大回撤、夏普、交易次数、胜率、买入持有基准与超额收益、40 列权益走势 sparkline、最近五笔成交；批量模式输出按总收益降序的对比表（代码、总收益、年化、回撤、胜率、交易、超额），单只失败降级为行内原因。红涨绿跌带符号，所有行宽不超过 80 列。
- Data: 前复权（fqt=1）保证分红拆股后均线信号不断裂；网络或 HTTP 错误转为明确的失败输出，历史数据少于策略预热期加两根时报数据不足。

### ScreenCommand
- Scope: `/screen [策略] [参数=值 …] [source=watch|hot]` 按策略信号选股：扫描自选股（默认）或股吧人气榜（前 50 只），报告最新交易日产生买入或卖出信号的标的。
- Output: 买入信号（红）与卖出信号（绿）分组列出代码、收盘价与信号日期，附无信号与失败统计；失败标的逐行给出原因（最多三条）。

### BacktestAgentTools
- Tools: `run_backtest`（单只回测，返回区间、指标与最近十笔成交）、`batch_backtest`（多只或自选股批量回测，按总收益降序返回结构化行）、`screen_stocks`（按策略信号扫描自选股或热榜，返回 hits/quiet/failures 分组）；三者与 `/backtest`、`/screen` 命令共用同一数据、策略、引擎与筛选模块，均为只读 approval。
- Prompt: 系统提示引导 Agent 在用户要求验证策略或按信号选股时调用这些工具，并要求解读时声明历史模拟不代表未来收益。

### TradeHistoryWorkspace
- Structure: a focusable read-only workspace (fifth tab, after Agent) showing persisted fills newest-first, with order ID, side, code, quantity, execution price, date, fees, and realized profit on sells.
- States: empty, buy, profitable sell, losing sell; profit uses A-share red and loss uses green while signed values remain visible without color.
- Responsive behavior: shown beside Agent at `>= 160` columns; narrower terminals show it full-width when focused and retain `/trades` for record lookup.
- Keyboard: Up, Down, PageUp, PageDown, Home, End scroll the fill history when it overflows the panel.

### NewsWorkspace
- Structure: scrolling timestamped headlines with source labels and optional source URLs.
- Coverage: up to 40 deduplicated items from MKTNews, WallstreetCN quick/news, CLS telegraph/depth, Xueqiu hot stocks, Gelonghui, FastBull, and Jin10; unavailable sources degrade independently.
- Agent access: `get_financial_news` returns all loaded items or filters them by keyword, source, and limit while reporting available sources and match count.
- States: populated, empty, selected, stale.
- Keyboard: Up, Down, PageUp, PageDown.

### AgentWorkspace
- Structure: bordered primary panel backed by `@oh-my-pi/pi-agent-core`, with streamed Markdown answers, live tool lifecycle rows, provider/model identity, bottom-anchored command suggestions, and a bottom-pinned prompt input. The subtitle line also shows the long-term memory entry count and, once a turn completes, the cumulative usage summary (cache hit rate, input/output tokens, steps).
- Markdown: Pi TUI parses headings, emphasis, inline/code blocks, links, quotes, rules, and ordered/unordered lists into ANSI terminal styles. Raw markers are removed, deep headings are flattened for compact panels, unordered bullets use `•`, and CJK-aware wrapping keeps every rendered line within the supplied width.
- Configuration: `ASTOCK_AGENT_PROVIDER` and `ASTOCK_AGENT_MODEL` select any bundled Pi model; the default is `openai/gpt-4o-mini`. Endpoints resolve per provider: `ASTOCK_AGENT_BASE_URL_<PROVIDER>` (uppercased provider id, non-alphanumerics become `_`) wins for that provider, then the legacy `OPENAI_BASE_URL` for OpenAI models, and `ASTOCK_AGENT_BASE_URL` remains a global override for the primary model only—it never leaks into fallback-chain providers. Only HTTP(S) endpoints are accepted, and an invalid URL on any chain entry fails chain resolution with an explicit error. Provider credentials use Pi's standard environment variables such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GEMINI_API_KEY`. Missing credentials produce an explicit unconfigured state without issuing a request.
- Tools: status, watchlist quotes, full-market overview, filtered multi-source financial news, 股吧 popularity board, portfolio, trade history, refresh, watchlist management, trade preview, simulated trade execution, simulated account reset, long-term memory, and workspace focus all use the same application services as keyboard commands.
- Trading safety: Agent orders only affect the persisted local paper account and retain lot, cash, fee, and T+1 checks. `execute_trade` is blocked unless the current user request explicitly authorizes trading or autonomous simulated operation; negative instructions win. Account reset additionally requires explicit reset wording and the tool's `RESET` confirmation.
- States: unconfigured, waiting, streaming, tool-running, tool-complete, completed, error, command-running, and input-focus; provider and asynchronous command results replace pending states when complete.
- Diagnostics: every tool call (timestamp, name, arguments, result, error flag, duration) is appended as JSONL to `agent-tool-calls.log` in the app-data directory, rotated at 2 MiB with a single `.1` backup. Each completed model step also logs an `agent_usage` event (input/output/cache-read tokens and cumulative cache hit rate), making DeepSeek prefix-cache effectiveness observable.
- Cache-first context: the system prompt keeps stable content first and volatile memory last; tool results are capped at 32 KB once when entering the context and never rewritten afterward; when the estimated prompt reaches 85% of the model context window, the next turn first compacts older exchanges into a summary while keeping the latest exchange verbatim, avoiding a guaranteed context-overflow retry at full prompt price.
- Session persistence: the LLM message history is saved to `agent-session.json` in the app-data directory after every turn (capped at the latest 200 messages, cut at a user-turn boundary) and restored on startup, so the agent remembers previous conversations across restarts; restored exchanges render above the current one in the panel, and each new prompt archives the previous exchange into that history; `/clear` wipes the stored session, and a corrupt file silently starts a fresh one.
- Keyboard: Enter submits plain text to Pi Agent; Shift+Enter, Alt+Enter, or Ctrl+Enter inserts a newline and pasted line breaks are preserved (the input area wraps and grows up to three lines); `/` from any workspace focuses Agent and starts a fresh application command; Tab, Shift+Tab, Left, and Right move focus while the palette is closed; Ctrl+C exits.

### MemoryService
- Scope: long-term agent memory with two kinds — `pattern` (market/operation rules) and `evaluation` (trade assessments) — sourced from `system` (deterministic capture), `agent` (tool-recorded), or `dream` (consolidation output).
- Capture: every simulated fill is recorded as a system evaluation entry (side, code, quantity, price, fees, realized profit on sells) via idempotent `${tradeId}:${executedAt}` dedupe; sync runs lazily on memory operations, so account resets never replay history.
- Dream: the task scheduler enqueues one `dream` event per Shanghai date when the user has been idle for at least `dreamIdleMinutes` (default 30) outside continuous auction; the agent then reads all memories, merges duplicates, generalizes evaluations into patterns, prunes stale entries, and writes the consolidated list back with `replace_memories`. `/memory dream` triggers the same flow manually.
- Agent contract: `remember_memory`, `list_memories`, `forget_memory`, and `replace_memories` manage the store; the latest 50 entries are injected into the system prompt every turn, with newest data winning on conflict.
- Commands: `/memory [list|clear|dream]` lists entries newest-first with source and date, clears the store (keeping trade-sync markers), or fires a dream; clearing never replays historical fills.
- Storage: versioned JSON is atomically replaced at the same app-data resolution as the paper account under `memory.json`; invalid files abort loading instead of silently dropping memories.

### CommandPalette
- Scope: application-local commands only; it never executes shell commands.
- Registry: command metadata is the single source for parsing, filtering, completion, `/help`, and visible descriptions.
- Commands: `/help`, `/status`, `/focus`, `/refresh`, `/watch`, `/portfolio`, `/preview`, `/buy`, `/sell`, `/trades`, `/backtest`, `/screen`, `/account reset confirm`, `/clear`, `/memory`, `/quit`, and `/exit`.
- Keyboard: typing `/` from any workspace focuses Agent and opens the palette; Up and Down select; Tab completes; Enter executes an exact command; Esc closes the palette. Suggestions and keyboard help remain immediately above the prompt.
- Plain text that does not start with `/` remains an Agent question, except the exact bare commands `quit` and `exit`, which exit the application.

## 6. Motion & Interaction

There are no decorative animations. Market data refreshes every 15 seconds and financial news every 60 seconds after an immediate startup refresh; in-flight refreshes are deduplicated and timers stop with the application. Workspace focus changes are immediate.

## 7. Depth & Surface

Use dividers, whitespace, and bordered sections to establish hierarchy. Decorative nested boxes are allowed when they improve grouping without crowding the terminal. The active workspace is denoted by both a cyan border and a visible `◆` title marker, so focus does not depend on color alone.

## 8. Accessibility Constraints & Accepted Debt

- Full keyboard reachability is mandatory.
- Colors always accompany text signs, labels, or tool states.
- CJK text must not cause column drift or overflow.
- Accepted debt: market, news, and configured LLM providers are third-party services whose availability, latency, pricing, and models can change; local account, watchlist, and Agent conversation data are not synchronized across machines. Trading remains simulation-only with no real brokerage connection.
