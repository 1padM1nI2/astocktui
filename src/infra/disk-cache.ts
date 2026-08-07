import { readJsonFile, writeJsonFileAtomically } from "./json-file"

export interface CacheEnvelope<T> {
  readonly cachedAt: number
  readonly value: T
}

/** 原子写入 `{ cachedAt, value }` 信封；now 可注入便于测试 */
export function writeCache<T>(path: string, value: T, now: () => number = Date.now): void {
  writeJsonFileAtomically(path, { cachedAt: now(), value } satisfies CacheEnvelope<T>)
}

/** 文件不存在、JSON 损坏或形状不符都返回 null */
export function readCache<T>(path: string): CacheEnvelope<T> | null {
  try {
    const raw: unknown = readJsonFile(path)
    if (typeof raw !== "object" || raw === null) return null
    const cachedAt = Reflect.get(raw, "cachedAt")
    if (typeof cachedAt !== "number" || !Number.isFinite(cachedAt)) return null
    if (!("value" in raw)) return null
    return { cachedAt, value: (raw as { readonly value: T }).value }
  } catch {
    return null
  }
}
