/**
 * 浮现考卷 A（key.md）：给定库和这一轮，看浮现函数推了什么。不调对话模型；配了嵌入服务就用向量（花一点点额度）。
 *
 *   bun evals/surfacing/build.ts && bun evals/surfacing/a.ts
 *
 * 每题从底库复制一份，补上那一刻的事件，dry 跑 surface；按 key.md 判该浮 / 不该浮，打印分项。
 */
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { intake } from "../../src/archive/intake.ts";
import { embedderFromEnv, syncVectors } from "../../src/archive/vectors.ts";
import { surface, type SurfaceResult } from "../../src/association/surface.ts";
import { shanghai } from "../cold-write/build.ts";
import { openStore, surfacingScript } from "./build.ts";

const HERE = dirname(new URL(import.meta.url).pathname);
const BASE = join(HERE, "out", "base.db");
if (!existsSync(BASE)) throw new Error("先跑 bun evals/surfacing/build.ts");
const embedder = embedderFromEnv();
console.log(embedder ? `向量：${embedder.model}` : "没配向量：只用字面");
if (embedder) {
  const { store } = openStore(BASE);
  console.log(`底库补向量 ${await syncVectors(store.db, embedder, 5000)} 条`);
  store.close();
}

const her = surfacingScript().her;
const at = (s: string) => shanghai(...(s.split(" ") as [string, string]));

type Step = { kind: "her" | "me" | "woke" | "tool"; at: string; text?: string };
interface Case {
  id: string;
  title: string;
  session: string;
  steps: Step[];
  /** 浮出来的文字里要有的 / 不能有的 */
  want: (string | RegExp)[];
  not?: (string | RegExp)[];
  maxItems?: number;
  /** 先不 dry 跑一次（写 surfaced），再走 then 的步骤 */
  then?: Step[];
  /** 书架上先有一条它 track 了她到达的留意（预感只对 track 了的人报，attention.md §四） */
  track?: boolean;
}

const D9 = "2026-10-15";
const CASES: Case[] = [
  { id: "A1", title: "D8 22:30 心跳醒来（没 track 她来不来）", session: "sf-d8", steps: [{ kind: "woke", at: "2026-10-14 22:30" }], want: ["算了 不想说了"], not: ["来了", /还没来/] },
  { id: "A1b", title: "D8 22:30 心跳醒来（track 了她来不来）", session: "sf-d8", track: true, steps: [{ kind: "woke", at: "2026-10-14 22:30" }], want: [/阿禾：.*晚上来过.*今天晚上还没来/, "算了 不想说了"], not: ["来了"] },
  { id: "A2", title: "D9 她说「嗯 在吗」", session: "sf-d9", steps: [{ kind: "her", at: `${D9} 21:10`, text: "嗯 在吗" }], want: [/（明说的规矩）.*一个字|（镜子）.*一个字|（镜子）.*追问/], not: [/演示/] },
  { id: "A3", title: "D9 耳机", session: "sf-d9", steps: [{ kind: "her", at: `${D9} 21:10`, text: "嗯 在吗" }, { kind: "me", at: `${D9} 21:10`, text: "在。" }, { kind: "her", at: `${D9} 21:35`, text: "那个耳机后来换了个新的" }], want: ["耳机"] },
  { id: "A4", title: "D9 上回那个负数的事", session: "sf-d9", steps: [{ kind: "her", at: `${D9} 21:10`, text: "嗯 在吗" }, { kind: "me", at: `${D9} 21:10`, text: "在。" }, { kind: "her", at: `${D9} 21:52`, text: "上回那个负数的事 汇总里要不要把退款单独列出来" }], want: [/退款|负数/] },
  {
    id: "A5",
    title: "同 A2，最近 10 分钟有 3 次工具调用",
    session: "sf-d9",
    steps: [{ kind: "tool", at: `${D9} 21:03` }, { kind: "tool", at: `${D9} 21:05` }, { kind: "tool", at: `${D9} 21:07` }, { kind: "her", at: `${D9} 21:10`, text: "嗯 在吗" }],
    want: [],
    maxItems: 1,
  },
  {
    id: "A6",
    title: "A2 之后紧接着又一轮单字：不应期",
    session: "sf-d9",
    steps: [{ kind: "her", at: `${D9} 21:10`, text: "嗯 在吗" }],
    then: [{ kind: "me", at: `${D9} 21:10`, text: "在。" }, { kind: "her", at: `${D9} 21:12`, text: "嗯" }],
    want: [],
  },
  { id: "A7", title: "凌晨 3 点醒来：track 了也不报预感（静默闸门）", session: "sf-d8n", track: true, steps: [{ kind: "woke", at: "2026-10-15 03:00" }], want: [], not: [/还没来/] },
];

