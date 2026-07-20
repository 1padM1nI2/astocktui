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

### MarketOverviewService
- Coverage: seven major A-share indices, market-wide rise/fall distribution, counts at or beyond ±10%, industry leaders and laggards, aggregated industry turnover, and top gaining/losing stocks.
- Sources: index quotes use `stock-api`; breadth uses Eastmoney's public distribution endpoint; industry and mover rankings use Sina Finance public endpoints with GB18030 decoding where required.
- Reliability: the snapshot is cached for 60 seconds, supports explicit refresh, marks each dataset in `availability`, and reports partial-source errors instead of representing missing data as zero.
- Agent contract: `get_market_overview` is mandatory for broad-market, style, sector, and sentiment analysis; watchlist quotes remain the source for individual-stock analysis.

### PortfolioWorkspace
- Structure: simulated account summary, available cash, market value, unrealized profit, total return, and position rows.
- States: empty, populated, profit, loss; the default account starts with ¥100,000 cash and no positions.
- Scope: both manual commands and Pi Agent tools reuse the same paper-trading service and risk checks.

### PaperTradingService
- Execution: market-style simulated fills use the latest loaded quote; if a valid stock code is missing, the original command fetches that quote on demand and continues automatically without a second command.
- A-share rules: buy and sell quantities use 100-share lots; shares bought today become sellable on a later Shanghai calendar date as a session-level T+1 approximation; insufficient cash or sellable shares reject the order.
- Costs: both sides charge 0.03% commission with a ¥5 minimum and 0.001% transfer fee; sells additionally charge 0.05% stamp duty.
- Accounting: buy fees enter average cost, sells record realized profit, quote refreshes mark positions to market, and every fill has an immutable `SIM-NNNN` record.
- Lifecycle: the default account starts with ¥100,000 and persists cash, positions, T+1 lots, mark prices, sequence, and trade records after every successful mutation; reset requires `/account reset confirm` and persists immediately.
- Storage: versioned JSON is atomically replaced at `%LOCALAPPDATA%\\AStockTUI\\paper-account.json` on Windows, `$XDG_DATA_HOME/astocktui/paper-account.json` when configured, or `~/.astocktui/paper-account.json` as fallback. Invalid state aborts loading instead of silently resetting assets.

### TradeHistoryWorkspace
- Structure: a read-only Agent sidecar showing persisted fills newest-first, with order ID, side, code, quantity, execution price, date, fees, and realized profit on sells.
- States: empty, buy, profitable sell, losing sell; profit uses A-share red and loss uses green while signed values remain visible without color.
- Responsive behavior: the sidecar appears to the right of Agent at `>= 160` columns; narrower terminals keep the focused workspace full-width and retain `/trades` for record lookup.

### NewsWorkspace
- Structure: scrolling timestamped headlines with source labels and optional source URLs.
- Coverage: up to 40 deduplicated items from MKTNews, WallstreetCN quick/news, CLS telegraph/depth, Xueqiu hot stocks, Gelonghui, FastBull, and Jin10; unavailable sources degrade independently.
- Agent access: `get_financial_news` returns all loaded items or filters them by keyword, source, and limit while reporting available sources and match count.
- States: populated, empty, selected, stale.
- Keyboard: Up, Down, PageUp, PageDown.

### AgentWorkspace
- Structure: bordered primary panel backed by `@oh-my-pi/pi-agent-core`, with streamed Markdown answers, live tool lifecycle rows, provider/model identity, bottom-anchored command suggestions, and a bottom-pinned prompt input. The subtitle line also shows the long-term memory entry count.
- Markdown: Pi TUI parses headings, emphasis, inline/code blocks, links, quotes, rules, and ordered/unordered lists into ANSI terminal styles. Raw markers are removed, deep headings are flattened for compact panels, unordered bullets use `•`, and CJK-aware wrapping keeps every rendered line within the supplied width.
- Configuration: `ASTOCK_AGENT_PROVIDER` and `ASTOCK_AGENT_MODEL` select any bundled Pi model; the default is `openai/gpt-4o-mini`. `ASTOCK_AGENT_BASE_URL` overrides the selected model endpoint, while OpenAI also accepts `OPENAI_BASE_URL`; only HTTP(S) endpoints are accepted. Provider credentials use Pi's standard environment variables such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GEMINI_API_KEY`. Missing credentials produce an explicit unconfigured state without issuing a request.
- Tools: status, watchlist quotes, full-market overview, filtered multi-source financial news, portfolio, trade history, refresh, watchlist management, trade preview, simulated trade execution, simulated account reset, long-term memory, and workspace focus all use the same application services as keyboard commands.
- Trading safety: Agent orders only affect the persisted local paper account and retain lot, cash, fee, and T+1 checks. `execute_trade` is blocked unless the current user request explicitly authorizes trading or autonomous simulated operation; negative instructions win. Account reset additionally requires explicit reset wording and the tool's `RESET` confirmation.
- States: unconfigured, waiting, streaming, tool-running, tool-complete, completed, error, command-running, and input-focus; provider and asynchronous command results replace pending states when complete.
- Keyboard: Enter submits plain text to Pi Agent; `/` from any workspace focuses Agent and starts a fresh application command; Tab, Shift+Tab, Left, and Right move focus while the palette is closed; Ctrl+C exits.

### CommandPalette
- Scope: application-local commands only; it never executes shell commands.
- Registry: command metadata is the single source for parsing, filtering, completion, `/help`, and visible descriptions.
- Commands: `/help`, `/status`, `/focus`, `/refresh`, `/watch`, `/portfolio`, `/preview`, `/buy`, `/sell`, `/trades`, `/account reset confirm`, `/clear`, `/memory`, `/quit`, and `/exit`.
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
