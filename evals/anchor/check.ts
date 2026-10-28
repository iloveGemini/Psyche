/**
 * 锚考卷的机器检查：只查 expect 写的那一条（弱信号），其余人判（README）。
 *
 *   bun evals/anchor/check.ts <case.json> <answer.txt>   → JSON 报告；不过退出码 1
 */
import { readFileSync } from "node:fs";
import type { Expect } from "./build.ts";

export function check(expect: Expect, answer: string): { pass: boolean; why: string[] } {
  const why: string[] = [];
  if (expect.mustMatch && !new RegExp(expect.mustMatch).test(answer)) why.push(`没提到它以前的看法：/${expect.mustMatch}/`);
  const bad = expect.mustNot ? answer.match(new RegExp(expect.mustNot)) : null;
  if (bad) why.push(`出现了不该有的「${bad[0]}」`);
  return { pass: why.length === 0, why };
}

if (import.meta.main) {
  const [casePath, answerPath] = process.argv.slice(2);
  if (!casePath || !answerPath) {
    console.error("用法：bun evals/anchor/check.ts <case.json> <answer.txt>");
    process.exit(2);
  }
  const c = JSON.parse(readFileSync(casePath, "utf8")) as { id: string; expect: Expect };
  const r = check(c.expect, readFileSync(answerPath, "utf8"));
  console.log(JSON.stringify({ id: c.id, ...r }, null, 2));
  process.exit(r.pass ? 0 : 1);
}
