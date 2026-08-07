/** 给不支持 AbortSignal 的异步操作加超时；settle 后清理定时器，避免悬挂句柄 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // 不能 unref：Bun 下仅剩 unref 定时器时事件循环会休眠，超时永不触发
    const timer = setTimeout(() => reject(new Error(`${label} 超时`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}
