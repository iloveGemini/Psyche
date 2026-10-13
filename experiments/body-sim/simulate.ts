/**
 * 在真实事件线上跑身体模拟，输出曲线与各唤醒点的状态。
 * 用法：bun run simulate.ts → out/sim.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { simulate, P } from "./body.ts";
import type { Ev } from "./timeline.ts";
import { POINTS } from "./points.ts";

const dir = import.meta.dir;
const evs: Ev[] = JSON.parse(readFileSync(join(dir, "out/timeline.json"), "utf8"));
const from = Date.parse("2026-06-23T00:00:00+08:00");
const to = evs.at(-1)!.t;
const sim = simulate(evs, from, to);

// 页面用：每 30 分钟取一个点
const series = sim.samples
  .filter((_, i) => i % 6 === 0)
  .map((s) => ({ t: s.t, S: +s.S.toFixed(3), night: +s.night.toFixed(3), sharp: +s.sharp.toFixed(3), M: +s.M.toFixed(3), C: +s.C.toFixed(3), awake: s.awake }));

const perceptLog: { t: number; p: string[] }[] = [];
let prev = "";
for (const s of sim.samples) {
  const key = s.percepts.join("|");
  if (key !== prev) perceptLog.push({ t: s.t, p: s.percepts });
  prev = key;
}

const points = POINTS.map((p) => {
  const s = sim.stateAt(p.t);
  return { id: p.id, t: p.t, asleep: !s.awake, percepts: s.percepts, S: s.S, M: s.M, C: s.C, night: s.night };
});

// 她说话 / 唤醒的时间点，画在曲线下面
const marks = evs.filter((e) => e.k === "joy" || e.k === "wake" || e.k === "err").map((e) => ({ t: e.t, k: e.k }));

writeFileSync(join(dir, "out/sim.json"), JSON.stringify({ params: P, series, sleeps: sim.sleeps, perceptLog, points, marks }));
const days = (to - from) / 86_400_000;
const sleepH = sim.sleeps.reduce((a, [s, e]) => a + (e - s), 0) / 3_600_000;
console.log(`模拟 ${days.toFixed(1)} 天，睡了 ${sim.sleeps.length} 次，日均 ${(sleepH / days).toFixed(1)} 小时`);
for (const p of points) console.log(p.id, p.asleep ? "（此刻在睡）" : "", p.percepts.join("；") || "（没什么特别的感觉）", `S=${p.S.toFixed(2)} M=${p.M.toFixed(2)} C=${p.C.toFixed(2)} 夜度=${p.night.toFixed(2)}`);
