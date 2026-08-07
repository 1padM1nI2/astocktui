import { readdir, readFile, realpath } from "node:fs/promises"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import type { ExtensionDiagnostic } from "./agent-extension-types"

export type SkillSource =
  | "omp-project"
  | "omp-user"
  | "claude-project"
  | "claude-user"
  | "agents-project"
  | "agents-user"
  | "codex-project"
  | "codex-user"
  | "github-project"

export interface DiscoveredSkill {
  readonly name: string
  readonly description: string
  readonly body: string
  readonly filePath: string
  readonly baseDir: string
  readonly source: SkillSource
  readonly hide: boolean
  readonly disableModelInvocation: boolean
  readonly alwaysApply: boolean
}

export interface SkillDiscoveryOptions {
  readonly cwd: string
  readonly home?: string
}

interface SkillRoot {
  readonly source: SkillSource
  readonly path: string
  readonly requireDescription: boolean
}

export class SkillRegistry {
  readonly #byName: ReadonlyMap<string, DiscoveredSkill>
  readonly skills: readonly DiscoveredSkill[]
  readonly diagnostics: readonly ExtensionDiagnostic[]

  constructor(skills: readonly DiscoveredSkill[], diagnostics: readonly ExtensionDiagnostic[]) {
    this.skills = skills
    this.diagnostics = diagnostics
    this.#byName = new Map(skills.map((skill) => [skill.name, skill]))
  }

  find(name: string): DiscoveredSkill | undefined {
    return this.#byName.get(name)
  }

  async read(uri: string): Promise<{ readonly text: string; readonly path: string }> {
    const parsed = parseSkillUri(uri)
    const skill = this.#byName.get(parsed.name)
    if (skill === undefined) throw new Error(`Skill 不存在：${parsed.name}`)
    if (parsed.relativePath.length === 0)
      return { text: await readFile(skill.filePath, "utf8"), path: skill.filePath }
    if (
      isAbsolute(parsed.relativePath) ||
      parsed.relativePath.split(/[\\/]/u).some((part) => part === "..")
    ) {
      throw new Error("Skill 路径无效")
    }
    const candidate = resolve(skill.baseDir, parsed.relativePath)
    if (!isWithin(skill.baseDir, candidate)) throw new Error("Skill 路径无效")
    let filePath: string
    try {
      filePath = await realpath(candidate)
    } catch {
      throw new Error(`Skill 文件不存在：${uri}`)
    }
    if (!isWithin(skill.baseDir, filePath)) throw new Error("Skill 路径无效")
    return { text: await readFile(filePath, "utf8"), path: filePath }
  }
}

export async function discoverSkills(options: SkillDiscoveryOptions): Promise<SkillRegistry> {
  const diagnostics: ExtensionDiagnostic[] = []
  const skills: DiscoveredSkill[] = []
  const names = new Set<string>()
  for (const root of skillRoots(options)) {
    for (const entry of await directories(root.path)) {
      const skill = await loadSkill(root, entry, diagnostics)
      if (skill === undefined) continue
      if (names.has(skill.name)) {
        diagnostics.push({
          scope: "skill",
          subject: skill.name,
          source: root.path,
          message: `Skill 名称冲突，已保留更高优先级来源：${skill.name}`,
        })
        continue
      }
      names.add(skill.name)
      skills.push(skill)
    }
  }
  return new SkillRegistry(skills, diagnostics)
}

