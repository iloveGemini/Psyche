/**
 * 收件箱（notes/plan/m6.md §二–§四）：未读、交接信去哪、勿扰、递消息——都按事件现算，不另存状态。
 *
 * - 未读 = `mail.in` 和"该送到这里的交接信"里，没有 `mail.read` 指向的。翻开（mail.read）是它的动作。
 * - 递的是**消息**不是信：下一次取 `<now>` 在「刚发生」报一次（谁、几时），记系统日志 `mail.noticed`；
 *   之后每轮在状态行现算未读，直到它翻开。报过了就不再因这封叫醒。来信叫醒 = 往 Soma 推一轮，那一轮的 `<now>` 报它。
 * - 交接信不送回写它的地方（同一个 harness 换会话也不送）；写明 for 只送那里、且不是写信那个会话；不过期；不叫醒。
 * - 勿扰：条件只认系统看得见的事实（时段、醒着、在哪、在做事）；挡住的信不叫醒、醒着时也不报，攒着。
 *
 * 这里不 import 调度器：调度器从这里取来信的候选，发信口子从调度器取额度。
 */
import type { EventStore, PsycheEvent } from "../store/events.ts";
import { wallClock } from "../core/time.ts";
import { ownSince } from "../self/self.ts";
import { VIA } from "../archive/render.ts";
import { DEFAULT_WAKE_ON, readSchedule, type DndRule } from "../heartbeat/schedule.ts";

export type { DndRule };

export const AWAKE_MS = 30 * 60_000;
/**
 * 不算"在哪"的处境：睡着时的整理 / 补写（sleep，10-16 起），和以前的家（home，10-15 的事件里还有）。
 * 它们不是醒着待的地方，不算醒着、不算动静、不补写。
 */
export const NOT_PLACES = ["home", "sleep"];
export const NOT_PLACE_SQL = `COALESCE(json_extract(s.payload, '$.harness'), '') NOT IN (${NOT_PLACES.map((h) => `'${h}'`).join(", ")})`;
/** 在做事：最近 15 分钟有记忆工具以外的工具调用 */
export const BUSY_MS = 15 * 60_000;

// ── 勿扰（纯函数） ──

export interface Facts {
  /** 本地时刻 HH:MM */
  hhmm: string;
  awake: boolean;
  /** 醒在哪（没醒着为 null） */
  in: string | null;
  busy: boolean;
}

const inWindow = (t: string, from: string, to: string) => (from === to ? true : from < to ? t >= from && t < to : t >= from || t < to);

function matches(rule: DndRule, f: Facts): boolean {
  const w = rule.when;
  if (w.time && !inWindow(f.hhmm, w.time.from, w.time.to)) return false;
  if (w.awake !== undefined && f.awake !== w.awake) return false;
  if (w.in !== undefined && !(f.awake && f.in === w.in)) return false;
  if (w.busy !== undefined && f.busy !== w.busy) return false;
  return true;
}

/** 这封信此刻被勿扰挡住了吗：有规则成立、且没命中那条规则的例外 */
export function held(rules: DndRule[], f: Facts, mail: { from: string; urgent?: boolean }): boolean {
  return rules.some((r) => matches(r, f) && !(r.except ?? []).some((e) => e.from === mail.from && (!e.urgent || mail.urgent === true)));
}

// ── 事实 ──

export interface Place {
  harness: string;
  session: string | null;
}

/** 会话所在的地方；没给会话就是当前处境 */
export function placeOf(store: EventStore, session?: string | null): Place | null {
  // 没给会话：最近一个算地方的处境（睡着时的整理和它同时跑，全局"当前处境"可能是它）
  const row = session
    ? (store.db
        .query(`SELECT payload FROM events WHERE class = 'situation' AND fonds = '' AND json_extract(payload, '$.session') = ? ORDER BY id DESC LIMIT 1`)
        .get(session) as { payload: string } | null)
    : (store.db
        .query(`SELECT s.payload FROM events s WHERE s.class = 'situation' AND s.fonds = '' AND ${NOT_PLACE_SQL} ORDER BY s.at DESC, s.id DESC LIMIT 1`)
        .get() as { payload: string } | null);
  const p = (row ? JSON.parse(row.payload) : null) as { harness?: string; session?: string } | null;
  return p?.harness ? { harness: p.harness, session: p.session ?? session ?? null } : null;
}

