import { expect, test } from "bun:test"
import { stripVTControlCharacters } from "node:util"
import { visibleWidth } from "@oh-my-pi/pi-tui"
import { ANSI } from "../src/app/colors"
import { NewsWorkspace } from "../src/components/news"
import type { FinancialNewsItem, FinancialNewsSnapshot } from "../src/news/news-data"

const LONG_TITLE =
  "这是一条标题特别长的新闻用于验证详情视图能够把完整标题按宽度折行显示而不是被截断"

function makeSnapshot(): FinancialNewsSnapshot {
  const items: FinancialNewsItem[] = [
    {
      id: "n0",
      title: "短线快讯：市场午后拉升",
      publishedAt: Date.UTC(2026, 6, 25, 1, 30),
      source: "财联社",
      url: "https://www.cls.cn/detail/1",
    },
    {
      id: "n1",
      title: LONG_TITLE,
      publishedAt: Date.UTC(2026, 6, 25, 2, 40),
      source: "华尔街见闻",
      url: "https://wallstreetcn.com/articles/2",
    },
    {
      id: "n2",
      title: "第三条新闻",
      publishedAt: Date.UTC(2026, 6, 25, 3, 50),
      source: "金十数据",
    },
  ]
  return { source: "测试源", items }
}

function renderPlain(news: NewsWorkspace, width: number): string {
  return stripVTControlCharacters(news.render(width).join("\n"))
}

test("空格进入选中模式并高亮第一条新闻", () => {
  const news = new NewsWorkspace()
  news.applySnapshot(makeSnapshot())

  expect(news.render(50).join("\n")).not.toContain(ANSI.reverse)
  news.handleInput(" ")

  const frame = news.render(50)
  expect(frame.join("\n")).toContain(ANSI.reverse)
  expect(frame.find((line) => line.includes("短线快讯"))).toContain(ANSI.reverse)
})

test("选中行高亮覆盖分隔符之后的标题，不被行内 reset 截断", () => {
  const news = new NewsWorkspace()
  news.applySnapshot(makeSnapshot())
  news.handleInput(" ")

  const line = news.render(60).find((entry) => entry.includes("短线快讯")) ?? ""
  const titleIndex = line.indexOf("短线快讯")
  expect(titleIndex).toBeGreaterThan(-1)
  // 标题之前必须至少有两个 reverse：行首一个 + 分隔符 reset 后恢复的一个
  const beforeTitle = line.slice(0, titleIndex)
  expect(beforeTitle.split(ANSI.reverse).length - 1).toBeGreaterThanOrEqual(2)
})

test("选中模式下空格打开详情并显示完整标题、时间和链接", () => {
  const news = new NewsWorkspace()
  news.applySnapshot(makeSnapshot())
  news.handleInput(" ")
  news.handleInput("\x1b[B") // 选中第二条
  news.handleInput(" ") // 打开详情

  const raw = renderPlain(news, 40)
  // 长标题完整呈现（折行而非截断，拼接后不缺字）
  expect(raw).toContain("这是一条标题特别长的新闻")
  expect(raw.replace(/\s+/gu, "")).toContain("折行显示而不是被截断")
  // 完整日期时间（上海时区 10:40）
  expect(raw).toContain("华尔街见闻")
  expect(raw).toContain("2026-07-25 10:40")
  expect(raw).toContain("原文:")
  expect(renderPlain(news, 64)).toContain("https://wallstreetcn.com/articles/2")
  expect(raw).toContain("[Esc 返回]")
})

test("Esc 从详情逐级返回选中与滚动模式", () => {
  const news = new NewsWorkspace()
  news.applySnapshot(makeSnapshot())
  news.handleInput(" ")
  news.handleInput(" ") // 详情

  news.handleInput("\x1b")
  expect(news.render(50).join("\n")).toContain(ANSI.reverse) // 回到选中模式

  news.handleInput("\x1b")
  expect(news.render(50).join("\n")).not.toContain(ANSI.reverse) // 回到滚动模式
})

test("详情中方向键切换上一条/下一条新闻", () => {
  const news = new NewsWorkspace()
  news.applySnapshot(makeSnapshot())
  news.handleInput(" ")
  news.handleInput(" ") // 打开第一条详情
  expect(renderPlain(news, 50)).toContain("短线快讯")

  news.handleInput("\x1b[B")
  expect(renderPlain(news, 50)).toContain("标题特别长")

  news.handleInput("\x1b[B")
  news.handleInput("\x1b[B") // 夹紧在最后一条
  expect(renderPlain(news, 50)).toContain("第三条新闻")

  news.handleInput("\x1b[A")
  expect(renderPlain(news, 50)).toContain("标题特别长")
})

test("详情加载并展示正文，且同一条新闻只请求一次", async () => {
  const calls: string[] = []
  const news = new NewsWorkspace(async (item) => {
    calls.push(item.id)
    return ["第一段正文内容。", "第二段正文内容。"]
  })
  news.applySnapshot(makeSnapshot())
  news.handleInput(" ")
  news.handleInput(" ") // 打开详情（n0）

  await news.loadSelectedArticle()
  const raw = renderPlain(news, 40)
  expect(raw).toContain("第一段正文内容。")
  expect(raw).toContain("第二段正文内容。")

  await news.loadSelectedArticle()
  expect(calls).toEqual(["n0"])
})

test("正文不可用时显示提示并保留原文链接", async () => {
  const news = new NewsWorkspace(async () => null)
  news.applySnapshot(makeSnapshot())
  news.handleInput(" ")
  news.handleInput(" ") // n0 有链接

  await news.loadSelectedArticle()
  const raw = renderPlain(news, 50)
  expect(raw).toContain("暂无正文")
  expect(raw).toContain("https://www.cls.cn/detail/1")
})

test("详情视图在多种宽度下每行都不超宽", async () => {
  const news = new NewsWorkspace(async () => ["第一段正文内容。", "第二段正文内容。"])
  news.applySnapshot(makeSnapshot())
  news.handleInput(" ")
  news.handleInput("\x1b[B")
  news.handleInput(" ")
  await news.loadSelectedArticle()

  for (const width of [36, 56, 80]) {
    for (const line of news.render(width)) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(width)
    }
  }
})

test("详情内 PageDown 可以滚动长正文", async () => {
  const news = new NewsWorkspace(async () =>
    Array.from({ length: 30 }, (_, index) => `第${index + 1}段正文内容，长度足够占据多行显示。`),
  )
  news.applySnapshot(makeSnapshot())
  news.handleInput(" ")
  news.handleInput(" ")
  await news.loadSelectedArticle()

  news.scroll.recordRender(40, 10) // 模拟布局记录的可视行数
  expect(news.scroll.offset).toBe(0)
  news.handleInput("\x1b[6~")
  expect(news.scroll.offset).toBeGreaterThan(0)
})