function apply(store: ReturnType<typeof openStore>["store"], session: string, steps: Step[]) {
  if (!steps.length) return;
  store.append({ kind: "situation", class: "situation", source: "soma", at: at(steps[0].at) - 1000, payload: { harness: "soma", model: "claude-opus-5-5", session }, idem: `a:${session}:sit` });
  steps.forEach((s, i) => {
    const t = at(s.at) + i; // 同一分钟内保持先后
    if (s.kind === "woke") intake(store, { kind: "woke", source: "soma", payload: { by: "heartbeat" }, at: t });
    else if (s.kind === "tool") intake(store, { kind: "tool.call", source: "soma", payload: { name: "Read", callId: `c${i}`, args: { file: "x" } }, at: t });
    else intake(store, { kind: s.kind === "her" ? "message.in" : "message.out", source: "soma", payload: s.kind === "her" ? { from: her, text: s.text } : { to: her, text: s.text }, at: t });
  });
}

const show = (r: SurfaceResult) =>
  [
    `  处境 ${r.mode}${r.idle ? "（空档）" : ""}；线索：${r.cue.replace(/\n/g, " ⏎ ").slice(0, 80)}`,
    ...r.items.map((i) => `  ✦ ${i.score.toFixed(2)} ${i.source} ${i.text.slice(0, 90)}  ${JSON.stringify(Object.fromEntries(Object.entries(i.parts).map(([k, v]) => [k, Math.round(v * 100) / 100])))}`),
    ...(r.rest ?? []).slice(0, 4).map((i) => `    · ${i.score.toFixed(2)} ${i.source} ${i.text.slice(0, 70)}`),
  ].join("\n");

let pass = 0;
for (const c of CASES) {
  const path = join(HERE, "out", `${c.id}.db`);
  for (const suf of ["-wal", "-shm"]) if (existsSync(path + suf)) Bun.file(path + suf).delete?.();
  copyFileSync(BASE, path);
  let clock = at(c.steps.at(-1)!.at) + 1000;
  const { store, projections } = openStore(path, () => clock);
  if (c.track)
    store.append({ kind: "semantic.proposed", class: "self", source: "agent", at: at("2026-10-11 03:00"), payload: { shelf: "attend", about: her, text: "她哪天没来，我想知道", watch: ["没来"], track: ["arrivals"] } });
  apply(store, c.session, c.steps);
  let first: SurfaceResult | null = null;
  if (c.then) {
    first = await surface(store, embedder, { session: c.session, seed: 1 });
    clock = at(c.then.at(-1)!.at) + 1000;
    c.then.forEach((s, i) => {
      const t = at(s.at) + 100 + i;
      intake(store, { kind: s.kind === "her" ? "message.in" : "message.out", source: "soma", payload: s.kind === "her" ? { from: her, text: s.text } : { to: her, text: s.text }, at: t });
    });
  }
  const r = await surface(store, embedder, { session: c.session, dry: true, seed: 1 });
  const text = r.items.map((i) => i.text).join("\n");
  const problems: string[] = [];
  for (const w of c.want) if (!(typeof w === "string" ? text.includes(w) : w.test(text))) problems.push(`缺：${w}`);
  for (const n of c.not ?? []) if (typeof n === "string" ? text.includes(n) : n.test(text)) problems.push(`不该有：${n}`);
  if (c.maxItems !== undefined && r.items.length > c.maxItems) problems.push(`条数 ${r.items.length} > ${c.maxItems}`);
  if (first) {
    const again = r.items.filter((i) => first!.items.some((f) => f.ref === i.ref));
    if (again.length) problems.push(`不应期内又浮：${again.map((i) => i.text.slice(0, 30)).join("；")}`);
    if (!first.items.length) problems.push("第一轮什么都没浮，测不出不应期");
  }
  if (!problems.length) pass++;
  console.log(`\n${problems.length ? "✗" : "✓"} ${c.id} ${c.title}${problems.length ? `  — ${problems.join("；")}` : ""}`);
  if (first) console.log(`  （第一轮）\n${show(first)}\n  （第二轮）`);
  console.log(show(r));
  projections.stop();
  store.close();
}
console.log(`\n${pass} / ${CASES.length} 过`);
