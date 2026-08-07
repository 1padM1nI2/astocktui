import { expect, test } from "bun:test"
import { type ArticleFetcher, htmlToParagraphs, loadArticleText } from "../src/news/news-article"
import type { FinancialNewsItem } from "../src/news/news-data"

function itemWith(url: string | undefined): FinancialNewsItem {
  return {
    id: "test:1",
    title: "新闻标题",
    publishedAt: 1_787_000_000_000,
    source: "测试源",
    ...(url === undefined ? {} : { url }),
  }
}

function fetcherReturning(body: string): ArticleFetcher {
  return async () => ({
    ok: true,
    status: 200,
    async json() {
      return {}
    },
    async text() {
      return body
    },
  })
}

test("htmlToParagraphs 去除标签、脚本、终端控制序列并解码实体", () => {
  const html = [
    "<div><style>.a{color:red}</style>",
    "<p>第一段&nbsp;正文&amp;标点</p>",
    '<script>alert("\x1b[31m")</script>',
    "<p>第二段<b>加粗</b>文字</p>",
    "<p>\x1b[2J\x1b[31m第三段</p>",
    "</div>",
  ].join("")

  const paragraphs = htmlToParagraphs(html)

  expect(paragraphs).toContain("第一段 正文&标点")
  expect(paragraphs).toContain("第二段加粗文字")
  expect(paragraphs).toContain("第三段")
  expect(paragraphs.some((p) => p.includes("\x1b") || p.includes("[2J"))).toBe(false)
})

test("华尔街见闻文章通过 api-one 接口获取正文段落", async () => {
  let requestedUrl = ""
  const fetcher: ArticleFetcher = async (url) => {
    requestedUrl = url
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          data: {
            content: [
              "<p>新闻标题。</p>",
              "<p>正文第一段</p><p>正文第二段</p>",
              "<p>风险提示及免责条款</p>",
              "<p>市场有风险，投资需谨慎。本文不构成个人投资建议。</p>",
            ].join(""),
          },
        }
      },
      async text() {
        return ""
      },
    }
  }

  const paragraphs = await loadArticleText(
    itemWith("https://wallstreetcn.com/articles/3777899"),
    fetcher,
  )

  expect(requestedUrl).toContain("api-one.wallstcn.com/apiv1/content/articles/3777899")
  // 与标题重复的首段和文末免责模板被剔除
  expect(paragraphs).toEqual(["正文第一段", "正文第二段"])
})

test("财联社文章从页面 __NEXT_DATA__ 提取正文", async () => {
  const page = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { articleDetail: { content: "<p>财联社正文一</p><p>财联社正文二</p>" } } },
  })}</script></body></html>`

  const paragraphs = await loadArticleText(
    itemWith("https://www.cls.cn/detail/2436805"),
    fetcherReturning(page),
  )

  expect(paragraphs).toEqual(["财联社正文一", "财联社正文二"])
})

test("其他网页退化为中文段落启发式提取", async () => {
  const page = [
    "<html><body><nav>首页 登录 注册</nav>",
    "<article><p>这是一段包含有效信息的中文正文内容，字数足够多。</p><p>短</p></article>",
    "<footer>免责声明与备案信息</footer></body></html>",
  ].join("")

  const paragraphs = await loadArticleText(
    itemWith("https://example.com/news/1"),
    fetcherReturning(page),
  )

  expect(paragraphs).toEqual(["这是一段包含有效信息的中文正文内容，字数足够多。"])
})

test("无链接、上游失败或提取为空时返回 null", async () => {
  expect(await loadArticleText(itemWith(undefined), fetcherReturning(""))).toBeNull()

  const failing: ArticleFetcher = async () => {
    throw new Error("网络错误")
  }
  expect(await loadArticleText(itemWith("https://example.com/news/1"), failing)).toBeNull()

  const notFound: ArticleFetcher = async () => ({
    ok: false,
    status: 404,
    async json() {
      return {}
    },
    async text() {
      return ""
    },
  })
  expect(await loadArticleText(itemWith("https://example.com/news/1"), notFound)).toBeNull()

  expect(
    await loadArticleText(
      itemWith("https://example.com/news/1"),
      fetcherReturning("<html><body>404</body></html>"),
    ),
  ).toBeNull()
})
