/**
 * 本体和工具的边界（lib-vs-harness.md「加功能放哪」第 4 步、notes/plan/mcp-manifest.md §〇）：
 * Psyche 的进程不跑工具——src/ 不 import 仓库根下 mcp/ 里的任何东西。
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

const root = resolve(import.meta.dir, "..");
const tools = join(root, "mcp") + sep;

test("src/ 不 import mcp/ 下的服务", () => {
  const hits: string[] = [];
  for (const rel of new Bun.Glob("src/**/*.{ts,tsx,js,mjs}").scanSync(root)) {
    const file = join(root, rel);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g)) {
      const spec = m[1];
      if (spec.startsWith(".") && (resolve(dirname(file), spec) + sep).startsWith(tools)) hits.push(`${rel} → ${spec}`);
    }
  }
  expect(hits).toEqual([]);
});
