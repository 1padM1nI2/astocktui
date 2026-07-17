# Tasks Document

- [x] 1. Add market-aware code parsing and canonical market models
  - Files: `src/market-code.ts`, `src/market-data.ts`, `test/market-code.test.ts`
  - Add `CN`/`US`/`JP`/`KR` parsing, strict canonicalization, provider-symbol mapping, A-share recognition, and additive market metadata/diagnostic types without breaking current A-share inputs.
  - _Leverage: `src/market-data.ts` `normalizeAshareCode`, existing market-data fixtures_
  - _Requirements: 1.1-1.3, 2.4, 4.2_
  - _Prompt: Implement the task for spec global-market-data, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TypeScript market-domain engineer | Task: Add canonical A-share, US, Japan and Korea code parsing plus additive market quote/snapshot models | Restrictions: Preserve existing SH/SZ and bare six-digit behavior; reject ambiguous or malformed global codes; keep every source file below 250 non-blank lines | _Leverage: src/market-data.ts | _Requirements: 1.1-1.3, 2.4, 4.2 | Success: Tests prove code normalization, Yahoo suffix mapping, malformed input rejection and A-share-only guard behavior | Before starting mark this task [-] in tasks.md; after implementation log artifacts with spec-workflow log-implementation; then mark this task [x] in tasks.md._

- [x] 2. Persist and manage global watchlist symbols
  - Files: `src/watchlist.ts`, `src/watchlist-store.ts`, `test/watchlist.test.ts`, `test/watchlist-store.test.ts`
  - Replace A-share-only watchlist validation with canonical market-code validation; retain version-1 state compatibility and ensure duplicate, rollback and last-entry protections work across markets.
  - _Leverage: `src/market-code.ts`, `src/watchlist.ts`, atomic JSON store_
  - _Requirements: 1.1-1.4, 3.4_
  - _Prompt: Implement the task for spec global-market-data, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TypeScript persistence engineer | Task: Extend the existing watchlist service and store to save US:/JP:/KR: symbols alongside A-share codes | Restrictions: Do not migrate or invalidate existing SH/SZ persisted states; use the one canonical parser; preserve atomic rollback and no duplicate codes | _Leverage: src/watchlist.ts, src/watchlist-store.ts, src/market-code.ts | _Requirements: 1.1-1.4, 3.4 | Success: Tests cover global add/remove/persistence, existing A-share state loading, invalid prefix rejection and persistence rollback | Before starting mark this task [-] in tasks.md; after implementation log artifacts with spec-workflow log-implementation; then mark this task [x] in tasks.md._

- [x] 3. Fetch and merge global market quotes without blocking A shares
  - Files: `src/global-market-data.ts`, `src/market-data.ts`, `test/global-market-data.test.ts`, `test/market-data.test.ts`
  - Implement injected HTTPS Yahoo Chart requests for US/JP/KR ticker mapping and a composite source that partitions requests, settles them independently, validates responses, merges diagnostics, and preserves focused-symbol trends.
  - _Leverage: `MarketDataSource`, `StockApiMarketDataSource`, Bun fetch, existing market-data test conventions_
  - _Requirements: 2.1-2.5, 3.4, 4.3_
  - _Prompt: Implement the task for spec global-market-data, first run spec-workflow-guide to get the workflow guide then implement the task: Role: market-data integration engineer | Task: Build Yahoo Chart global market adapter and composite market source for US, Japan and Korea alongside existing A-share data | Restrictions: Use only HTTPS and injected fetch fixtures; never call a real service in tests; isolate per-symbol/market errors; no secrets in diagnostics; do not request Yahoo with no global codes | _Leverage: src/market-data.ts, Bun fetch | _Requirements: 2.1-2.5, 3.4, 4.3 | Success: Tests prove US/JP/KR mapping, response validation, partial failures, all-failure diagnostics, merge order and no-global compatibility | Before starting mark this task [-] in tasks.md; after implementation log artifacts with spec-workflow log-implementation; then mark this task [x] in tasks.md._

