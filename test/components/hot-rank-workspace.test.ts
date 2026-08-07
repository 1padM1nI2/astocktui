import { describe, expect, test } from "bun:test"
import { visibleWidth } from "@oh-my-pi/pi-tui"
import { ANSI } from "../../src/app/colors"
import { ListScrollState } from "../../src/app/workspace-scroll"
import { HotRankWorkspace } from "../../src/components/hot-rank"
import type { HotRankSnapshot } from "../../src/market/eastmoney-hot-rank"

const SNAPSHOT: HotRankSnapshot = {
  items: [
    {
      code: "SH603986",
      rank: 1,
      rankChange: 2,
      name: "兆易创新",
      price: 371.1,
      changePercent: 1.94,
    },
    {
      code: "SZ001309",
      rank: 2,
      rankChange: -1,
      name: "德明利",
      price: 390.04,
      changePercent: -5.5,
    },
    {
      code: "SZ300308",
      rank: 3,
      rankChange: 0,
      name: "中际旭创",
      price: null,
      changePercent: null,
    },
  ],
  source: "东财股吧人气",
  updatedAt: 1_753_900_000_000,
}

describe("股吧人气榜工作区", () => {
  test("未加载时渲染占位与状态行", () => {
    const frame = new HotRankWorkspace().render(60).join("\n")

    expect(frame).toContain("股吧人气榜")
    expect(frame).toContain("未加载 · R刷新")
    expect(frame).toContain("等待人气榜数据…")
  })

  test("加载后渲染排名、名称、报价与排名变动", () => {
    const workspace = new HotRankWorkspace()
    workspace.applySnapshot(SNAPSHOT)
    const frame = workspace.render(79).join("\n")

    expect(frame).toContain("东财股吧人气")
    expect(frame).toContain("H返回")
    expect(frame).toContain("兆易创新")
    expect(frame).toContain("603986")
    expect(frame).toContain("371.10")
    expect(frame).toContain("↑2")
    expect(frame).toContain("↓1")
    // 停牌或缺报价显示占位
    expect(frame).toContain("--")
  })

  test("涨跌幅遵循红涨绿跌", () => {
    const workspace = new HotRankWorkspace()
    workspace.applySnapshot(SNAPSHOT)
    const frame = workspace.render(60).join("\n")

    expect(frame).toContain(`${ANSI.red}+1.94%`)
    expect(frame).toContain(`${ANSI.green}-5.50%`)
  })

  test("更新中与失败状态可见", () => {
    const workspace = new HotRankWorkspace()
    workspace.beginRefresh()
    expect(workspace.render(60).join("\n")).toContain("更新中")
    expect(workspace.render(60).join("\n")).toContain("正在获取人气榜…")

    workspace.failRefresh()
    expect(workspace.render(60).join("\n")).toContain("获取失败 · R重试")
    expect(workspace.render(60).join("\n")).toContain("人气榜获取失败，按 R 重试")
    expect(workspace.status).toBe("error")
  })

  test("所有布局宽度下行不溢出", () => {
    const workspace = new HotRankWorkspace()
    workspace.applySnapshot(SNAPSHOT)

    for (const width of [20, 40, 79, 120]) {
      for (const line of workspace.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width)
      }
    }
  })

  test("滚动按键驱动列表滚动，其余按键不消费", () => {
    const workspace = new HotRankWorkspace()
    expect(workspace.scroll).toBeInstanceOf(ListScrollState)

    workspace.scroll.recordRender(30, 5)
    expect(workspace.handleInput("\x1b[B")).toBe(true)
    expect(workspace.scroll.offset).toBe(1)
    expect(workspace.handleInput("x")).toBe(false)
  })
})
