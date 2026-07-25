import type { AgentTool } from "@oh-my-pi/pi-agent-core"
import { z } from "@oh-my-pi/pi-ai"
import type { CommandContext } from "./command-context"
import type { AppCommand, CommandExecution } from "./commands"
import type { DiscoveredSkill, SkillRegistry } from "./skills"

export function buildSkillPrompt(skills: readonly DiscoveredSkill[]): readonly string[] {
  const visible = skills.filter((skill) => !skill.hide && !skill.disableModelInvocation)
  const alwaysApply = skills.filter((skill) => skill.alwaysApply)
  const prompt: string[] = []
  if (visible.length > 0) {
    prompt.push(
      [
        "可用 Skills（需要时通过 read_skill 工具读取 skill://<name> 或 skill://<name>/<relative-path>）：",
        ...visible.map((skill) => `- ${skill.name}: ${skill.description}`),
      ].join("\n"),
    )
  }
  for (const skill of alwaysApply) prompt.push(`Skill · ${skill.name}\n${skill.body}`)
  return prompt
}

const SKILL_READ_PARAMETERS = z.object({ path: z.string() })

export function createSkillReadTool(
  registry: SkillRegistry,
): AgentTool<typeof SKILL_READ_PARAMETERS> {
  return {
    name: "read_skill",
    label: "读取 Skill",
    description: "读取已发现 Skill 的 skill:// 内容；不支持任意文件系统路径。",
    parameters: SKILL_READ_PARAMETERS,
    intent: "omit",
    approval: "read",
    execute: async (_id, params) => {
      try {
        const result = await registry.read(params.path)
        return {
          content: [{ type: "text", text: result.text }],
          details: { path: result.path },
        }
      } catch (error) {
        return {
          content: [
            { type: "text", text: error instanceof Error ? error.message : "Skill 读取失败" },
          ],
          details: { path: params.path },
          isError: true,
        }
      }
    },
  }
}

export function createSkillCommands(skills: readonly DiscoveredSkill[]): readonly AppCommand[] {
  return skills
    .filter((skill) => !skill.hide && !skill.disableModelInvocation)
    .map((skill) => ({
      name: `skill:${skill.name}`,
      aliases: [],
      category: "system" as const,
      usage: `/skill:${skill.name} [args]`,
      description: skill.description,
      execute: (context: CommandContext, args: readonly string[]): CommandExecution =>
        invokeSkill(context, skill, args),
    }))
}

function invokeSkill(
  context: CommandContext,
  skill: DiscoveredSkill,
  args: readonly string[],
): CommandExecution {
  if (context.invokeSkill === undefined) {
    return { kind: "output", title: "Skill 命令错误", lines: [`Skill 未就绪：${skill.name}`] }
  }
  return context.invokeSkill(skill.name, args)
}
