export interface MarketIndexOverview {
  readonly code: string
  readonly name: string
  readonly price: number
  readonly changePercent: number
  readonly high: number
  readonly low: number
  readonly previousClose: number
  readonly source: string
}

export interface MarketBreadth {
  readonly rising: number
  readonly falling: number
  readonly flat: number
  readonly gainAtLeast10Percent: number
  readonly lossAtLeast10Percent: number
  readonly distribution: Readonly<Record<string, number>>
}

export interface SectorOverview {
  readonly code: string
  readonly name: string
  readonly changePercent: number
  readonly companyCount: number
  readonly turnover: number
  readonly leaderCode: string
  readonly leaderName: string
  readonly leaderChangePercent: number
}

export interface MarketMover {
  readonly code: string
  readonly name: string
  readonly price: number
  readonly changePercent: number
  readonly turnover: number
  readonly turnoverRate: number
}

export interface MarketOverviewSnapshot {
  readonly indices: readonly MarketIndexOverview[]
  readonly breadth: MarketBreadth | null
  readonly sectors: {
    readonly leaders: readonly SectorOverview[]
    readonly laggards: readonly SectorOverview[]
    readonly totalTurnover: number
  } | null
  readonly movers: {
    readonly gainers: readonly MarketMover[]
    readonly losers: readonly MarketMover[]
  } | null
  readonly availability: {
    readonly indices: boolean
    readonly breadth: boolean
    readonly sectors: boolean
    readonly movers: boolean
    readonly errors: readonly string[]
  }
  readonly source: string
  readonly updatedAt: number
}

export interface MarketOverviewDataSource {
  loadOverview(): Promise<MarketOverviewSnapshot>
}

export class MarketOverviewService {
  readonly #source: MarketOverviewDataSource
  readonly #ttlMs: number
  readonly #now: () => number
  #snapshot: MarketOverviewSnapshot | null = null
  #loadedAt = 0
  #pending: Promise<MarketOverviewSnapshot> | null = null

  constructor(source: MarketOverviewDataSource, ttlMs = 60_000, now: () => number = Date.now) {
    this.#source = source
    this.#ttlMs = ttlMs
    this.#now = now
  }

  get snapshot(): MarketOverviewSnapshot | null {
    return this.#snapshot
  }

  getOverview(): Promise<MarketOverviewSnapshot> {
    if (this.#snapshot !== null && this.#now() - this.#loadedAt < this.#ttlMs) {
      return Promise.resolve(this.#snapshot)
    }
    return this.#load()
  }

  refresh(): Promise<MarketOverviewSnapshot> {
    return this.#load()
  }

  #load(): Promise<MarketOverviewSnapshot> {
    if (this.#pending !== null) return this.#pending
    const pending = this.#source.loadOverview().then((snapshot) => {
      this.#snapshot = snapshot
      this.#loadedAt = this.#now()
      return snapshot
    })
    this.#pending = pending
    const clearPending = (): void => {
      this.#pending = null
    }
    void pending.then(clearPending, clearPending)
    return pending
  }
}