/**
 * 最近一次醒着的动静（对话、工具）和在哪；at 给了就只看那一刻及以前。睡着时整理的不算。
 * "醒着"只有这一个口径：调度器、勿扰、`/v1/where` 都从这里算。
 */
export function lastActive(store: EventStore, at?: number): { at: number; harness: string | null } | null {
  const r = store.db
    .query(
      `SELECT e.at, json_extract(s.payload, '$.harness') AS harness FROM events e LEFT JOIN events s ON s.id = e.situation
       WHERE e.kind IN ('message.in', 'message.out', 'speech.silent', 'tool.call', 'tool.result') AND e.fonds = ''
         AND ${NOT_PLACE_SQL} AND e.at <= ? ORDER BY e.at DESC LIMIT 1`,
    )
    .get(at ?? Number.MAX_SAFE_INTEGER) as { at: number; harness: string | null } | null;
  return r;
}

/** 此刻的事实。here = 正在取 <now> 的地方（取 <now> 就是醒在那里） */
export function factsNow(store: EventStore, here?: Place | null): Facts {
  const now = store.now();
  const w = wallClock(now, store.timeZone);
  const last = lastActive(store);
  const awake = !!here || (!!last && now - last.at < AWAKE_MS);
  const busy = !!store.db
    .query(`SELECT 1 FROM events WHERE kind = 'tool.call' AND fonds = '' AND at > ? AND at <= ? AND json_extract(payload, '$.name') NOT LIKE 'mcp__psyche__%' LIMIT 1`)
    .get(now - BUSY_MS, now);
  return { hhmm: `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`, awake, in: here?.harness ?? (awake ? (last?.harness ?? null) : null), busy };
}

// ── 未读 ──

export interface MailIn {
  ev: PsycheEvent;
  from: string;
  urgent: boolean;
}

const readRefs = (store: EventStore) => new Set(ownSince(store, "mail.read").flatMap((e) => (e.payload as { refs: string[] }).refs));
const noticedRefs = (store: EventStore) =>
  new Set(store.readSyslog({ kind: "mail.noticed", limit: 100_000 }).flatMap((l) => (l.detail as { refs: string[] }).refs));

export function unreadMail(store: EventStore): MailIn[] {
  const read = readRefs(store);
  return ownSince(store, "mail.in")
    .filter((e) => !read.has(e.id))
    .map((ev) => {
      const p = ev.payload as { from: string; urgent?: boolean };
      return { ev, from: p.from, urgent: p.urgent === true };
    });
}

/** 交接信该不该在这里出现（不看读没读） */
export function handoffFor(letter: PsycheEvent, here: Place): boolean {
  const p = letter.payload as { to: string; for?: string; from?: { harness?: string; session?: string } };
  if (p.to !== "self") return false;
  if (p.for) return here.harness === p.for && (here.session === null || here.session !== p.from?.session);
  return here.harness !== p.from?.harness;
}

export function unreadHandoffs(store: EventStore, here: Place | null): PsycheEvent[] {
  if (!here) return [];
  const read = readRefs(store);
  return ownSince(store, "mail.out").filter((e) => !read.has(e.id) && handoffFor(e, here));
}

// ── 递：取 <now> 时 ──

export interface Notice {
  ev: PsycheEvent;
  kind: "mail" | "handoff";
}

/** 这次取 <now> 要报的：没报过、没被勿扰挡住的来信 + 该到这里、没报过的交接信。记 mail.noticed */
export function noticeMail(store: EventStore, here: Place | null, f: Facts): Notice[] {
  const noticed = noticedRefs(store);
  const rules = currentDnd(store);
  const out: Notice[] = [
    ...unreadMail(store)
      .filter((m) => !noticed.has(m.ev.id) && !held(rules, f, m))
      .map((m) => ({ ev: m.ev, kind: "mail" as const })),
    ...unreadHandoffs(store, here)
      .filter((e) => !noticed.has(e.id))
      .map((ev) => ({ ev, kind: "handoff" as const })),
  ].sort((a, b) => a.ev.at - b.ev.at);
  if (out.length) store.syslog("mail.noticed", { refs: out.map((n) => n.ev.id), session: here?.session ?? null });
  return out;
}

