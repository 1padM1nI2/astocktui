# Task statement
调研 GitHub 上可靠、活跃的开源 A 股数据获取项目，选择适合当前 Bun/TypeScript TUI 的方案并完成集成，提供完善的行为测试。

# Desired outcome
行情工作区从真实 A 股数据源异步获取自选股快照；网络、协议或数据异常时界面保持可用并明确展示状态；测试覆盖成功、失败、并发与宽度边界。

# Known facts/evidence
- 项目使用 Bun、TypeScript 和 `@oh-my-pi/pi-tui`。
- 当前 `src/components/market.ts` 内置静态 `WATCHLIST`。
- `Component.render()` 是同步接口，真实数据需要在组件外或组件状态内异步刷新后触发 TUI 重绘。
- A 股约定固定：上涨红色、下跌绿色。
- 所有可见行必须适配传入宽度。
- 项目要求先写失败测试，再实现。

# Constraints
- 所有命令通过 Bun 执行。
- 不引入需要用户密钥的默认数据链路。
- 不引入 Python 运行时或额外常驻服务，除非没有可行的 TypeScript/Bun 原生方案。
- 保持组件聚焦，源文件不超过 250 个非空行。
- 不使用静态假数据伪装为实时成功；故障必须显式呈现。

# Unknowns/open questions
- 候选 GitHub 项目的活跃度、许可证、数据源稳定性及 Bun 兼容性。
- 上游接口的限流、字段格式和失败语义。
- TUI 重绘回调在当前 pi-tui 版本中的标准用法。

# Likely codebase touchpoints
- `src/components/market.ts`
- `src/app.ts`
- `src/main.ts`
- `test/workspace.test.ts`
- 新的数据源模块及其聚焦测试
