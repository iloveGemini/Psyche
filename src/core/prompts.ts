/**
 * 提示词文件（prompts/*.md）：frontmatter 里写 `version: N`，正文给模型看。
 *
 * 读时现读，不缓存：改了提示词不用重启。文件不存在 = 空串、第 0 版。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const PROMPTS_DIR = join(import.meta.dir, "../../prompts");

export interface PromptDoc {
  text: string;
  version: number;
}

/** 拆 frontmatter：正文去掉 frontmatter，版本号取 `version:` */
export function parsePrompt(raw: string): PromptDoc {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { text: raw.trim(), version: 0 };
  const v = m[1].match(/^version:\s*(\d+)\s*$/m);
  return { text: raw.slice(m[0].length).trim(), version: v ? Number(v[1]) : 0 };
}

export function readPrompt(name: string, dir = PROMPTS_DIR): PromptDoc {
  const path = join(dir, name);
  return existsSync(path) ? parsePrompt(readFileSync(path, "utf8")) : { text: "", version: 0 };
}
