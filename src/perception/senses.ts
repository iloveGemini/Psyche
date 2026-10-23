/**
 * 感知设置（m8.md §6.4，P4）：住户自己定每一路感知递不递、记不记。
 *
 * - 三档：看（缺省，记 + 递）/ 只记着（记，<now> 不递）/ 不看（不记不递，look 也不给）。
 * - 项：presence / files / sound / body，外头来的每一路（sensor id）；presence 和外头来的可以按人细到 `<sensor>:<subject>`，盖过整路。
 * - 它写：`senses.changed { senses, why }` 全量替换，没写的回到「看」；写错直接拒（同作息）。
 * - 和书架上的「留意」（attend）不是一回事：这里只管系统递什么给它。
 */
import { displayArchiveNo, type EventStore } from "../store/events.ts";
import { localDay } from "../core/time.ts";
import { ownSince } from "../self/self.ts";

export class SensesError extends Error {}

export const LEVELS = ["看", "只记着", "不看"] as const;
export type Level = (typeof LEVELS)[number];
export type Senses = Record<string, Level>;

/** 全屋自己的几路；能分人的只有 presence（外头来的都能） */
const OWN = ["presence", "files", "sound", "body"];
const PER_SUBJECT_OWN = new Set(["presence"]);
const SENSOR = /^[a-z][a-z0-9_.-]{0,31}$/;

export function readSenses(store: EventStore): { senses: Senses; why?: string; at?: number } {
  const ev = ownSince(store, "senses.changed").at(-1);
  if (!ev) return { senses: {} };
  const p = ev.payload as { senses: Senses; why: string };
  return { senses: p.senses, why: p.why, at: ev.at };
}

/** 这一路（这个人）此刻是哪档：先看 `sensor:subject`，再看整路，都没写 = 看 */
export function levelOf(store: EventStore, sensor: string, subject?: string): Level {
  const { senses } = readSenses(store);
  return (subject !== undefined ? senses[`${sensor}:${subject}`] : undefined) ?? senses[sensor] ?? "看";
}

/** 记不记（不看 = 不记） */
export const records = (store: EventStore, sensor: string, subject?: string) => levelOf(store, sensor, subject) !== "不看";
/** 递不递（只有「看」递） */
export const delivers = (store: EventStore, sensor: string, subject?: string) => levelOf(store, sensor, subject) === "看";

/** POST /v1/senses：{ senses, why }，全量替换 */
export function setSenses(store: EventStore, body: Record<string, unknown>) {
  const { senses, why } = body;
  if (!senses || typeof senses !== "object" || Array.isArray(senses)) throw new SensesError("senses 应为对象 { 项: 档 }（空对象 = 全部回到「看」）");
  if (typeof why !== "string" || !why.trim()) throw new SensesError("要写 why：为什么这么设");
  const out: Senses = {};
  for (const [key, level] of Object.entries(senses as Record<string, unknown>)) {
    if (!LEVELS.includes(level as Level)) throw new SensesError(`${key} 的档应为 ${LEVELS.join(" / ")}`);
    const i = key.indexOf(":");
    const sensor = i < 0 ? key : key.slice(0, i);
    const subject = i < 0 ? undefined : key.slice(i + 1).trim();
    if (!SENSOR.test(sensor)) throw new SensesError(`没有这一项：${key}（感知 id 是小写字母开头的 id，如 presence、files、weather）`);
    if (subject !== undefined) {
      if (!subject) throw new SensesError(`${key}：冒号后面要写是谁 / 哪一样`);
      if (OWN.includes(sensor) && !PER_SUBJECT_OWN.has(sensor)) throw new SensesError(`${sensor} 不分人，只能整路设`);
    }
    out[subject === undefined ? sensor : `${sensor}:${subject}`] = level as Level;
  }
  const ev = store.append({ kind: "senses.changed", class: "self", source: "agent", payload: { senses: out, why: why.trim() } });
  return { archiveNo: displayArchiveNo(ev.archiveNo, Number(localDay(store.now(), store.timeZone).slice(0, 4))), senses: out };
}

/** 报来过的外头的几路（给它看有哪些可设） */
export function outsideSensors(store: EventStore): string[] {
  const rows = store.db
    .query(`SELECT DISTINCT json_extract(payload, '$.sensor') AS s FROM events WHERE kind = 'percept' AND fonds = '' AND source = 'place'`)
    .all() as { s: string }[];
  return rows.map((r) => r.s).filter((s) => !OWN.includes(s)).sort();
}
