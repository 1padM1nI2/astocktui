import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

export function defaultAppDataPath(fileName: string): string {
  const localAppData = Reflect.get(Bun.env, "LOCALAPPDATA")
  if (typeof localAppData === "string") return join(localAppData, "AStockTUI", fileName)
  const xdgDataHome = Reflect.get(Bun.env, "XDG_DATA_HOME")
  if (typeof xdgDataHome === "string") return join(xdgDataHome, "astocktui", fileName)
  const home = Reflect.get(Bun.env, "HOME") ?? Reflect.get(Bun.env, "USERPROFILE")
  return join(typeof home === "string" ? home : process.cwd(), ".astocktui", fileName)
}

export function readJsonFile(path: string): unknown | null {
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, "utf8"))
}

export function writeJsonFileAtomically(path: string, value: unknown): void {
  const directory = dirname(path)
  mkdirSync(directory, { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    })
    renameSync(temporaryPath, path)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}
