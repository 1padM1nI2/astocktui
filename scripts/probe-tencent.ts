const response = await fetch("https://qt.gtimg.cn/q=sh600519,sz000858")
const text = await response.text()
for (const line of text.trim().split(";")) {
  const trimmed = line.trim()
  if (trimmed.length === 0) continue
  const eq = trimmed.indexOf("=")
  const payload = trimmed.slice(eq + 1).replace(/^"|"$/g, "")
  const parts = payload.split("~")
  console.log(trimmed.slice(0, eq))
  for (let i = 0; i < parts.length; i++) {
    const value = parts[i]
    if (value !== "" && value !== "0" && value !== "0.00" && value !== "0.000")
      console.log(`  [${i}] ${value}`)
  }
}