- [x] 4. Render cross-market metadata within terminal width limits
  - Files: `src/components/market.ts`, `test/market.test.ts`, `test/command-window.test.ts`
  - Adapt market table layout to present market/currency/status at usable widths, preserve red-up/green-down convention, and degrade safely to a compact representation on narrow terminals.
  - _Leverage: `fitLine`, `alignCell`, `visibleWidth`, existing market workspace rendering_
  - _Requirements: 3.1-3.2, 3.4_
  - _Prompt: Implement the task for spec global-market-data, first run spec-workflow-guide to get the workflow guide then implement the task: Role: terminal UI engineer | Task: Render global market identity, currency and trading state in MarketWorkspace with a compact narrow-width path | Restrictions: Every visible line must fit the supplied width; preserve A-share red-up/green-down colors and current A-share rows; no network I/O in components | _Leverage: src/components/market.ts, src/width.ts | _Requirements: 3.1-3.2, 3.4 | Success: Tests verify US/JP/KR rows, complete and compact layouts, color convention and  narrow terminal fit | Before starting mark this task [-] in tasks.md; after implementation log artifacts with spec-workflow log-implementation; then mark this task [x] in tasks.md._

- [x] 5. Keep global quotes analysis-only across Agent and trading paths
  - Files: `src/trading.ts`, `src/agent-tools.ts`, `test/trading.test.ts`, `test/agent-tools.test.ts`
  - Reject global symbols at the PaperTradingService source of truth, expose market metadata to the existing Agent snapshot tools, and preserve all current local-account authorization and risk behavior.
  - _Leverage: `isAshareCode`, `PaperTradingService.preview`, `createAStockAgentTools`
  - _Requirements: 3.3, 4.1-4.3_
  - _Prompt: Implement the task for spec global-market-data, first run spec-workflow-guide to get the workflow guide then implement the task: Role: trading safety engineer | Task: Enforce analysis-only global market quotes at the PaperTradingService boundary and ensure Agent market tools report global provenance/state | Restrictions: Do not weaken explicit authorization, lot-size, funds, fee or T+1 checks; rejection must create no positions or trades; do not invent real-time claims | _Leverage: src/trading.ts, src/agent-tools.ts, src/market-code.ts | _Requirements: 3.3, 4.1-4.3 | Success: Tests prove global buy/sell preview and execution fail without mutating accounts, while Agent snapshot output preserves market metadata | Before starting mark this task [-] in tasks.md; after implementation log artifacts with spec-workflow log-implementation; then mark this task [x] in tasks.md._

- [x] 6. Wire global defaults and validate end-to-end workflows
  - Files: `src/app.ts`, `src/main.ts`, `test/command-window.test.ts`, `test/main.test.ts`
  - Make the default application data source composite, cover `/watch add` commands, refresh behavior, Agent analysis visibility, no-global compatibility and disposal using deterministic fixtures.
  - _Leverage: `MarketIntelligenceApp`, `createDemo`, `WatchlistCoordinator`, existing fake Agent drivers_
  - _Requirements: All_
  - _Prompt: Implement the task for spec global-market-data, first run spec-workflow-guide to get the workflow guide then implement the task: Role: TUI integration QA engineer | Task: Wire global market data into the default application path and add behavior-level end-to-end coverage | Restrictions: Never call real network services in tests; retain current A-share defaults and startup behavior when no global symbols are configured; verify all terminal lines fit | _Leverage: src/app.ts, src/main.ts, test/command-window.test.ts | _Requirements: All | Success: Tests prove watch commands, partial cross-market refresh, Agent-visible analysis data, A-share-only compatibility, non-trading global safety, width invariants and clean application disposal | Before starting mark this task [-] in tasks.md; after implementation log artifacts with spec-workflow log-implementation; then mark this task [x] in tasks.md._
