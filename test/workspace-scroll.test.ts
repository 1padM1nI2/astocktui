import { describe, expect, test } from "bun:test"
import { ListScrollState } from "../src/app/workspace-scroll"

describe("工作区列表滚动", () => {
  test("上下键移动偏移并在边界夹紧", () => {
    const scroll = new ListScrollState()
    scroll.recordRender(20, 6)

    expect(scroll.handleInput("\x1b[B")).toBe(true)
    expect(scroll.offset).toBe(1)
    expect(scroll.handleInput("\x1b[A")).toBe(true)
    expect(scroll.offset).toBe(0)
    scroll.handleInput("\x1b[A")
    expect(scroll.offset).toBe(0)
  })

  test("PageDown 与 PageUp 按可视行数翻页且不越过末尾", () => {
    const scroll = new ListScrollState()
    scroll.recordRender(20, 6)

    scroll.handleInput("\x1b[6~")
    expect(scroll.offset).toBe(6)
    scroll.handleInput("\x1b[6~")
    expect(scroll.offset).toBe(12)
    scroll.handleInput("\x1b[6~")
    expect(scroll.offset).toBe(14)
    scroll.handleInput("\x1b[5~")
    expect(scroll.offset).toBe(8)
  })

  test("Home 与 End 跳到首尾", () => {
    const scroll = new ListScrollState()
    scroll.recordRender(20, 6)

    scroll.handleInput("\x1b[F")
    expect(scroll.offset).toBe(14)
    scroll.handleInput("\x1b[H")
    expect(scroll.offset).toBe(0)
  })

  test("内容收缩时渲染记录会夹紧偏移", () => {
    const scroll = new ListScrollState()
    scroll.recordRender(20, 6)
    scroll.handleInput("\x1b[F")

    scroll.recordRender(8, 6)
    expect(scroll.offset).toBe(2)
  })

  test("非滚动按键不消费输入", () => {
    const scroll = new ListScrollState()
    scroll.recordRender(20, 6)

    expect(scroll.handleInput("x")).toBe(false)
    expect(scroll.offset).toBe(0)
  })

  test("ensureVisible 滚动到目标行使其保持可见", () => {
    const scroll = new ListScrollState()
    scroll.recordRender(20, 6)

    scroll.ensureVisible(10)
    expect(scroll.offset).toBe(5)
    scroll.ensureVisible(2)
    expect(scroll.offset).toBe(2)
    scroll.ensureVisible(3)
    expect(scroll.offset).toBe(2)
    scroll.ensureVisible(-1)
    expect(scroll.offset).toBe(2)
  })
})
