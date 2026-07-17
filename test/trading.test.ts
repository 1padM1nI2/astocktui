import { describe, expect, test } from "bun:test"
import { calculatePortfolio } from "../src/portfolio"
import { PaperTradingService, type TradeQuote } from "../src/trading"

const QUOTE: TradeQuote = {
  code: "SH600519",
  name: "贵州茅台",
  price: 100,
}

function tradingClock(): { readonly now: () => Date; nextDay(): void } {
  let current = new Date("2026-07-15T02:00:00.000Z")
  return {
    now: () => current,
    nextDay(): void {
      current = new Date("2026-07-16T02:00:00.000Z")
    },
  }
}

describe("A 股模拟交易引擎", () => {
  test("默认账户为十万元空仓", () => {
    const service = new PaperTradingService()

    expect(service.snapshot).toEqual({
      initialCapital: 100_000,
      cash: 100_000,
      positions: [],
    })
    expect(service.trades).toEqual([])
  })

  test("买入按一手校验并计入佣金与过户费", () => {
    const clock = tradingClock()
    const service = new PaperTradingService({ now: clock.now })

    expect(service.execute("buy", QUOTE, 99).message).toContain("100股整数倍")
    const result = service.execute("buy", QUOTE, 100)

    expect(result.ok).toBe(true)
    expect(result.trade?.grossAmount).toBe(10_000)
    expect(result.trade?.commission).toBe(5)
    expect(result.trade?.transferFee).toBe(0.1)
    expect(result.trade?.stampDuty).toBe(0)
    expect(result.trade?.totalFees).toBe(5.1)
    expect(service.snapshot.cash).toBe(89_994.9)
    expect(service.snapshot.positions[0]).toMatchObject({
      code: "SH600519",
      quantity: 100,
      sellableQuantity: 0,
      averageCost: 100.051,
      currentPrice: 100,
    })
  })

  test("预览不会修改账户，资金不足明确拒绝", () => {
    const service = new PaperTradingService()
    const expensiveQuote = { ...QUOTE, price: 1_500 }

    const preview = service.preview("buy", QUOTE, 100)
    expect(preview.ok).toBe(true)
    expect(service.snapshot.positions).toEqual([])

    const rejected = service.execute("buy", expensiveQuote, 100)
    expect(rejected.ok).toBe(false)
    expect(rejected.message).toContain("资金不足")
    expect(service.snapshot.cash).toBe(100_000)
  })

  test("海外股票仅可分析，预览和执行均不得修改 A 股模拟账户", () => {
    const service = new PaperTradingService()
    const globalQuote: TradeQuote = { code: "US:AAPL", name: "Apple", price: 210 }

    expect(service.preview("buy", globalQuote, 100)).toMatchObject({
      ok: false,
      message: "海外股票当前仅支持分析",
    })
    expect(service.execute("buy", globalQuote, 100)).toMatchObject({
      ok: false,
      message: "海外股票当前仅支持分析",
    })
    expect(service.snapshot.positions).toEqual([])
    expect(service.trades).toEqual([])
  })

  test("当日买入不可卖，下一交易日可卖并计算实现盈亏", () => {
    const clock = tradingClock()
    const service = new PaperTradingService({ now: clock.now })
    service.execute("buy", QUOTE, 100)

    const sameDay = service.execute("sell", { ...QUOTE, price: 110 }, "all")
    expect(sameDay.ok).toBe(false)
    expect(sameDay.message).toContain("T+1")

    clock.nextDay()
    const sold = service.execute("sell", { ...QUOTE, price: 110 }, "all")

    expect(sold.ok).toBe(true)
    expect(sold.trade?.commission).toBe(5)
    expect(sold.trade?.stampDuty).toBe(5.5)
    expect(sold.trade?.transferFee).toBe(0.11)
    expect(sold.trade?.realizedProfit).toBe(984.29)
    expect(service.snapshot.cash).toBe(100_984.29)
    expect(service.snapshot.positions).toEqual([])
    expect(calculatePortfolio(service.snapshot).totalProfit).toBe(984.29)
    expect(service.trades).toHaveLength(2)
  })

  test("多次买入使用含费用成本加权并支持行情盯市", () => {
    const clock = tradingClock()
    const service = new PaperTradingService({ now: clock.now })
    service.execute("buy", QUOTE, 100)
    service.execute("buy", { ...QUOTE, price: 110 }, 100)

    service.updatePrices([{ ...QUOTE, price: 120 }])
    const position = service.snapshot.positions[0]

    expect(position?.quantity).toBe(200)
    expect(position?.averageCost).toBeCloseTo(105.05105, 5)
    expect(position?.currentPrice).toBe(120)
    expect(calculatePortfolio(service.snapshot).unrealizedProfit).toBeCloseTo(2_989.79, 2)
  })

  test("重置账户会清空持仓和成交历史", () => {
    const service = new PaperTradingService()
    service.execute("buy", QUOTE, 100)
    expect(service.trades).toHaveLength(1)

    service.reset()

    expect(service.snapshot.cash).toBe(100_000)
    expect(service.snapshot.positions).toEqual([])
    expect(service.trades).toEqual([])
  })

  test("账户写入失败时回滚内存交易", () => {
    const service = new PaperTradingService({
      onStateChange: () => {
        throw new Error("磁盘已满")
      },
    })

    expect(() => service.execute("buy", QUOTE, 100)).toThrow("磁盘已满")
    expect(service.snapshot.cash).toBe(100_000)
    expect(service.snapshot.positions).toEqual([])
    expect(service.trades).toEqual([])
  })
})
