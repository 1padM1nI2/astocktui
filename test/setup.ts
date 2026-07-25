import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// 测试进程隔离：应用数据目录重定向到临时目录，避免测试读写生产数据。
// defaultAppDataPath 按 LOCALAPPDATA → XDG_DATA_HOME → HOME 顺序回退，全部覆盖。
const isolated = mkdtempSync(join(tmpdir(), "astocktui-test-data-"))
process.env["LOCALAPPDATA"] = isolated
process.env["XDG_DATA_HOME"] = isolated
process.env["HOME"] = isolated
process.env["USERPROFILE"] = isolated
