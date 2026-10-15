/**
 * 作息、设置、日记（notes/plan/m5.md §一 §四 §八）。
 *
 * - 作息是它写的：`schedule.changed` 全量替换，带 why；口子上校验，写错直接拒。
 *   闹钟响过（有了对应的 `due`）就不在现行作息里，事件不改。出生前的作息不带过去。
 * - 设置是 Joy 的（每个 Agent 一份）：暂停、唤醒额度、心跳开关。改一次记一条系统日志 `param.changed`；它看得到、改不了。
 * - 日记：全文进资料库，事件里只放哈希。
 * - 来信能不能叫醒、勿扰（m6.md §三）也是作息的一部分：它自己写；缺省来信能叫醒、没有勿扰。
 */
import type { EventStore, PsycheEvent } from "../store/events.ts";
import { displayArchiveNo } from "../store/events.ts";
import { localDay, parseTime } from "../core/time.ts";
import { ownSince } from "../self/self.ts";

export class ScheduleError extends Error {}

export interface Alarm {
  id: string;
  at: number;
  note: string;
}
export interface Daily {
  at: string;
  note?: string;
}
/** 勿扰（m6.md §三）：一条规则里的条件都满足才算；例外按来信的 from（+ 急） */
export interface DndRule {
  when: { time?: { from: string; to: string }; awake?: boolean; in?: string; busy?: boolean };
  except?: { from: string; urgent?: boolean }[];
}
export interface Schedule {
  heartbeat: { everyMin: number } | null;
  daily: Daily[];
  alarms: Alarm[];
  wakeOn: { mail: boolean };
  dnd: DndRule[];
}
export const DEFAULT_WAKE_ON = { mail: true };
export interface Settings {
  paused: boolean;
  wakeBudget: number;
  heartbeat: boolean;
}

export const DEFAULT_SETTINGS: Settings = { paused: false, wakeBudget: 3, heartbeat: false };
export const MIN_HEARTBEAT_MIN = 15;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const year = (store: EventStore) => Number(localDay(store.now(), store.timeZone).slice(0, 4));

// ── 设置 ──

export function getSettings(store: EventStore): Settings {
  const r = store.db
    .query(`SELECT detail FROM system_log WHERE kind = 'param.changed' AND json_extract(detail, '$.name') = 'settings' ORDER BY id DESC LIMIT 1`)
    .get() as { detail: string } | null;
  return r ? { ...DEFAULT_SETTINGS, ...(JSON.parse(r.detail).value as Partial<Settings>) } : { ...DEFAULT_SETTINGS };
}

export function setSettings(store: EventStore, patch: Record<string, unknown>, by = "user"): Settings {
  const old = getSettings(store);
  const next = { ...old };
  for (const [k, v] of Object.entries(patch)) {
    if (k === "paused" || k === "heartbeat") {
      if (typeof v !== "boolean") throw new ScheduleError(`${k} 应为 true / false`);
      next[k] = v;
    } else if (k === "wakeBudget") {
      if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 48) throw new ScheduleError("wakeBudget 应为 0–48 的整数");
      next.wakeBudget = v as number;
    } else throw new ScheduleError(`没有这项设置：${k}`);
  }
  store.syslog("param.changed", { name: "settings", by, old, value: next });
  return next;
}

// ── 响过的：due 事件的 key ──

export function firedKeys(store: EventStore): Set<string> {
  return new Set(ownSince(store, "due").map((e) => (e.payload as { key: string }).key));
}

export const alarmKey = (a: Alarm) => `alarm:${a.id}`;
export const dailyKey = (slot: string, day: string) => `daily:${slot}:${day}`;

// ── 作息 ──

export interface CurrentSchedule {
  schedule: Schedule;
  at: number;
  why: string;
  archiveNo: string;
}

