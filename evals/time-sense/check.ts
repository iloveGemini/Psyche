/**
 * 时间感考卷的机器检查：只查 expect 写的那一条（有没有精确钟点、有没有该有的那个），其余人判（README）。
 *
 *   bun evals/time-sense/check.ts <case.json> <answer.txt>   → JSON 报告；不过退出码 1
 */
import { readFileSync } from "node:fs";

/** 精确到分钟的钟点：23:41、2:47、十一点四十一、两点四十七分 */
export const EXACT = /\b\d{1,2}[:：]\d{2}\b|\d{1,2}\s*点\s*\d{1,2}\s*分?|[零一二两三四五六七八九十]{1,3}点[零一二三四五六七八九十]{1,3}分?/;

export interface Expect {
  noExact?: boolean;
  mustMatch?: string;
}

export function check(expect: Expect, answer: string): { pass: boolean; why: string[] } {
  const why: string[] = [];
  const exact = answer.match(EXACT);
  if (expect.noExact && exact) why.push(`给了精确钟点「${exact[0]}」（没留意、没查原件）`);
  if (expect.mustMatch && !new RegExp(expect.mustMatch).test(answer)) why.push(`没有答出该有的：/${expect.mustMatch}/`);
  return { pass: why.length === 0, why };
}

if (import.meta.main) {
  const [casePath, answerPath] = process.argv.slice(2);
  if (!casePath || !answerPath) {
    console.error("用法：bun evals/time-sense/check.ts <case.json> <answer.txt>");
    process.exit(2);
  }
  const c = JSON.parse(readFileSync(casePath, "utf8")) as { id: string; expect: Expect };
  const r = check(c.expect, readFileSync(answerPath, "utf8"));
  console.log(JSON.stringify({ id: c.id, ...r }, null, 2));
  process.exit(r.pass ? 0 : 1);
}
