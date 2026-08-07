import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readCache, writeCache } from "../../src/infra/disk-cache"

function tempPath(name = "cache.json"): string {
  return join(mkdtempSync(join(tmpdir(), "astocktui-disk-cache-")), name)
}

describe("磁盘缓存", () => {
  test("写入后可读回值和缓存时间", () => {
    const path = tempPath()
    writeCache(path, { quotes: [1, 2] }, () => 1_700_000_000_000)

    expect(readCache(path)).toEqual({ cachedAt: 1_700_000_000_000, value: { quotes: [1, 2] } })
  })

  test("文件不存在时返回 null", () => {
    expect(readCache(tempPath())).toBeNull()
  })

  test("JSON 损坏时返回 null", () => {
    const path = tempPath()
    writeFileSync(path, "{not json", "utf8")

    expect(readCache(path)).toBeNull()
  })

  test("形状不符时返回 null", () => {
    const missingEnvelope = tempPath()
    writeFileSync(missingEnvelope, JSON.stringify({ quotes: [] }), "utf8")
    const badCachedAt = tempPath()
    writeFileSync(badCachedAt, JSON.stringify({ cachedAt: "昨天", value: {} }), "utf8")

    expect(readCache(missingEnvelope)).toBeNull()
    expect(readCache(badCachedAt)).toBeNull()
  })
})
