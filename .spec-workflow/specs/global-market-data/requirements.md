# Requirements Document

## Introduction

为 AStockTUI 增加全球股票行情能力，优先覆盖美国、日本、韩国市场。用户可将海外股票加入自选或由 Agent 查询，用最新价格、涨跌幅、币种、交易所状态与短期走势，结合现有 A 股行情判断跨市场风险偏好、产业链联动和持仓风险。

## Alignment with Product Vision

AStockTUI 是键盘优先的市场智能终端。美、日、韩市场覆盖使 A 股分析不再只依赖本地行情：美股反映全球风险偏好与 ADR/科技链定价，日本与韩国反映半导体、汽车、消费电子等亚洲产业链先行信号。数据仅增强分析，不改变模拟交易边界。

## Requirements

### Requirement 1：全球股票代码与自选管理

**User Story:** 作为投资者，我希望能用统一、明确的代码格式添加美日和韩国股票，以便在同一工作台追踪跨市场标的。

#### Acceptance Criteria

1. WHEN 用户通过自选命令或 Agent 提供美国、日本、韩国股票代码 THEN 系统 SHALL 分别接受 `US:<symbol>`、`JP:<numeric-code>` 与 `KR:<numeric-code>` 规范格式，并拒绝市场前缀、代码长度或字符不合法的输入。
2. WHEN 展示或持久化海外自选股 THEN 系统 SHALL 保留市场前缀，不得与现有 `SH`/`SZ` A 股代码混淆。
3. WHEN 用户输入未带市场前缀但与既有 A 股六位代码规则匹配 THEN 系统 SHALL 保持现有 A 股归一化行为，不得猜测为日股或韩股。
4. WHEN 用户请求海外代码帮助或添加失败 THEN 系统 SHALL 显示可复制的市场前缀与代码格式示例。

### Requirement 2：美日韩实时行情与走势

**User Story:** 作为投资者，我希望能获取美日和韩国股票的价格、涨跌与近期走势，以便比较跨市场表现。

#### Acceptance Criteria

1. WHEN 刷新包含 `US:`、`JP:` 或 `KR:` 自选股的行情 THEN 系统 SHALL 并行请求适配该市场的数据源，并返回代码、名称、交易所、币种、最新价、涨跌幅、行情时间和至少一个可用的短期收盘走势序列。
2. WHEN 数据源要求配置凭据 THEN 系统 SHALL 从显式环境变量读取凭据；未配置时 SHALL 显示可操作诊断且不得在 TUI、日志或 Agent 上下文中回显凭据。
3. WHEN 一个海外市场或代码请求失败 THEN 系统 SHALL 将错误局限于该市场或代码；其他海外市场及现有 A 股行情 SHALL 继续刷新并显示。
4. WHEN 上游返回空值、非有限价格、控制字符、错误市场或错误币种数据 THEN 系统 SHALL 丢弃该条记录并不得将其作为有效行情或模拟交易报价。
5. WHEN 上游报价已收盘、延迟或不可交易 THEN 系统 SHALL 在可用时保留并展示该状态；不得将其标记为实时可交易。

### Requirement 3：统一 TUI 展示与跨市场判断

**User Story:** 作为投资者，我希望在终端内快速区分国内外市场及其货币和交易状态，以便做出可靠判断。

#### Acceptance Criteria

1. WHEN 自选中同时包含 A 股与海外股票 THEN 行情面板 SHALL 为每个条目标示市场和币种，并保持现有 A 股“红涨绿跌”颜色约定。
2. WHEN 终端宽度不足以显示全部元数据 THEN 每一可见 TUI 行 SHALL 使用现有宽度辅助函数收口，不得溢出；核心代码、价格和涨跌幅 SHALL 优先保留。
3. WHEN Agent 查询市场快照、单只报价或用户明确要求跨市场分析 THEN 系统 SHALL 提供美日韩行情及数据来源、市场状态和时间；Agent SHALL 将缺失或延迟数据表述为限制，不得虚构实时结论。
4. WHEN 用户未配置任何海外股票 THEN 系统 SHALL 保持现有 A 股面板、命令、刷新速度和模拟账户行为不变。

### Requirement 4：分析与模拟交易安全边界

**User Story:** 作为模拟交易用户，我希望海外数据能辅助判断而不会绕过当前账户风控或误触发交易。

#### Acceptance Criteria

1. WHEN Agent 使用海外行情进行分析 THEN 系统 SHALL 保持现有本地模拟账户的明确授权、整手、资金、费用和 T+1 校验。
2. WHEN 海外报价被读取 THEN 系统 SHALL 将其作为分析数据；除非未来明确实现对应市场的模拟交易规则，否则 SHALL 不将其传入现有 A 股 `PaperTradingService` 下单流程。
3. WHEN Agent、命令或数据源出现错误 THEN 系统 SHALL 返回来源明确、无敏感配置值的诊断，并保持本地行情、新闻与账户工具可用。

## Non-Functional Requirements

### Code Architecture and Modularity
- 全球代码解析、外部数据适配、统一快照合并、TUI 渲染和 Agent 工具必须处于独立聚焦模块；单个源文件不得超过 250 个非空行。
- 复用 `MarketDataSource`、`MarketQuote`、自选持久化、Agent 工具和 `fitLine`；不得另建与现有行情刷新并行的状态系统。
- 数据提供商必须经显式接口注入，以便以离线 fixture 测试美、日、韩市场及失败场景。

### Performance
- 各市场请求 SHALL 并行；单个慢市场不得阻塞 A 股或其他海外市场结果。
- 刷新期间 SHALL 合并同一市场的重复请求，避免重复网络调用。
- 不得在未配置海外自选股时启动海外网络请求。

### Security
- 不得在源码、持久化文件、TUI、Agent 提示词、错误或测试快照中暴露已解析的 API 密钥。
- 仅允许 HTTPS 海外数据端点，并校验响应的市场代码、币种和数值。
- 海外行情不得绕过或替换现有模拟交易服务。

### Reliability
- 测试 SHALL 覆盖美国、日本、韩国代码解析、有效报价映射、并行部分失败、空/恶意数据拒绝、无海外配置兼容性、Agent 可见性和退出清理。
- 数据源失败 SHALL 产生可见诊断而非未处理异常；成功市场数据仍需可用。

### Usability
- 支持 `/watch add US:AAPL`、`/watch add JP:7203`、`/watch add KR:005930` 等清晰输入。
- 所有可见文本须为简体中文，并保持固定宽度终端的行宽约束。
