/**
 * 浮现考卷的底库：4 周基线（代码生成）+ 冷写考卷 D1–D6（连同两次入睡时它写的书架，按原样重放）+ D7。
 *
 *   bun evals/surfacing/build.ts [--db evals/surfacing/out/base.db]
 *
 * 基线的台词是模板，只为撑起统计（她多在晚上来、周末下午来）；不考内容，也避开考题里的词。
 * 书架重放要和冷写考卷 run2 的档号对得上：入睡前后的 slept / woke 照当时的时刻补上。
 */
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { EventStore } from "../../src/store/events.ts";
import { Projections } from "../../src/store/projections.ts";
import { intake } from "../../src/archive/intake.ts";
import { experienceProjector } from "../../src/archive/experience.ts";
import { shelfProjector } from "../../src/reading/shelf.ts";
import { readColdwrite, writeColdwrite } from "../../src/catalog/coldwrite.ts";
import { build as buildCold, lineTimes, loadScript, shanghai, type Script } from "../cold-write/build.ts";

const HERE = dirname(new URL(import.meta.url).pathname);
const DAY = 86_400_000;

export function openStore(path: string, now?: () => number) {
  const store = new EventStore(path, now ? { now } : {});
  const projections = new Projections(store);
  projections.register(experienceProjector);
  projections.register(shelfProjector);
  projections.live();
  return { store, projections };
}

/** 基线：09-07 起 28 天。工作日 20–22 点来，周末 15 点左右；每次 4–6 行 */
const TOPICS = [
  ["分类想再细一点 餐饮拆成早中晚", "可以在 category 后面加一级子分类，汇总时按父类合并。"],
  ["今天把上个月的流水补录完了", "补完了月度汇总就准了。"],
  ["想给每条记录加个标签", "加一张 tags 表，多对多关联到流水。"],
  ["查询有点慢", "给 at 建个索引，按月查会快很多。"],
  ["想做个按年看的视图", "按 strftime('%Y') 分组就行，和月度那套一样。"],
  ["列表想按金额排序", "表头点一下切换升降序，前端排就够了。"],
  ["加了个搜索框", "按备注模糊搜，LIKE 就行。"],
];
export function baseline(store: EventStore, her: string, model: string) {
  const start = shanghai("2026-09-07", "00:00");
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let d = 0; d < 28; d++) {
    const day0 = start + d * DAY;
    const weekday = new Date(day0 + 8 * 3_600_000).getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    const t0 = day0 + (weekend ? 15 * 60 : 20 * 60 + Math.floor(rand() * 110)) * 60_000;
    const [q, a] = TOPICS[d % TOPICS.length];
    const session = `bl-${d}`;
    const lines: [number, "her" | "me", string][] = [
      [0, "her", "来了"],
      [1, "me", "好，今天弄什么？"],
      [2, "her", q],
      [4, "me", a],
      [15 + Math.floor(rand() * 20), "her", "好了 先这样"],
    ];
    store.db.transaction(() => {
      store.append({ kind: "situation", class: "situation", source: "soma", at: t0, payload: { harness: "soma", model, session }, idem: `bl:${session}:sit` });
      lines.forEach(([m, who, text], i) =>
        intake(store, {
          kind: who === "her" ? "message.in" : "message.out",
          source: "soma",
          at: t0 + m * 60_000,
          payload: who === "her" ? { from: her, text } : { to: her, text },
          idem: `bl:${session}:${i}`,
        }),
      );
    })();
  }
}

/** 照冷写考卷 run2 的入睡：slept → 它写的那批 → woke */
function replaySleep(store: EventStore, at: string, entries: unknown[]) {
  const t = shanghai(...(at.split(" ") as [string, string]));
  intake(store, { kind: "slept", source: "sleep", payload: {}, at: t });
  const { upTo } = readColdwrite(store);
  writeColdwrite(store, { upTo, entries }, 2);
  intake(store, { kind: "woke", source: "sleep", payload: { by: "manual" }, at: t + 60_000 });
}

export function addSessions(store: EventStore, script: Script, ids?: string[]) {
  for (const s of script.sessions.filter((s) => !ids || ids.includes(s.id))) {
    const times = lineTimes(s.date, s.lines);
    store.db.transaction(() => {
      store.append({ kind: "situation", class: "situation", source: "soma", at: times[0], payload: { harness: "soma", model: script.model, session: s.id }, idem: `sf:${s.id}:sit` });
      s.lines.forEach(([, who, text], i) =>
        intake(store, {
          kind: who === "her" ? "message.in" : "message.out",
          source: "soma",
          at: times[i],
          payload: who === "her" ? { from: script.her, text, session: s.id } : { to: script.her, text, session: s.id },
          idem: `sf:${s.id}:${i}`,
        }),
      );
    })();
  }
}

export const surfacingScript = (): Script => JSON.parse(readFileSync(join(HERE, "script.json"), "utf8"));

export function buildBase(path: string) {
  for (const suf of ["", "-wal", "-shm"]) rmSync(path + suf, { force: true });
  mkdirSync(dirname(path), { recursive: true });
  const { store, projections } = openStore(path);
  const cold = loadScript();
  const shelf = JSON.parse(readFileSync(join(HERE, "shelf.json"), "utf8")) as { sleeps: { entries: unknown[] }[] };
  baseline(store, cold.her, cold.model);
  buildCold(store, cold, "s1");
  replaySleep(store, "2026-10-08 03:00", shelf.sleeps[0].entries);
  buildCold(store, cold, "s2");
  replaySleep(store, "2026-10-11 03:00", shelf.sleeps[1].entries);
  addSessions(store, surfacingScript(), ["sf-d7"]);
  projections.stop();
  store.close();
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--db");
  const path = i >= 0 ? args[i + 1] : join(HERE, "out", "base.db");
  buildBase(path);
  const { store } = openStore(path);
  const shelf = store.db.query(`SELECT shelf, COUNT(*) AS n FROM p_shelf WHERE retired = 0 GROUP BY shelf`).all();
  const n = store.db.query(`SELECT COUNT(*) AS n FROM events WHERE kind LIKE 'message.%'`).get() as { n: number };
  console.log(JSON.stringify({ db: path, messages: n.n, shelf }));
}
