import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { discoverSkills } from "../../src/agent/skills"

async function fixture(): Promise<{ readonly root: string; readonly home: string }> {
  const root = await mkdtemp(join(tmpdir(), "astock-skills-"))
  const home = join(root, "home")
  await mkdir(home)
  return { root, home }
}

async function skill(root: string, relativeDir: string, content: string): Promise<void> {
  const directory = join(root, relativeDir)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, "SKILL.md"), content)
}

test("Skill 按 OMP 来源优先级发现一层目录并解析 frontmatter", async () => {
  const { root, home } = await fixture()
  try {
    await skill(
      root,
      ".claude/skills/research",
      "---\nname: research\ndescription: Claude 研究流程\n---\nClaude 正文",
    )
    await skill(
      root,
      ".omp/skills/research",
      "---\nname: research\ndescription: OMP 研究流程\nhide: true\nalwaysApply: true\n---\nOMP 正文",
    )
    await skill(
      root,
      ".agents/skills/valuation",
      "---\ndescription: 估值流程\ndisable-model-invocation: true\n---\n估值正文",
    )
    await skill(root, ".agents/skills/group/nested", "---\ndescription: 不应发现\n---\n嵌套正文")

    const registry = await discoverSkills({ cwd: root, home })

    expect(registry.skills.map((item) => item.name)).toEqual(["research", "valuation"])
    expect(registry.skills[0]).toMatchObject({
      description: "OMP 研究流程",
      body: "OMP 正文",
      hide: true,
      alwaysApply: true,
      source: "omp-project",
    })
    expect(registry.skills[1]).toMatchObject({
      disableModelInvocation: true,
      source: "agents-project",
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("Skill 读取限制在 Skill 目录内并隔离无效原生 Skill", async () => {
  const { root, home } = await fixture()
  try {
    await skill(root, ".omp/skills/invalid", "---\nname: invalid\n---\n缺少描述")
    await skill(root, ".omp/skills/safe", "---\ndescription: 安全流程\n---\n正文")
    await writeFile(join(root, ".omp", "skills", "safe", "guide.md"), "参考资料")

    const registry = await discoverSkills({ cwd: root, home })

    expect(registry.skills.map((item) => item.name)).toEqual(["safe"])
    expect(registry.diagnostics).toContainEqual(
      expect.objectContaining({ scope: "skill", subject: "invalid" }),
    )
    await expect(registry.read("skill://safe/guide.md")).resolves.toMatchObject({
      text: "参考资料",
    })
    await expect(registry.read("skill://safe/../SKILL.md")).rejects.toThrow("路径")
    await expect(registry.read("skill://safe/%2e%2e/SKILL.md")).rejects.toThrow("路径")
    await expect(registry.read("skill://unknown")).rejects.toThrow("不存在")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
