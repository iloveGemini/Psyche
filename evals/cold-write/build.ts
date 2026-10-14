/**
 * 冷写考卷：把剧本（script.json）入临时库，到某次入睡为止。
 *
 *   bun evals/cold-write/build.ts --until s1 [--db evals/cold-write/out/exam.db] [--fresh]
 *   bun evals/cold-write/build.ts --until s2     # 在同一个库上接着入 s1 之后的会话（冷写结果留着）
 *
 * 幂等：每行带幂等键，重跑不重复。不进 ~/.psyche/test：剧本里它的台词是我们写的，不是它的经历（key.md）。
 */
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { EventStore } from "../../src/store/events.ts";
import { intake } from "../../src/archive/intake.ts";

const HERE = dirname(new URL(import.meta.url).pathname);
const SOURCE = "soma";

type Line = [string, "her" | "me", string];
export interface Script {
  her: string;
  model: string;
  sessions: { id: string; day: string; date: string; lines: Line[] }[];
  /** at：入睡时刻（sleep 推的 slept 用） */
  sleeps: { id: string; after: string; at: string }[];
}

export const loadScript = (path = join(HERE, "script.json")): Script => JSON.parse(readFileSync(path, "utf8"));

/** 上海时间 "YYYY-MM-DD HH:MM" → epoch ms */
export const shanghai = (date: string, hm: string) => Date.parse(`${date}T${hm}:00+08:00`);

/** 一个会话的每行时间：时刻倒退 = 过了零点，日期 +1 */
export function lineTimes(date: string, lines: Line[]): number[] {
  let base = shanghai(date, "00:00");
  let prev = -1;
  return lines.map(([hm]) => {
    const [h, m] = hm.split(":").map(Number);
    const mins = h * 60 + m;
    if (mins < prev) base += 86_400_000;
    prev = mins;
    return base + mins * 60_000;
  });
}

/** 入到 `until` 那次入睡为止；返回入了哪些会话 */
export function build(store: EventStore, script: Script, until: string): string[] {
  const sleep = script.sleeps.find((s) => s.id === until);
  if (!sleep) throw new Error(`没有这次入睡：${until}`);
  const last = script.sessions.findIndex((s) => s.id === sleep.after);
  const done: string[] = [];
  for (const s of script.sessions.slice(0, last + 1)) {
    const times = lineTimes(s.date, s.lines);
    store.db.transaction(() => {
      store.append({
        kind: "situation",
        class: "situation",
        source: SOURCE,
        at: times[0],
        payload: { harness: "soma", model: script.model, session: s.id },
        idem: `cw:${s.id}:sit`,
      });
      s.lines.forEach(([, who, text], i) =>
        intake(store, {
          kind: who === "her" ? "message.in" : "message.out",
          source: SOURCE,
          at: times[i],
          payload: who === "her" ? { from: script.her, text, session: s.id } : { to: script.her, text, session: s.id },
          idem: `cw:${s.id}:${i}`,
        }),
      );
    })();
    done.push(s.id);
  }
  return done;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt = (k: string) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const until = opt("--until");
  if (!until) throw new Error("要 --until s1 | s2");
  const db = opt("--db") ?? join(HERE, "out", "psyche.db");
  mkdirSync(dirname(db), { recursive: true });
  if (args.includes("--fresh")) for (const suf of ["", "-wal", "-shm"]) rmSync(db + suf, { force: true });
  const script = loadScript();
  // 写入时间用真实时钟：冷写结果是之后真实写进去的，id（按写入排）要和它们同一条时间线
  const store = new EventStore(db);
  const sessions = build(store, script, until);
  const n = store.db.query(`SELECT COUNT(*) AS n FROM events WHERE kind IN ('message.in', 'message.out')`).get() as { n: number };
  console.log(JSON.stringify({ db, until, sessions, messages: n.n }));
  store.close();
}
