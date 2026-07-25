import { stripVTControlCharacters } from "node:util"
import { MarketIntelligenceApp } from "../src/app"
import type { MarketDataSource } from "../src/market-data"
import type { NewsDataSource } from "../src/news-data"

const marketSource: MarketDataSource = {
  async loadSnapshot() {
    return { quotes: [], trend: [], source: "stub" }
  },
}
const newsSource: NewsDataSource = {
  async loadNews() {
    return { items: [], source: "stub" }
  },
}
const app = new MarketIntelligenceApp(marketSource, newsSource)

// 切到 Agent 页
app.handleInput("\t")
app.handleInput("\t")
app.handleInput("\t")
for (const char of "ni hao") app.handleInput(char)
const frame = stripVTControlCharacters(app.render(80).join("\n"))
console.log(frame.split("\n").slice(-6).join("\n"))
console.log("包含 'ni hao':", frame.includes("ni hao"))
console.log("包含 'nihao':", frame.includes("nihao"))
await app.dispose()
