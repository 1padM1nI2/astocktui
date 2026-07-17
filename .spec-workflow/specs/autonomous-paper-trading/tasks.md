# Tasks Document

- [x] 1. Remove per-request authorization from autonomous simulated trades
  - Files: `src/pi-agent.ts`, `test/pi-agent.test.ts`
  - Make `execute_trade` always pass the driver authorization boundary regardless of the user message, retain explicit reset intent matching, and update the system prompt to describe autonomous local simulation accurately.
  - _Leverage: `PiAgentDriver.beforeToolCall`, `authorizeAgentTool`, existing Pi Agent tests_
  - _Requirements: 1.1-1.4, 3.1-3.3, 4.1-4.3_
  - _Prompt: Implement the task for spec autonomous-paper-trading, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Pi Agent runtime engineer | Task: Remove natural-language authorization blocking for execute_trade while keeping reset_paper_account explicitly gated and make system prompt semantics match autonomous local simulation | Restrictions: Do not connect a real broker; do not weaken PaperTradingService validation; retain reset intent protection; source file must stay below 250 non-blank lines | _Leverage: src/pi-agent.ts, test/pi-agent.test.ts | _Requirements: 1.1-1.4, 3.1-3.3, 4.1-4.3 | Success: Tests prove buy/sell is allowed for neutral and “only analysis” prompts, reset remains blocked without explicit reset intent, and model endpoint configuration still works | Before starting mark this task [-] in tasks.md; after implementation log artifacts with spec-workflow log-implementation; then mark this task [x] in tasks.md._

- [x] 2. Declare autonomous simulation semantics on the trade tool
  - Files: `src/agent-tools.ts`, `test/agent-tools.test.ts`
  - Update the simulated execution tool contract so Agent planning receives clear autonomous-local-execution semantics while preserving exclusive concurrency, result rendering and all existing trading-service failures.
  - _Leverage: `createAStockAgentTools`, `PaperTradingService`, current tool tests_
  - _Requirements: 1.2-1.4, 2.1-2.4, 4.1-4.3_
  - _Prompt: Implement the task for spec autonomous-paper-trading, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Agent tool contract engineer | Task: Express autonomous local simulation in execute_trade metadata without adding interactive confirmations or bypassing the trading service | Restrictions: Keep exclusive concurrency and result JSON; do not alter reset tool approval; do not weaken funds, lot, fee, T+1 or global-market rejection behavior | _Leverage: src/agent-tools.ts, test/agent-tools.test.ts | _Requirements: 1.2-1.4, 2.1-2.4, 4.1-4.3 | Success: Tests prove tool executes existing simulated trades, retains account errors, and exposes accurate autonomous-local semantics | Before starting mark this task [-] in tasks.md; after implementation log artifacts with spec-workflow log-implementation; then mark this task [x] in tasks.md._

- [x] 3. Verify autonomous execution and reset/account invariants end to end
  - Files: `test/pi-agent.test.ts`, `test/agent-controller.test.ts`, `test/trading.test.ts`
  - Add behavioral coverage for ordinary analysis prompts leading to allowed simulated execution, reset denial, completed/error tool events, and unchanged account state after invalid trades.
  - _Leverage: scripted Agent drivers, `AgentController`, `PaperTradingService` fixtures_
  - _Requirements: All_
  - _Prompt: Implement the task for spec autonomous-paper-trading, first run spec-workflow-guide to get the workflow guide then implement the task: Role: simulation trading QA engineer | Task: Add deterministic behavior coverage proving no per-trade confirmation gate remains while account and reset invariants hold | Restrictions: Do not call AI providers or real network services; test observable tool and account transitions rather than source text; preserve existing deterministic clock fixtures | _Leverage: test/pi-agent.test.ts, test/agent-controller.test.ts, test/trading.test.ts | _Requirements: All | Success: Tests cover neutral/negative text authorization, reset gating, simulated result events and no mutation on rejected account operations | Before starting mark this task [-] in tasks.md; after implementation log artifacts with spec-workflow log-implementation; then mark this task [x] in tasks.md._
