import type { PaperTradingState, SimulatedTrade, TradePreview } from "./types"

export interface PositionLot {
  quantity: number
  readonly acquiredOn: string
}

export interface TradingPosition {
  readonly code: string
  readonly name: string
  quantity: number
  averageCost: number
  currentPrice: number
  readonly lots: PositionLot[]
}

export function serializeTradingState(
  initialCapital: number,
  cash: number,
  sequence: number,
  positions: ReadonlyMap<string, TradingPosition>,
  trades: readonly SimulatedTrade[],
): PaperTradingState {
  return {
    version: 1,
    initialCapital,
    cash,
    sequence,
    positions: [...positions.values()].map((position) => ({
      code: position.code,
      name: position.name,
      quantity: position.quantity,
      averageCost: position.averageCost,
      currentPrice: position.currentPrice,
      lots: position.lots.map((lot) => ({ ...lot })),
    })),
    trades: trades.map((trade) => ({ ...trade })),
  }
}

export function restoreTradingPositions(state: PaperTradingState): Map<string, TradingPosition> {
  const positions = new Map<string, TradingPosition>()
  for (const position of state.positions) {
    positions.set(position.code, {
      code: position.code,
      name: position.name,
      quantity: position.quantity,
      averageCost: position.averageCost,
      currentPrice: position.currentPrice,
      lots: position.lots.map((lot) => ({ ...lot })),
    })
  }
  return positions
}

export function applyBuy(
  positions: Map<string, TradingPosition>,
  preview: TradePreview,
  tradeDate: string,
): void {
  const current = positions.get(preview.code)
  const totalCost = -preview.cashChange
  if (current === undefined) {
    positions.set(preview.code, {
      code: preview.code,
      name: preview.name,
      quantity: preview.quantity,
      averageCost: totalCost / preview.quantity,
      currentPrice: preview.price,
      lots: [{ quantity: preview.quantity, acquiredOn: tradeDate }],
    })
    return
  }
  const previousCost = current.averageCost * current.quantity
  current.quantity += preview.quantity
  current.averageCost = (previousCost + totalCost) / current.quantity
  current.currentPrice = preview.price
  current.lots.push({ quantity: preview.quantity, acquiredOn: tradeDate })
}

export function applySell(
  positions: Map<string, TradingPosition>,
  preview: TradePreview,
  tradeDate: string,
): void {
  const position = positions.get(preview.code)
  if (position === undefined) return
  let remaining = preview.quantity
  for (const lot of position.lots) {
    if (lot.acquiredOn >= tradeDate || remaining === 0) continue
    const consumed = Math.min(lot.quantity, remaining)
    lot.quantity -= consumed
    remaining -= consumed
  }
  position.quantity -= preview.quantity
  position.currentPrice = preview.price
  for (let index = position.lots.length - 1; index >= 0; index--) {
    if (position.lots[index]?.quantity === 0) position.lots.splice(index, 1)
  }
  if (position.quantity === 0) positions.delete(preview.code)
}