/** 现行作息：最新一条 schedule.changed，去掉响过的闹钟；没写过 = null */
export function readSchedule(store: EventStore): CurrentSchedule | null {
  const ev = ownSince(store, "schedule.changed").at(-1);
  if (!ev) return null;
  // M6 之前写的作息没有 wakeOn / dnd：补缺省
  const p = ev.payload as { schedule: Omit<Schedule, "wakeOn" | "dnd"> & Partial<Pick<Schedule, "wakeOn" | "dnd">>; why: string };
  const fired = firedKeys(store);
  return {
    schedule: { wakeOn: DEFAULT_WAKE_ON, dnd: [], ...p.schedule, alarms: p.schedule.alarms.filter((a) => !fired.has(alarmKey(a))) },
    at: ev.at,
    why: p.why,
    archiveNo: displayArchiveNo(ev.archiveNo, year(store)),
  };
}

function parseSchedule(store: EventStore, raw: unknown): Schedule {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ScheduleError("schedule 应为对象 { heartbeat, daily, alarms, wakeOn, dnd }");
  const s = raw as Record<string, unknown>;
  for (const k of Object.keys(s)) if (!["heartbeat", "daily", "alarms", "wakeOn", "dnd"].includes(k)) throw new ScheduleError(`schedule 里没有 ${k} 这一项`);

  let heartbeat: Schedule["heartbeat"] = null;
  if (s.heartbeat !== undefined && s.heartbeat !== null) {
    const every = (s.heartbeat as { everyMin?: unknown }).everyMin;
    if (!Number.isInteger(every) || (every as number) < MIN_HEARTBEAT_MIN) throw new ScheduleError(`heartbeat.everyMin 应为 ≥ ${MIN_HEARTBEAT_MIN} 的整数（分钟）`);
    heartbeat = { everyMin: every as number };
  }

  const daily: Daily[] = [];
  if (s.daily !== undefined) {
    if (!Array.isArray(s.daily)) throw new ScheduleError("daily 应为数组");
    for (const d of s.daily) {
      const at = (d as { at?: unknown })?.at;
      const note = (d as { note?: unknown })?.note;
      if (typeof at !== "string" || !HHMM.test(at)) throw new ScheduleError(`daily 的时间「${String(at)}」看不懂：用 HH:MM（如 09:00）`);
      if (note !== undefined && typeof note !== "string") throw new ScheduleError("daily 的 note 应为字符串");
      if (daily.some((x) => x.at === at)) throw new ScheduleError(`daily 里 ${at} 写了两次`);
      daily.push({ at, ...(nonEmpty(note) ? { note: note.trim() } : {}) });
    }
  }

  const alarms: Alarm[] = [];
  if (s.alarms !== undefined) {
    if (!Array.isArray(s.alarms)) throw new ScheduleError("alarms 应为数组");
    const now = store.now();
    s.alarms.forEach((a, i) => {
      const { id, at, note } = (a ?? {}) as Record<string, unknown>;
      const ms = typeof at === "number" ? at : typeof at === "string" ? parseTime(at, store.timeZone) : null;
      if (ms === null || !Number.isFinite(ms)) throw new ScheduleError(`第 ${i + 1} 个闹钟的时间「${String(at)}」看不懂：用 2026-10-15T15:00（本地时间）`);
      if (ms <= now) throw new ScheduleError(`第 ${i + 1} 个闹钟（${String(at)}）已经过去了`);
      if (!nonEmpty(note)) throw new ScheduleError(`第 ${i + 1} 个闹钟缺 note（到时候告诉你的那句话）`);
      if (id !== undefined && !nonEmpty(id)) throw new ScheduleError(`第 ${i + 1} 个闹钟的 id 应为非空字符串`);
      const aid = nonEmpty(id) ? id.trim() : `a${ms.toString(36)}${i}`;
      if (alarms.some((x) => x.id === aid)) throw new ScheduleError(`闹钟 id ${aid} 重复`);
      alarms.push({ id: aid, at: ms, note: note.trim() });
    });
    alarms.sort((a, b) => a.at - b.at);
  }
  return { heartbeat, daily: daily.sort((a, b) => (a.at < b.at ? -1 : 1)), alarms, wakeOn: parseWakeOn(s.wakeOn), dnd: parseDnd(s.dnd) };
}

