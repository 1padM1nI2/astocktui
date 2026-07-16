# 财经新闻集成规格

## 选择
集成 `ourongxing/newsnow` 的公开 JSON API，并支持通过 `ASTOCK_NEWSNOW_URL` 指向自托管实例。理由：TypeScript、MIT、约 20k stars、持续更新，内置财联社和华尔街见闻财经快讯源；API 自带 30 分钟缓存和最短 2 分钟的自适应抓取间隔，当前公开实例可直接返回 JSON。

未选择：
- `DIYgod/RSSHub`：社区更大、路线丰富，但默认输出 RSS/XML、AGPL，集成和自托管成本更高。
- `imsyy/DailyHotApi`：MIT、JSON API，但偏综合热榜，财经实时性和源覆盖弱于 NewsNow，公开示例端点本次无法连通。
- `akfamily/akshare`：财经数据覆盖广，但新闻接口要求 Python 运行时。

## 功能契约
- 默认并发读取 `cls-telegraph` 与 `wallstreetcn-quick`。
- 任一来源成功即可展示；两者都失败或无有效数据时刷新失败。
- 合并后按发布时间倒序、按规范化标题去重，最多展示 8 条。
- 标题中的换行规范化为空格；ANSI/C0/C1 控制字符直接拒绝。
- 新闻时间统一按 `Asia/Shanghai` 显示为 `HH:mm`。
- 初始状态、加载、成功、失败均明确可见；失败保留最后一次成功数据。
- 启动 TUI 时与行情并行加载；新闻页按 `r`/`R` 手动刷新；并发刷新合并。
- 保留 Up/Down/PageUp/PageDown 选择和跨 Tab 状态。
- 不后台轮询，尊重 NewsNow 缓存与上游限流策略。

## 测试契约
- API URL、请求头、双源字段映射、排序、去重、数量上限。
- 单源故障降级、双源失败、空/非法 payload。
- 多行标题规范化、终端控制序列拦截。
- 工作区初始/加载/成功/失败、旧数据保留、刷新合并、按键路由和宽度边界。
- TUI start 同时触发行情与新闻刷新。
