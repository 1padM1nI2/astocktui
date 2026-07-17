import { describe, expect, test } from "bun:test"
import { WatchlistService } from "../src/watchlist"

describe("行情自选股服务", () => {
  test("默认列表支持代码规范化、添加、去重和删除", () => {
    const service = new WatchlistService()

    expect(service.codes).toEqual(["SH600519", "SZ000858", "SH601318", "SZ000001"])
    expect(service.add("000938")).toMatchObject({ ok: true, code: "SZ000938" })
    expect(service.add("SZ000938")).toMatchObject({ ok: false, code: "SZ000938" })
    expect(service.codes.at(-1)).toBe("SZ000938")
    expect(service.remove("000938")).toMatchObject({ ok: true, code: "SZ000938" })
    expect(service.codes).not.toContain("SZ000938")
  })

  test("拒绝无效代码、缺失股票和删除最后一只股票", () => {
    const service = new WatchlistService({ codes: ["SH600519"] })

    expect(service.add("abc").message).toContain("股票代码格式无效")
    expect(service.remove("000001").message).toContain("不在自选股中")
    expect(service.remove("600519").message).toContain("至少保留一只")
    expect(service.codes).toEqual(["SH600519"])
  })

  test("本地保存失败时回滚自选股修改", () => {
    const service = new WatchlistService({
      codes: ["SH600519"],
      onStateChange: () => {
        throw new Error("磁盘已满")
      },
    })

    expect(() => service.add("000938")).toThrow("磁盘已满")
    expect(service.codes).toEqual(["SH600519"])
  })
})

test("美日和韩国股票以规范市场前缀加入并可移除", () => {
  const service = new WatchlistService({ codes: ["SH600519"] })

  expect(service.add("us:aapl")).toMatchObject({ ok: true, code: "US:AAPL" })
  expect(service.add("JP:7203")).toMatchObject({ ok: true, code: "JP:7203" })
  expect(service.add("kr:005930")).toMatchObject({ ok: true, code: "KR:005930" })
  expect(service.remove("US:AAPL")).toMatchObject({ ok: true, code: "US:AAPL" })
  expect(service.add("HK:0700").message).toContain("US:AAPL")
})
