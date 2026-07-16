import { describe, expect, test } from "bun:test"
import {
  NEWSNOW_FINANCE_SOURCE_IDS,
  type NewsFetcher,
  type NewsHttpResponse,
  NewsNowDataSource,
  type NewsRequestOptions,
} from "../src/news-data"

function jsonResponse(body: unknown, status = 200): NewsHttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json(): Promise<unknown> {
      return body
    },
  }
}

describe("NewsNow 财经新闻适配", () => {
  test("覆盖快讯、深度、热点和市场情绪财经来源", () => {
    expect(NEWSNOW_FINANCE_SOURCE_IDS).toEqual([
      "mktnews-flash",
      "wallstreetcn-quick",
      "wallstreetcn-news",
      "cls-telegraph",
      "cls-depth",
      "xueqiu-hotstock",
      "gelonghui",
      "fastbull-express",
      "jin10",
    ])
  })

  test("合并财联社和华尔街见闻，按时间排序并按标题去重", async () => {
    const requests: string[] = []
    const options: NewsRequestOptions[] = []
    const fetcher: NewsFetcher = async (url, requestOptions) => {
      requests.push(url)
      options.push(requestOptions)
      if (url.includes("cls-telegraph")) {
        return jsonResponse({
          id: "cls-telegraph",
          items: [
            {
              id: 1,
              title: " A股\n开盘 ",
              pubDate: 1_783_991_800_000,
            },
            {
              id: 2,
              title: "央行开展逆回购操作",
              pubDate: 1_783_991_000_000,
            },
          ],
        })
      }
      return jsonResponse({
        id: "wallstreetcn-quick",
        items: [
          {
            id: 3,
            title: "央行开展逆回购操作",
            extra: { date: 1_783_992_000_000 },
          },
          {
            id: 4,
            title: "人民币中间价公布",
            extra: { date: 1_783_991_500_000 },
          },
        ],
      })
    }

    const snapshot = await new NewsNowDataSource(fetcher, "https://news.example/").loadNews()

    expect(requests).toEqual(
      NEWSNOW_FINANCE_SOURCE_IDS.map((sourceId) => `https://news.example/api/s?id=${sourceId}`),
    )
    expect(options.every((item) => item.headers.Accept === "application/json")).toBe(true)
    expect(options.every((item) => item.headers["User-Agent"]?.startsWith("Mozilla/5.0"))).toBe(
      true,
    )
    expect(options.every((item) => item.signal instanceof AbortSignal)).toBe(true)
    expect(snapshot).toEqual({
      source: "NewsNow 2源",
      items: [
        {
          id: "wallstreetcn-quick:3",
          title: "央行开展逆回购操作",
          publishedAt: 1_783_992_000_000,
          source: "华尔街见闻",
        },
        {
          id: "cls-telegraph:1",
          title: "A股 开盘",
          publishedAt: 1_783_991_800_000,
          source: "财联社",
        },
        {
          id: "wallstreetcn-quick:4",
          title: "人民币中间价公布",
          publishedAt: 1_783_991_500_000,
          source: "华尔街见闻",
        },
      ],
    })
  })

  test("单个来源失败时使用另一来源", async () => {
    const fetcher: NewsFetcher = async (url) => {
      if (url.includes("cls-telegraph")) throw new Error("财联社暂不可用")
      return jsonResponse({
        id: "wallstreetcn-quick",
        items: [
          {
            id: 9,
            title: "沪深两市开盘",
            extra: { date: 1_783_992_000_000 },
          },
        ],
      })
    }

    const snapshot = await new NewsNowDataSource(fetcher, "https://news.example").loadNews()

    expect(snapshot.source).toBe("NewsNow 1源")
    expect(snapshot.items).toHaveLength(1)
  })

  test("限制为最新四十条并拒绝全部来源失败或空结果", async () => {
    const items = Array.from({ length: 50 }, (_, index) => ({
      id: index,
      title: `财经快讯 ${index}`,
      pubDate: 1_783_992_000_000 - index * 1_000,
    }))
    const partial: NewsFetcher = async (url) =>
      url.includes("cls-telegraph")
        ? jsonResponse({ id: "cls-telegraph", items })
        : jsonResponse({}, 503)
    const failed: NewsFetcher = async () => jsonResponse({}, 503)
    const empty: NewsFetcher = async (url) =>
      jsonResponse({
        id: url.includes("cls-telegraph") ? "cls-telegraph" : "wallstreetcn-quick",
        items: [],
      })

    expect(
      (await new NewsNowDataSource(partial, "https://news.example").loadNews()).items,
    ).toHaveLength(40)
    expect(new NewsNowDataSource(failed, "https://news.example").loadNews()).rejects.toThrow(
      "没有可用财经新闻",
    )
    expect(new NewsNowDataSource(empty, "https://news.example").loadNews()).rejects.toThrow(
      "没有可用财经新闻",
    )
  })

  test("拒绝终端控制序列、非法时间和来源错配", async () => {
    const fetcher: NewsFetcher = async (url) =>
      jsonResponse({
        id: url.includes("cls-telegraph") ? "wrong-source" : "wallstreetcn-quick",
        items: [
          {
            id: 1,
            title: "恶意\x1b[2J标题",
            extra: { date: 1_783_992_000_000 },
          },
          {
            id: 2,
            title: "时间错误",
            extra: { date: 0 },
          },
        ],
      })

    expect(new NewsNowDataSource(fetcher, "https://news.example").loadNews()).rejects.toThrow(
      "没有可用财经新闻",
    )
  })
})
