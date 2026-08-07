export const WIDE_MIN_WIDTH = 160
export const MEDIUM_MIN_WIDTH = 110

export type LayoutTier = "wide" | "medium" | "narrow"

export function layoutTier(width: number): LayoutTier {
  if (width >= WIDE_MIN_WIDTH) return "wide"
  if (width >= MEDIUM_MIN_WIDTH) return "medium"
  return "narrow"
}

/** Agent 面板在各布局档位下占据的行数 */
export function agentPanelHeight(width: number, viewportRows: number): number {
  const rows = Math.max(1, viewportRows | 0)
  const tier = layoutTier(width)
  if (tier === "narrow") return rows
  if (tier === "medium") return Math.min(rows, Math.max(Math.ceil(rows / 3), Math.min(10, rows)))
  return Math.min(rows, Math.max(Math.ceil(rows / 2), Math.min(12, rows)))
}
