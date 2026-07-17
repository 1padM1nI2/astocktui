import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createPersistentWatchlistService, WatchlistStore } from "../src/watchlist-store"

function temporaryWatchlistPath(): { readonly directory: string; readonly path: string } {
  const directory = mkdtempSync(join(tmpdir(), "astocktui-watchlist-"))
  return { directory, path: join(directory, "watchlist.json") }
}

describe("自选股持久化", () => {
  test("添加和删除后重启恢复自选股及顺序", () => {
    const temporary = temporaryWatchlistPath()
    try {
      const first = createPersistentWatchlistService({ path: temporary.path })
      first.add("000938")
      first.remove("000858")

      const second = createPersistentWatchlistService({ path: temporary.path })
      expect(second.codes).toEqual(["SH600519", "SH601318", "SZ000001", "SZ000938"])
      expect(JSON.parse(readFileSync(temporary.path, "utf8")).version).toBe(1)
    } finally {
      rmSync(temporary.directory, { recursive: true, force: true })
    }
  })

  test("损坏的自选股文件明确报错而不是回退默认列表", () => {
    const temporary = temporaryWatchlistPath()
    try {
      writeFileSync(temporary.path, '{"version":1,"codes":[]}', "utf8")
      expect(() => new WatchlistStore(temporary.path).load()).toThrow("自选股文件损坏")
    } finally {
      rmSync(temporary.directory, { recursive: true, force: true })
    }
  })
})

test("持久化存储保留全球股票的市场前缀", () => {
  const temporary = temporaryWatchlistPath()
  try {
    const first = createPersistentWatchlistService({ path: temporary.path, codes: ["US:AAPL"] })
    first.add("JP:7203")
    first.add("KR:005930")

    const restored = createPersistentWatchlistService({ path: temporary.path })
    expect(restored.codes).toEqual(["US:AAPL", "JP:7203", "KR:005930"])
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true })
  }
})
