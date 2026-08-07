import { describe, expect, test } from "bun:test"
import { CompositeNewsDataSource } from "../../src/news/composite-news"
import type { FinancialNewsItem, FinancialNewsSnapshot, NewsDataSource } from "../../src/news/data"

function item(id: string, title: string, publishedAt: number): FinancialNewsItem {
  return { id, title, publishedAt, source: "测试" }
}

function innerSource(snapshot: FinancialNewsSnapshot | Error): NewsDataSource {
  return {
    async loadNews(): Promise<FinancialNewsSnapshot> {
      if (snapshot instanceof Error) throw snapshot
      return snapshot
    },
  }
}

const INNER: FinancialNewsSnapshot = {
  items: [item("a:1", "快讯一", 200), item("a:2", "快讯二", 100)],
  source: "NewsNow 2源",
}

describe("复合新闻源", () => {
  test("合并公告后按时间降序、按标题去重", async () => {
    const source = new CompositeNewsDataSource(innerSource(INNER), async () => [
      { id: "eastmoney-ann:1", title: "公告一", publishedAt: 300, source: "东财公告" },
      { id: "eastmoney-ann:2", title: "快讯一", publishedAt: 400, source: "东财公告" },
      { id: "eastmoney-ann:3", title: "公告三", publishedAt: 150, source: "东财公告" },
    ])

    const snapshot = await source.loadNews()

    expect(snapshot.items.map((entry) => entry.title)).toEqual([
      "快讯一",
      "公告一",
      "公告三",
      "快讯二",
    ])
    expect(snapshot.source).toBe("NewsNow 2源+东财公告")
  })

  test("合并后截断到 40 条", async () => {
    const many: FinancialNewsSnapshot = {
      items: Array.from({ length: 40 }, (_, index) => item(`a:${index}`, `快讯${index}`, index)),
      source: "NewsNow 1源",
    }
    const source = new CompositeNewsDataSource(innerSource(many), async () => [
      { id: "eastmoney-ann:top", title: "最新公告", publishedAt: 1_000, source: "东财公告" },
    ])

    const snapshot = await source.loadNews()

    expect(snapshot.items).toHaveLength(40)
    expect(snapshot.items[0]?.title).toBe("最新公告")
  })

  test("公告抓取失败时静默降级为仅快讯", async () => {
    const source = new CompositeNewsDataSource(innerSource(INNER), async () => {
      throw new Error("公告接口不可用")
    })

    await expect(source.loadNews()).resolves.toEqual(INNER)
  })

  test("内层失败时整体抛错，保持现有语义", async () => {
    const source = new CompositeNewsDataSource(
      innerSource(new Error("没有可用财经新闻")),
      async () => [
        { id: "eastmoney-ann:1", title: "公告一", publishedAt: 300, source: "东财公告" },
      ],
    )

    await expect(source.loadNews()).rejects.toThrow("没有可用财经新闻")
  })
})
