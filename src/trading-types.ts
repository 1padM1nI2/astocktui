export type TradeSide = "buy" | "sell"
export type OrderQuantity = number | "all"

export interface TradeQuote {
  readonly code: string
  readonly name: string
  readonly price: number
}

export interface TradePreview {
  readonly side: TradeSide
  readonly code: string
  readonly name: string
  readonly quantity: number
  readonly price: number
  readonly grossAmount: number
  readonly commission: number
  readonly stampDuty: number
  readonly transferFee: number
  readonly totalFees: number
  readonly cashChange: number
  readonly cashAfter: number
  readonly realizedProfit: number
}

export interface SimulatedTrade extends TradePreview {
  readonly id: string
  readonly executedAt: string
  readonly tradeDate: string
}

export interface TradeResult {
  readonly ok: boolean
  readonly message: string
  readonly preview?: TradePreview
  readonly trade?: SimulatedTrade
}

export interface PaperTradingLotState {
  readonly quantity: number
  readonly acquiredOn: string
}

export interface PaperTradingPositionState {
  readonly code: string
  readonly name: string
  readonly quantity: number
  readonly averageCost: number
  readonly currentPrice: number
  readonly lots: readonly PaperTradingLotState[]
}

export interface PaperTradingState {
  readonly version: 1
  readonly initialCapital: number
  readonly cash: number
  readonly sequence: number
  readonly positions: readonly PaperTradingPositionState[]
  readonly trades: readonly SimulatedTrade[]
}

export interface PaperTradingOptions {
  readonly initialCapital?: number
  readonly now?: () => Date
  readonly commissionRate?: number
  readonly minimumCommission?: number
  readonly stampDutyRate?: number
  readonly transferFeeRate?: number
  readonly lotSize?: number
  readonly state?: PaperTradingState
  readonly onStateChange?: (state: PaperTradingState) => void
}
