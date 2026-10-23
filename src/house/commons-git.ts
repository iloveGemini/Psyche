/**
 * commons 用 git（m8.md §6.2，10-17 Joy 定：谁改了什么就提交，留自己名字）。
 *
 * 全屋每圈（files.ts）看到 commons 变了，按「谁动的」分组各提交一次：作者是那个住户（取了名用名字，没取用 id），
 * 认不出的作者「没认出」。提交说明只写事实，不用谁的口吻。第一次见到没建库的 commons 先建库、把已有的提交一次。
 * git 出错不挡感知：返回错误，调用方记系统日志。
 */
import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const HOUSE = { name: "房子", email: "house@soma.house" };
export const UNKNOWN = { name: "没认出", email: "unknown@soma.house" };

function git(dir: string, args: string[], author = HOUSE): { ok: boolean; out: string } {
  const r = Bun.spawnSync(["git", "-C", dir, ...args], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: author.name,
      GIT_AUTHOR_EMAIL: author.email,
      GIT_COMMITTER_NAME: HOUSE.name,
      GIT_COMMITTER_EMAIL: HOUSE.email,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { ok: r.exitCode === 0, out: `${r.stdout.toString()}${r.stderr.toString()}`.trim() };
}

/** 没建库就建，把已有的以「房子」提交一次作起点。返回错误信息，没错 = undefined */
export function ensureRepo(dir: string): string | undefined {
  if (!existsSync(dir) || existsSync(join(dir, ".git"))) return undefined;
  const init = git(dir, ["init", "-q"]);
  if (!init.ok) return init.out;
  // 系统的杂物不进库；写在 .git 里，不往 commons 里添文件
  appendFileSync(join(dir, ".git", "info", "exclude"), "\n.DS_Store\nnode_modules/\n");
  git(dir, ["add", "-A"]);
  const c = git(dir, ["commit", "-q", "--allow-empty", "-m", "房子：建库时已有的"]);
  return c.ok ? undefined : c.out;
}

const CHANGE: Record<string, string> = { added: "放了", modified: "改了", removed: "删了" };

/**
 * 一圈里的变化，按谁动的分组提交。`by` 没认出 = undefined。返回出错的那几组。
 * 说明：`a1：改了 project/x/STATE.md；放了 share/a.png`（最多列 10 个，多了写「等 N 个」）。
 */
export function commitChanges(
  dir: string,
  changes: { path: string; change: string; by?: string }[],
  nameOf: (id: string) => string,
): string[] {
  const errors: string[] = [];
  const groups = new Map<string | undefined, { path: string; change: string }[]>();
  for (const c of changes) groups.set(c.by, [...(groups.get(c.by) ?? []), c]);
  for (const [by, list] of groups) {
    const author = by ? { name: nameOf(by), email: `${by}@soma.house` } : UNKNOWN;
    const add = git(dir, ["add", "-A", "--", ...list.map((c) => c.path)]);
    if (!add.ok) {
      errors.push(add.out);
      continue;
    }
    const shown = list.slice(0, 10).map((c) => `${CHANGE[c.change] ?? c.change} ${c.path}`);
    const msg = `${author.name}：${shown.join("；")}${list.length > 10 ? `；等 ${list.length} 个` : ""}`;
    const commit = git(dir, ["commit", "-q", "-m", msg, "--", ...list.map((c) => c.path)], author);
    // 内容其实没变（只动了修改时间）：git 说没东西可提交，不算错
    if (!commit.ok && !/nothing (added )?to commit|no changes added/.test(commit.out)) errors.push(commit.out);
  }
  return errors;
}
