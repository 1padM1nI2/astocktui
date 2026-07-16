# Task statement
调研 GitHub 上可靠、活跃、适合 Bun/TypeScript 的财经新闻项目，选择方案并接入 AStockTUI，提供完善测试。

# Desired outcome
实时新闻工作区在 TUI 启动后获取真实财经快讯，支持加载、成功、失败、刷新与滚动；网络故障时界面可用且不展示伪造新闻。

# Known facts/evidence
- 项目使用 Bun、TypeScript、`@oh-my-pi/pi-tui`。
- `src/components/news.ts` 当前内置 6 条静态新闻。
- 应用已存在可注入的异步行情数据源、启动刷新、并发合并和 `onUpdate` 重绘机制。
- 新闻页已有 Up/Down/PageUp/PageDown 选择逻辑。
- 所有可见行必须适配传入宽度，源文件不超过 250 个非空行。
- 行为必须先写失败测试。

# Constraints
- 默认链路不要求 API Key、Python 或常驻服务。
- 不把静态假新闻伪装成实时成功。
- 第三方标题是非可信输入，必须阻断 ANSI/终端控制序列。
- 网络失败保留最后一次成功结果，并提供明确重试入口。
- 低频工具不做后台高频轮询，避免触发第三方限流。

# Unknowns/open questions
- GitHub 候选项目的活跃度、许可证、数据格式与公开端点稳定性。
- 是否有直接 JSON API，避免为 RSS XML 增加重量依赖。
- 新闻时间字段、重要级别与来源的可用性。

# Likely codebase touchpoints
- `src/components/news.ts`
- `src/app.ts`
- `src/main.ts`
- 新闻数据边界模块
- 新闻数据、刷新与启动接线测试
