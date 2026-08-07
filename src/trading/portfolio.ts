export interface PortfolioPosition {
  readonly code: string
  readonly name: string
  readonly quantity: number
  readonly sellableQuantity: number
  readonly averageCost: number
  readonly currentPrice: number
}

export interface PortfolioSnapshot {
  readonly initialCapital: number
  readonly cash: number
  readonly positions: readonly PortfolioPosition[]
}

export interface PortfolioSummary {
  readonly marketValue: number
  readonly costBasis: number
  readonly unrealizedProfit: number
  readonly realizedProfit: number
  readonly totalAssets: number
  readonly totalProfit: number
  readonly totalReturnPercent: number
}

export const EMPTY_PORTFOLIO: PortfolioSnapshot = {
  initialCapital: 100_000,
  cash: 100_000,
  positions: [],
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function calculatePortfolio(snapshot: PortfolioSnapshot): PortfolioSummary {
  let marketValue = 0
  let costBasis = 0
  for (const position of snapshot.positions) {
    marketValue += position.quantity * position.currentPrice
    costBasis += position.quantity * position.averageCost
  }

  marketValue = roundMoney(marketValue)
  costBasis = roundMoney(costBasis)
  const unrealizedProfit = roundMoney(marketValue - costBasis)
  const totalAssets = roundMoney(snapshot.cash + marketValue)
  const totalProfit = roundMoney(totalAssets - snapshot.initialCapital)
  const realizedProfit = roundMoney(totalProfit - unrealizedProfit)
  const totalReturnPercent =
    snapshot.initialCapital === 0 ? 0 : (totalProfit / snapshot.initialCapital) * 100
  return {
    marketValue,
    costBasis,
    unrealizedProfit,
    realizedProfit,
    totalAssets,
    totalProfit,
    totalReturnPercent,
  }
}
