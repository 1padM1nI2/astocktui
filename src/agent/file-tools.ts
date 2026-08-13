import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { AgentTool } from "@oh-my-pi/pi-agent-core"
import { z } from "@oh-my-pi/pi-ai"
import { jsonToolResult } from "./tool-result"

declare global {
  // oh-my-pi 宿主可注入会话工具；独立终端缺失时回退到本地文件 API
  // eslint-disable-next-line no-var
  var tool:
    | {
        read(input: { path: string }): Promise<unknown>
        edit(input: {
          path: string
          edits: readonly { old_text: string; new_text: string }[]
        }): Promise<unknown>
      }
    | undefined
}

async function readLocalFile(path: string, selector: string | undefined): Promise<string> {
  const content = await readFile(path, "utf8")
  if (selector === undefined) return content
  const match = /^(\d+)(?:-(\d+))?$/u.exec(selector)
  if (match === null) throw new Error("行范围必须是 N 或 N-M")
  const start = Number(match[1])
  const end = Number(match[2] ?? match[1])
  if (start < 1 || end < start) throw new Error("行范围无效")
  return content
    .split(/\r?\n/u)
    .slice(start - 1, end)
    .join("\n")
}

async function editLocalFile(
  path: string,
  oldText: string,
  newText: string,
): Promise<{ ok: true }> {
  const content = await readFile(path, "utf8")
  if (!content.includes(oldText)) throw new Error("文件中未找到待替换文本")
  await writeFile(path, content.replace(oldText, newText), "utf8")
  return { ok: true }
}

interface DirectoryEntry {
  readonly name: string
  readonly type: "file" | "directory" | "other"
  readonly size: number | null
}

async function listDirectory(path: string): Promise<readonly DirectoryEntry[]> {
  const dirents = await readdir(path, { withFileTypes: true })
  const entries = await Promise.all(
    dirents.map(async (dirent): Promise<DirectoryEntry> => {
      const type = dirent.isDirectory() ? "directory" : dirent.isFile() ? "file" : "other"
      const size = type === "file" ? (await stat(join(path, dirent.name))).size : null
      return { name: dirent.name, type, size }
    }),
  )
  return entries.sort((left, right) => left.name.localeCompare(right.name))
}

export function createFileAgentTools(): readonly AgentTool[] {
  return [
    {
      name: "read",
      label: "读取文件或目录",
      description:
        "读取本地文本文件内容，可附带行范围选择器，例如 :1-80；路径为目录时列出其中的条目。",
      parameters: z.object({ path: z.string().min(1), selector: z.string().optional() }),
      intent: "omit",
      approval: "read",
      execute: async (_id, params) => {
        const input = params as { path: string; selector?: string }
        const target = await stat(input.path).catch(() => null)
        if (target?.isDirectory()) {
          return jsonToolResult({
            type: "directory",
            path: input.path,
            entries: await listDirectory(input.path),
          })
        }
        if (globalThis.tool !== undefined) {
          const targetPath =
            input.selector === undefined ? input.path : `${input.path}:${input.selector}`
          return jsonToolResult(await globalThis.tool.read({ path: targetPath }))
        }
        return jsonToolResult(await readLocalFile(input.path, input.selector))
      },
    },
    {
      name: "write",
      label: "写入文件",
      description: "将内容写入本地文件，自动创建缺失的父目录；文件已存在时整体覆盖。",
      parameters: z.object({ path: z.string().min(1), content: z.string() }),
      intent: "omit",
      approval: "write",
      execute: async (_id, params) => {
        const input = params as { path: string; content: string }
        await mkdir(dirname(input.path), { recursive: true })
        await writeFile(input.path, input.content, "utf8")
        return jsonToolResult({
          ok: true,
          path: input.path,
          bytes: Buffer.byteLength(input.content),
        })
      },
    },
    {
      name: "edit",
      label: "编辑文件",
      description: "对本地文本文件做精确文本替换，先使用 read 查看上下文后再调用。",
      parameters: z.object({
        path: z.string().min(1),
        old_text: z.string().min(1),
        new_text: z.string(),
      }),
      intent: "omit",
      approval: "write",
      execute: async (_id, params) => {
        const input = params as { path: string; old_text: string; new_text: string }
        if (globalThis.tool !== undefined) {
          return jsonToolResult(
            await globalThis.tool.edit({
              path: input.path,
              edits: [{ old_text: input.old_text, new_text: input.new_text }],
            }),
          )
        }
        return jsonToolResult(await editLocalFile(input.path, input.old_text, input.new_text))
      },
    },
    {
      name: "list",
      label: "列出目录内容",
      description: "列出本地目录中的文件和子目录，包含名称、类型和文件大小。",
      parameters: z.object({ path: z.string().min(1) }),
      intent: "omit",
      approval: "read",
      execute: async (_id, params) => {
        const input = params as { path: string }
        return jsonToolResult({ path: input.path, entries: await listDirectory(input.path) })
      },
    },
    {
      name: "move",
      label: "移动或重命名",
      description: "移动或重命名本地文件、目录，自动创建目标缺失的父目录。",
      parameters: z.object({ from: z.string().min(1), to: z.string().min(1) }),
      intent: "omit",
      approval: "write",
      execute: async (_id, params) => {
        const input = params as { from: string; to: string }
        await mkdir(dirname(input.to), { recursive: true })
        await rename(input.from, input.to)
        return jsonToolResult({ ok: true, from: input.from, to: input.to })
      },
    },
    {
      name: "mkdir",
      label: "创建目录",
      description: "递归创建本地目录，目录已存在时不报错。",
      parameters: z.object({ path: z.string().min(1) }),
      intent: "omit",
      approval: "write",
      execute: async (_id, params) => {
        const input = params as { path: string }
        await mkdir(input.path, { recursive: true })
        return jsonToolResult({ ok: true, path: input.path })
      },
    },
    {
      name: "delete",
      label: "删除文件或目录",
      description: "永久删除本地文件；删除目录必须显式设置 recursive 为 true。",
      parameters: z.object({ path: z.string().min(1), recursive: z.boolean().optional() }),
      intent: "omit",
      approval: { tier: "exec", reason: "将永久删除本地文件或目录，不可恢复", override: true },
      execute: async (_id, params) => {
        const input = params as { path: string; recursive?: boolean }
        const target = await stat(input.path)
        if (target.isDirectory() && input.recursive !== true) {
          throw new Error("删除目录必须设置 recursive 为 true")
        }
        await rm(input.path, { recursive: input.recursive === true })
        return jsonToolResult({ ok: true, path: input.path })
      },
    },
  ]
}
