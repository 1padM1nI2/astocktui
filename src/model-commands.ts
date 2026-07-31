import type { AppCommand, CommandResult } from "./commands"

const output = (title: string, lines: readonly string[]): CommandResult => ({
  kind: "output",
  title,
  lines,
})

export const MODEL_COMMANDS: readonly AppCommand[] = [
  {
    name: "model",
    aliases: [],
    category: "system",
    usage: "/model [序号|provider/model]",
    description: "查看或切换 Agent 模型（含备用链）",
    execute: (context, args) => {
      const switcher = context.agentModel?.()
      if (switcher === undefined) return output("模型", ["模型不可用或未配置"])
      const target = args[0]
      if (target === undefined) {
        const current = switcher.current()
        return output("模型", [
          ...switcher
            .list()
            .map((label, index) => `${index + 1}. ${label}${label === current ? "（当前）" : ""}`),
          "切换：/model <序号|provider/model>",
        ])
      }
      try {
        const label = switcher.select(target)
        return output("模型", [`已切换 → ${label}`])
      } catch (error) {
        return output("命令错误", [
          error instanceof Error ? error.message : "切换失败",
          "用法 /model [序号|provider/model]",
        ])
      }
    },
  },
  {
    name: "think",
    aliases: [],
    category: "system",
    usage: "/think [等级]",
    description: "查看或调整 Agent 思考等级",
    execute: (context, args) => {
      const control = context.agentThinking?.()
      if (control === undefined) return output("思考等级", ["思考等级不可用或未配置"])
      const target = args[0]
      if (target === undefined) {
        const current = control.current()
        return output("思考等级", [
          ...control.list().map((level) => `${level}${level === current ? "（当前）" : ""}`),
          "调整：/think <等级>（default 跟随模型默认）",
        ])
      }
      try {
        const level = control.select(target)
        return output("思考等级", [`已调整 → ${level}`])
      } catch (error) {
        return output("命令错误", [
          error instanceof Error ? error.message : "调整失败",
          "用法 /think [等级]",
        ])
      }
    },
  },
]
