# AStockTUI

- Use Bun for every command: `bun run test`, `bun run typecheck`, and `bun run lint`.
- Every visible TUI line must fit its supplied `width`; use the helpers in `src/width.ts`.
- A-share convention is fixed: red means up and green means down.
- Add behavior with a failing test before implementation.
- Keep components focused; no source file exceeds 250 non-blank lines.