const currentDnd = (store: EventStore) => readSchedule(store)?.schedule.dnd ?? [];
export const wakeOnMail = (store: EventStore) => (readSchedule(store)?.schedule.wakeOn ?? DEFAULT_WAKE_ON).mail;

const pad = (n: number) => String(n).padStart(2, "0");
function when(store: EventStore, at: number): string {
  const w = wallClock(at, store.timeZone);
  const t = wallClock(store.now(), store.timeZone);
  const hm = `${pad(w.hour)}:${pad(w.minute)}`;
  return w.year === t.year && w.month === t.month && w.day === t.day ? hm : `${pad(w.month)}-${pad(w.day)} ${hm}`;
}
const stamp = (store: EventStore, at: number) => {
  const w = wallClock(at, store.timeZone);
  return `${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)}`;
};

/** 「刚发生」里的一行：只说有信，不带正文 */
export function renderNotice(store: EventStore, n: Notice): string {
  if (n.kind === "handoff") {
    const p = n.ev.payload as { from?: { harness?: string } };
    return `- 交接信（${stamp(store, n.ev.at)} 在 ${p.from?.harness ?? "?"} 写的）`;
  }
  const p = n.ev.payload as { from: string; via: string; urgent?: boolean };
  return `- 来信（${p.from} · ${VIA[p.via] ?? p.via} · ${when(store, n.ev.at)}${p.urgent ? " · 急" : ""}）`;
}

/** 状态行：每轮现算，不成立就消失。just = 这次已在「刚发生」报过的（这一轮不再重复） */
export function mailStateLines(store: EventStore, here: Place | null, f: Facts, just: Notice[] = []): { lines: string[]; held: number } {
  const skip = new Set(just.map((n) => n.ev.id));
  const rules = currentDnd(store);
  const unread = unreadMail(store);
  const blocked = unread.filter((m) => held(rules, f, m));
  const open = unread.filter((m) => !held(rules, f, m) && !skip.has(m.ev.id));
  const handoffs = unreadHandoffs(store, here).filter((e) => !skip.has(e.id));
  const parts: string[] = [];
  if (open.length) parts.push(`${open.length} 封没看（${[...new Set(open.map((m) => m.from))].join("、")}，最早 ${when(store, open[0].ev.at)}）`);
  if (handoffs.length) parts.push(`交接信 ${handoffs.length} 封没看`);
  const lines = parts.length ? [`收件箱：${parts.join("；")}`] : [];
  const failed = undelivered(store);
  if (failed.length) lines.push(`没送出去的信：${failed.length} 封（${VIA[failed.at(-1)!.via] ?? failed.at(-1)!.via}：${failed.at(-1)!.error ?? "出错"}）`);
  return { lines, held: blocked.length };
}

/** 写给人的信里，最近一次投递失败的（同一封后来送成了就不算） */
export function undelivered(store: EventStore): { ref: string; via: string; error?: string }[] {
  const last = new Map<string, { ref: string; via: string; ok: boolean; error?: string }>();
  for (const l of store.readSyslog({ kind: "mail.sent", limit: 100_000 }).reverse()) {
    const d = l.detail as { ref: string; via: string; ok: boolean; error?: string };
    last.set(`${d.ref}:${d.via}`, d);
  }
  return [...last.values()].filter((d) => !d.ok);
}

// ── 叫醒：来信的候选（调度器用） ──

export interface MailCandidate {
  by: "mail";
  key: string;
  /** 被挡住：勿扰 / 它关了来信叫醒（记一次账，换个 key） */
  hold?: "dnd" | "off";
  mail: string;
}

/** 没报过、没读的来信：挡住的换 key 记一次，出了勿扰再叫 */
export function mailCandidates(store: EventStore, f: Facts): MailCandidate[] {
  const noticed = noticedRefs(store);
  const rules = currentDnd(store);
  const on = wakeOnMail(store);
  return unreadMail(store)
    .filter((m) => !noticed.has(m.ev.id))
    .map((m): MailCandidate => {
      if (held(rules, f, m)) return { by: "mail", key: `mail:${m.ev.id}:dnd`, hold: "dnd", mail: m.ev.id };
      if (!on) return { by: "mail", key: `mail:${m.ev.id}:off`, hold: "off", mail: m.ev.id };
      return { by: "mail", key: `mail:${m.ev.id}`, mail: m.ev.id };
    });
}
