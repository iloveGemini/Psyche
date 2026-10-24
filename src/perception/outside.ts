/**
 * 外头来的事实（m8.md §6.3）：地方（Soma / Roxy）收进来的外界读数，存和递在这里。
 *
 * - 记：`POST /v1/house/percept`，每个收件人库里一条 `percept`（source = place）；同一样和上一条读数相同就不记。
 * - 递：<now>「这段时间感知到的」，本会话上次递到之后的，同一样压成一行；递一次记系统日志 percept.delivered（sensor = outside），不进经历（m8.md §五）。
 * - 全屋自己的几路（presence / files / body / sound）不从这里进，免得被冒充。
 * - Joy 那边的（joy.mac）要她给这个人开放了才记（设置 mac，m8.md §6.5）；没开放的报 ungranted。
 */
import type { EventStore, PsycheEvent } from "../store/events.ts";
import { clockOf } from "../core/time.ts";
import { delivers, records } from "./senses.ts";
import { lastDelivery, recordDelivery } from "./delivered.ts";
import { getSettings } from "../heartbeat/schedule.ts";

export class PerceptError extends Error {}

const OWN = new Set(["presence", "files", "body", "sound", "outside"]);
const SENSOR = /^[a-z][a-z0-9_.-]{0,31}$/;
const TEXT_MAX = 200;
const MAX_LINES = 10;

interface Outside {
  sensor: string;
  subject: string;
  value: unknown;
  text: string;
}

const outsideOf = (store: EventStore) =>
  store.list({ kinds: ["percept"], fonds: "", limit: 100_000 }).filter((e) => !OWN.has((e.payload as { sensor: string }).sensor));

/** Joy 那边的读数，她给这个人开放了没有：joy.mac 的 desk / app 看设置；别的不归她管 */
function granted(store: EventStore, sensor: string, subject: string): boolean {
  if (sensor !== "joy.mac") return true;
  const mac = getSettings(store).mac;
  return subject === "desk" || subject === "app" ? mac[subject] : false;
}

/** 记一条外头的读数进 to（缺省全屋）每个人的库；和那人库里这一样上一条相同的跳过 */
export function recordPercept(residents: { id: string; store: EventStore }[], body: Record<string, unknown>, now: number) {
  const { sensor, value, text, to, at } = body;
  if (typeof sensor !== "string" || !SENSOR.test(sensor)) throw new PerceptError("sensor 应为小写 id（字母开头，最多 32 位）");
  if (OWN.has(sensor)) throw new PerceptError(`${sensor} 是全屋自己的感知，不从这里报`);
  if (body.subject !== undefined && (typeof body.subject !== "string" || !body.subject.trim())) throw new PerceptError("subject 应为非空字符串");
  if (value === undefined) throw new PerceptError("缺 value");
  if (typeof text !== "string" || !text.trim()) throw new PerceptError("缺 text（一行事实）");
  if (Array.from(text.trim()).length > TEXT_MAX) throw new PerceptError(`text 最多 ${TEXT_MAX} 字`);
  if (at !== undefined && (typeof at !== "number" || !Number.isFinite(at))) throw new PerceptError("at 应为毫秒时间戳");
  if (to !== undefined && (!Array.isArray(to) || !to.length || to.some((x) => typeof x !== "string"))) throw new PerceptError("to 应为住户 id 数组");
  const targets = to ? (to as string[]).map((id) => residents.find((r) => r.id === id) ?? id) : residents;
  const missing = targets.filter((t): t is string => typeof t === "string");
  if (missing.length) throw new PerceptError(`全屋没有 ${missing.join("、")}`);

  const subject = typeof body.subject === "string" ? body.subject.trim() : sensor;
  const payload: Outside = { sensor, subject, value, text: text.trim() };
  const written: string[] = [];
  const unchanged: string[] = [];
  const muted: string[] = [];
  const ungranted: string[] = [];
  for (const r of targets as { id: string; store: EventStore }[]) {
    if (!granted(r.store, sensor, subject)) {
      ungranted.push(r.id);
      continue;
    }
    if (!records(r.store, sensor, subject)) {
      muted.push(r.id); // 他设了不看这一路（m8.md §6.4）
      continue;
    }
    const last = outsideOf(r.store)
      .filter((e) => {
        const p = e.payload as Outside;
        return p.sensor === sensor && p.subject === subject;
      })
      .at(-1);
    if (last && JSON.stringify((last.payload as Outside).value) === JSON.stringify(value)) {
      unchanged.push(r.id);
      continue;
    }
    r.store.append({ kind: "percept", class: "experience", source: "place", at: (at as number | undefined) ?? now, situation: null, payload: { ...payload } });
    written.push(r.id);
  }
  return { written, unchanged, ...(muted.length ? { muted } : {}), ...(ungranted.length ? { ungranted } : {}) };
}

/** <now> 的「这段时间感知到的」：本会话上次递到之后的，同一样压成一行（最后的样子 + 次数）；最多 10 行 */
export function deliverOutside(store: EventStore, session: string | undefined): string | null {
  const lastRow = lastDelivery(store, "outside", session);
  // 同全屋的东西（§6.2）：本会话递过就从那次算；新会话接最后递到的那次；从没递过只报最近 6 小时的
  const floor = lastRow ? 0 : store.now() - 6 * 3_600_000;
  const fresh = outsideOf(store).filter((e) => {
    const p = e.payload as Outside;
    return (lastRow ? e.id > lastRow.id : e.at >= floor) && e.at <= store.now() && delivers(store, p.sensor, p.subject);
  });
  if (!fresh.length) return null;
  const by = new Map<string, PsycheEvent[]>();
  for (const e of fresh) {
    const p = e.payload as Outside;
    const k = `${p.sensor}\u0000${p.subject}`;
    by.set(k, [...(by.get(k) ?? []), e]);
  }
  const lines = [...by.values()].slice(-MAX_LINES).map((evs) => {
    const e = evs.at(-1)!;
    return `- ${(e.payload as Outside).text}（${evs.length > 1 ? `这段时间变了 ${evs.length} 次，` : ""}${clockOf(e.at, store.now(), store.timeZone)}）`;
  });
  const more = by.size > MAX_LINES ? [`（还有 ${by.size - MAX_LINES} 样也变了）`] : [];
  const text = ["这段时间感知到的：", ...lines, ...more].join("\n");
  recordDelivery(store, "outside", session, { refs: fresh.map((e) => e.id), text });
  return text;
}
