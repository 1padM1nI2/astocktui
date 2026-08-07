import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  buildSkillPrompt,
  createSkillCommands,
  createSkillReadTool,
} from "../../src/agent/skill-tool"
import { type DiscoveredSkill, discoverSkills } from "../../src/agent/skills"
import { filterCommands } from "../../src/commands/commands"

function skill(name: string, overrides: Partial<DiscoveredSkill> = {}): DiscoveredSkill {
  return {
    name,
    description: `${name} 流程`,
    body: `${name} 正文`,
    filePath: `/skills/${name}/SKILL.md`,
    baseDir: `/skills/${name}`,
    source: "omp-project",
    hide: false,
    disableModelInvocation: false,
    alwaysApply: false,
    ...overrides,
  }
}

test("Skill 提示词仅公开可模型调用的元数据，并注入 alwaysApply 正文", () => {
  const prompt = buildSkillPrompt([
    skill("valuation", { alwaysApply: true }),
    skill("hidden", { hide: true }),
    skill("manual", { disableModelInvocation: true }),
  ]).join("\n")

  expect(prompt).toContain("valuation")
  expect(prompt).toContain("valuation 正文")
  expect(prompt).not.toContain("hidden")
  expect(prompt).not.toContain("manual")
})

test("Skill 命令仅补全可调用 Skill", () => {
  const commands = createSkillCommands([
    skill("valuation"),
    skill("hidden", { hide: true }),
    skill("manual", { disableModelInvocation: true }),
  ])

  expect(commands.map((command) => command.name)).toEqual(["skill:valuation"])
  expect(filterCommands("/skill:", commands).map((command) => command.name)).toEqual([
    "skill:valuation",
  ])
})

test("Skill 读取工具仅接受已发现的 skill:// 路径", async () => {
  const root = await mkdtemp(join(tmpdir(), "astock-skill-tool-"))
  try {
    const directory = join(root, ".omp", "skills", "valuation")
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, "SKILL.md"), "---\ndescription: 估值流程\n---\n估值正文")
    const registry = await discoverSkills({ cwd: root, home: join(root, "home") })
    const tool = createSkillReadTool(registry)

    expect(tool.name).toBe("read_skill")

    const success = await tool.execute("test", { path: "skill://valuation" })
    expect(success.content).toEqual([
      { type: "text", text: "---\ndescription: 估值流程\n---\n估值正文" },
    ])

    const rejected = await tool.execute("test", { path: "skill://valuation/../SKILL.md" })
    expect(rejected.isError).toBe(true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
