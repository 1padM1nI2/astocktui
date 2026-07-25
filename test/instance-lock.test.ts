import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { acquireInstanceLock } from "../src/instance-lock"

function fixture(): { readonly directory: string; readonly path: string } {
  const directory = mkdtempSync(join(tmpdir(), "astocktui-instance-lock-"))
  return { directory, path: join(directory, "app.lock") }
}

test("首个实例获得锁，第二个实例被拒绝并看到持有者 PID", () => {
  const { directory, path } = fixture()
  try {
    const first = acquireInstanceLock({ path, pid: 111, isAlive: () => true })
    if (!first.ok) throw new Error("首个实例应获得锁")
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ pid: 111 })

    const second = acquireInstanceLock({ path, pid: 222, isAlive: () => true })
    expect(second).toEqual({ ok: false, pid: 111 })

    first.lock.release()
    expect(existsSync(path)).toBe(false)

    const third = acquireInstanceLock({ path, pid: 222, isAlive: () => true })
    expect(third.ok).toBe(true)
    third.ok && third.lock.release()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("持有者已死（陈旧锁）时接管", () => {
  const { directory, path } = fixture()
  try {
    writeFileSync(path, JSON.stringify({ pid: 999, startedAt: "2026-07-20T00:00:00.000Z" }))
    const acquired = acquireInstanceLock({ path, pid: 222, isAlive: (pid) => pid !== 999 })
    if (!acquired.ok) throw new Error("陈旧锁应被接管")
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ pid: 222 })
    acquired.lock.release()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("release 只释放自己的锁，不删别人的", () => {
  const { directory, path } = fixture()
  try {
    const acquired = acquireInstanceLock({ path, pid: 111, isAlive: () => true })
    if (!acquired.ok) throw new Error("应获得锁")
    writeFileSync(path, JSON.stringify({ pid: 222, startedAt: "x" }))
    acquired.lock.release()
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ pid: 222 })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("锁文件损坏时按无锁处理", () => {
  const { directory, path } = fixture()
  try {
    writeFileSync(path, "not json", "utf8")
    const acquired = acquireInstanceLock({ path, pid: 111, isAlive: () => true })
    expect(acquired.ok).toBe(true)
    acquired.ok && acquired.lock.release()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
