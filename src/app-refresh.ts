export type AppRefreshTarget = "market" | "news" | "all"

export async function refreshAppData(
  target: AppRefreshTarget,
  refreshMarket: () => Promise<unknown>,
  refreshOverview: () => Promise<unknown>,
  refreshNews: () => Promise<unknown>,
): Promise<void> {
  await Promise.all([
    target !== "news" ? refreshMarket() : undefined,
    target !== "news" ? refreshOverview() : undefined,
    target !== "market" ? refreshNews() : undefined,
  ])
}