function skillRoots(options: SkillDiscoveryOptions): readonly SkillRoot[] {
  const home = options.home ?? Bun.env["USERPROFILE"] ?? Bun.env["HOME"] ?? options.cwd
  return [
    { source: "omp-project", path: join(options.cwd, ".omp", "skills"), requireDescription: true },
    { source: "omp-user", path: join(home, ".omp", "agent", "skills"), requireDescription: true },
    {
      source: "claude-project",
      path: join(options.cwd, ".claude", "skills"),
      requireDescription: false,
    },
    { source: "claude-user", path: join(home, ".claude", "skills"), requireDescription: false },
    {
      source: "agents-project",
      path: join(options.cwd, ".agents", "skills"),
      requireDescription: false,
    },
    { source: "agents-user", path: join(home, ".agents", "skills"), requireDescription: false },
    {
      source: "codex-project",
      path: join(options.cwd, ".codex", "skills"),
      requireDescription: false,
    },
    { source: "codex-user", path: join(home, ".codex", "skills"), requireDescription: false },
    {
      source: "github-project",
      path: join(options.cwd, ".github", "skills"),
      requireDescription: true,
    },
  ]
}

async function directories(path: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

async function loadSkill(
  root: SkillRoot,
  directory: string,
  diagnostics: ExtensionDiagnostic[],
): Promise<DiscoveredSkill | undefined> {
  const filePath = join(root.path, directory, "SKILL.md")
  let source: string
  try {
    source = await readFile(filePath, "utf8")
  } catch {
    return undefined
  }
  const parsed = parseFrontmatter(source)
  const name = parsed.fields["name"] ?? directory
  const description = parsed.fields["description"] ?? ""
  if (!isSkillName(name)) {
    diagnostics.push({
      scope: "skill",
      subject: directory,
      source: filePath,
      message: "Skill 名称无效",
    })
    return undefined
  }
  if (root.requireDescription && description.length === 0) {
    diagnostics.push({
      scope: "skill",
      subject: name,
      source: filePath,
      message: "Skill 缺少 description",
    })
    return undefined
  }
  try {
    const baseDir = await realpath(join(root.path, directory))
    const resolvedFile = await realpath(filePath)
    if (!isWithin(baseDir, resolvedFile)) throw new Error("Skill 文件路径无效")
    return {
      name,
      description,
      body: parsed.body,
      filePath: resolvedFile,
      baseDir,
      source: root.source,
      hide: parseBoolean(parsed.fields["hide"]),
      disableModelInvocation: parseBoolean(
        parsed.fields["disableModelInvocation"] ?? parsed.fields["disable-model-invocation"],
      ),
      alwaysApply: parseBoolean(parsed.fields["alwaysApply"]),
    }
  } catch (error) {
    diagnostics.push({
      scope: "skill",
      subject: name,
      source: filePath,
      message: error instanceof Error ? error.message : "Skill 文件路径无效",
    })
    return undefined
  }
}

function parseFrontmatter(source: string): {
  readonly fields: Readonly<Record<string, string>>
  readonly body: string
} {
  if (!source.startsWith("---\n") && !source.startsWith("---\r\n"))
    return { fields: {}, body: source.trim() }
  const lines = source.split(/\r?\n/u)
  const closing = lines.findIndex((line, index) => index > 0 && line === "---")
  if (closing < 0) return { fields: {}, body: source.trim() }
  const fields: Record<string, string> = {}
  for (const line of lines.slice(1, closing)) {
    const match = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/u.exec(line)
    if (match?.[1] === undefined || match[2] === undefined) continue
    fields[match[1]] = unquote(match[2])
  }
  return {
    fields,
    body: lines
      .slice(closing + 1)
      .join("\n")
      .trim(),
  }
}

function parseSkillUri(uri: string): { readonly name: string; readonly relativePath: string } {
  const match = /^skill:\/\/([^/?#]+)(?:\/(.*))?$/u.exec(uri)
  if (match?.[1] === undefined) throw new Error(`Skill URI 无效：${uri}`)
  try {
    return { name: decodeURIComponent(match[1]), relativePath: decodeURIComponent(match[2] ?? "") }
  } catch {
    throw new Error(`Skill URI 无效：${uri}`)
  }
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function parseBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true"
}

function isSkillName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)
}

function isWithin(base: string, target: string): boolean {
  const path = relative(base, target)
  return path.length === 0 || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path))
}