function parseWakeOn(raw: unknown): Schedule["wakeOn"] {
  if (raw === undefined || raw === null) return { ...DEFAULT_WAKE_ON };
  if (typeof raw !== "object" || Array.isArray(raw)) throw new ScheduleError("wakeOn 应为对象 { mail: true / false }");
  const out = { ...DEFAULT_WAKE_ON };
  for (const [k, v] of Object.entries(raw)) {
    if (k !== "mail") throw new ScheduleError(`wakeOn 里没有 ${k}：现在只有 mail（来信能不能叫醒你）`);
    if (typeof v !== "boolean") throw new ScheduleError("wakeOn.mail 应为 true / false");
    out.mail = v;
  }
  return out;
}

const WHEN_KEYS = ["time", "awake", "in", "busy"];
function parseDnd(raw: unknown): DndRule[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new ScheduleError("dnd 应为数组");
  return raw.map((r, i) => {
    const n = `第 ${i + 1} 条勿扰`;
    const when = (r as { when?: unknown })?.when;
    if (!when || typeof when !== "object" || Array.isArray(when)) throw new ScheduleError(`${n}缺 when（什么时候算勿扰）`);
    const w = when as Record<string, unknown>;
    const keys = Object.keys(w);
    if (!keys.length) throw new ScheduleError(`${n}的 when 是空的：至少写一个条件（${WHEN_KEYS.join(" / ")}）`);
    const out: DndRule["when"] = {};
    for (const k of keys) {
      const v = w[k];
      if (k === "time") {
        const { from, to } = (v ?? {}) as Record<string, unknown>;
        if (typeof from !== "string" || !HHMM.test(from) || typeof to !== "string" || !HHMM.test(to))
          throw new ScheduleError(`${n}的时段看不懂：用 { from: "23:00", to: "08:00" }（HH:MM，可跨零点）`);
        out.time = { from, to };
      } else if (k === "awake" || k === "busy") {
        if (typeof v !== "boolean") throw new ScheduleError(`${n}的 ${k} 应为 true / false`);
        out[k] = v;
      } else if (k === "in") {
        if (!nonEmpty(v)) throw new ScheduleError(`${n}的 in 应为地方名（如 soma）`);
        out.in = v.trim();
      } else throw new ScheduleError(`${n}的条件 ${k} 看不懂：只认 ${WHEN_KEYS.join(" / ")}`);
    }
    const ex = (r as { except?: unknown }).except;
    if (ex !== undefined && !Array.isArray(ex)) throw new ScheduleError(`${n}的 except 应为数组`);
    const except = ((ex ?? []) as unknown[]).map((e) => {
      const { from, urgent } = (e ?? {}) as Record<string, unknown>;
      if (!nonEmpty(from)) throw new ScheduleError(`${n}的例外要写 from（谁的信放行）`);
      if (urgent !== undefined && typeof urgent !== "boolean") throw new ScheduleError(`${n}的例外 urgent 应为 true / false`);
      return { from: from.trim(), ...(urgent ? { urgent: true } : {}) };
    });
    return { when: out, ...(except.length ? { except } : {}) };
  });
}

/** POST /v1/schedule：{ schedule, why } 全量替换 */
export function setSchedule(store: EventStore, body: Record<string, unknown>) {
  if (!nonEmpty(body.why)) throw new ScheduleError("要写 why（为什么这么排）");
  const schedule = parseSchedule(store, body.schedule);
  const ev = store.append({ kind: "schedule.changed", class: "self", source: "agent", payload: { schedule, why: body.why.trim() } });
  return { archiveNo: displayArchiveNo(ev.archiveNo, year(store)), schedule };
}

// ── 日记 ──

export function writeDiary(store: EventStore, body: Record<string, unknown>): { archiveNo: string } {
  if (!nonEmpty(body.text)) throw new ScheduleError("text 是空的");
  if (body.title !== undefined && typeof body.title !== "string") throw new ScheduleError("title 应为字符串");
  const title = nonEmpty(body.title) ? body.title.trim() : undefined;
  const hash = store.putMaterial(body.text, "text/markdown");
  const ev: PsycheEvent = store.append({ kind: "diary", class: "self", source: "agent", payload: { doc: { hash, mime: "text/markdown" }, ...(title ? { title } : {}) } });
  return { archiveNo: displayArchiveNo(ev.archiveNo, year(store)) };
}
