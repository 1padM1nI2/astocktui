import { expect, test } from "bun:test"
import { stripVTControlCharacters } from "node:util"
import { visibleWidth } from "@oh-my-pi/pi-tui"
import { alignCell, fitLine } from "../src/width"

test("将混合中文与 ANSI 的行情文本裁切到给定列宽", () => {
  // Given
  const text = "\x1b[31m600519 贵州茅台 +1.21%\x1b[0m"

  // When
  const line = fitLine(text, 16)

  // Then
  expect(line).toContain("…")
})

test("按可见宽度对齐中文和 ANSI 单元格", () => {
  const name = alignCell("贵州茅台", 10, "left")
  const change = alignCell("\x1b[31m+1.21%\x1b[0m", 8, "right")

  expect(visibleWidth(name)).toBe(10)
  expect(stripVTControlCharacters(name)).toBe("贵州茅台  ")
  expect(visibleWidth(change)).toBe(8)
  expect(stripVTControlCharacters(change)).toBe("  +1.21%")
  expect(change).toContain("\x1b[31m")
})
