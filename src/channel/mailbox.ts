/**
 * 通道的口子（notes/plan/m6.md §一 §五）：来信、写信、翻开、来往的信、在哪、通道设置。
 *
 * - 来信（POST /v1/mail/in）：通道交进来，`mail.in` 不挂处境（信不在哪段对话里）。外部消息 id 做幂等。
 * - 写信（POST /v1/mail/out）：给登记过的人、屋里别的住户（m6.md §八），或给自己（交接信）。系统补记写信处 from: { harness, session }。
 *   回她的信挂 replyTo 不算额度；主动写给人的每封算 1 次，和它约的醒同一份额度，用完拒。
 * - 翻开（POST /v1/mail/open）：给全文，没读过的记 `mail.read`（它的动作，m6.md §〇.2）。
 * - 通道设置是 Joy 的：发给谁经哪些通道、外部地址。改一次记 `param.changed`；地址不进事件。
 */
import type { EventStore, PsycheEvent } from "../store/events.ts";
import { displayArchiveNo } from "../store/events.ts";
import { localDay } from "../core/time.ts";
import { ownSince } from "../self/self.ts";
import { getSettings } from "../heartbeat/schedule.ts";
import { budgetToday } from "../heartbeat/scheduler.ts";
import { AWAKE_MS, lastActive, NOT_PLACES, placeOf, undelivered } from "./inbox.ts";

export class MailError extends Error {}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const year = (store: EventStore) => Number(localDay(store.now(), store.timeZone).slice(0, 4));
const show = (store: EventStore, ev: PsycheEvent) => displayArchiveNo(ev.archiveNo, year(store));

// ── 通道设置（Joy 的） ──

export const CHANNELS = ["soma-note", "email"] as const;
export interface Channels {
  /** 发给谁经哪些通道；键就是登记过的人 */
  channels: Record<string, string[]>;
  /** 外部地址：{ Joy: { email: "…" } } */
  addresses: Record<string, Record<string, string>>;
}
const DEFAULT_CHANNELS: Channels = { channels: { Joy: ["soma-note"] }, addresses: {} };

export function getChannels(store: EventStore): Channels {
  const r = store.db
    .query(`SELECT detail FROM system_log WHERE kind = 'param.changed' AND json_extract(detail, '$.name') = 'channels' ORDER BY id DESC LIMIT 1`)
    .get() as { detail: string } | null;
  return r ? (JSON.parse(r.detail).value as Channels) : structuredClone(DEFAULT_CHANNELS);
}

export function setChannels(store: EventStore, patch: Record<string, unknown>, by = "user"): Channels {
  const old = getChannels(store);
  const next: Channels = structuredClone(old);
  for (const [k, v] of Object.entries(patch)) {
    if (k === "channels") {
      if (!v || typeof v !== "object" || Array.isArray(v)) throw new MailError("channels 应为 { 人: [通道…] }");
      for (const [who, list] of Object.entries(v)) {
        if (!Array.isArray(list) || !list.every((c) => (CHANNELS as readonly string[]).includes(c))) throw new MailError(`${who} 的通道只认：${CHANNELS.join(" / ")}`);
      }
      next.channels = v as Record<string, string[]>;
    } else if (k === "addresses") {
      if (!v || typeof v !== "object" || Array.isArray(v)) throw new MailError("addresses 应为 { 人: { 通道: 地址 } }");
      for (const [who, a] of Object.entries(v)) {
        if (!a || typeof a !== "object" || !Object.values(a).every(nonEmpty)) throw new MailError(`${who} 的地址应为 { email: "…" }`);
      }
      next.addresses = v as Record<string, Record<string, string>>;
    } else throw new MailError(`没有这项通道设置：${k}`);
  }
  store.syslog("param.changed", { name: "channels", by, old, value: next });
  return next;
}

// ── 来信 ──

export function receiveMail(store: EventStore, body: Record<string, unknown>): { id: string; archiveNo: string } {
  const { from, text, via, subject, urgent, ext } = body;
  if (!nonEmpty(from)) throw new MailError("from 是空的");
  if (!nonEmpty(text)) throw new MailError("text 是空的");
  if (!nonEmpty(via)) throw new MailError("via 是空的（经哪个通道来的）");
  if (subject !== undefined && typeof subject !== "string") throw new MailError("subject 应为字符串");
  if (urgent !== undefined && typeof urgent !== "boolean") throw new MailError("urgent 应为 true / false");
  if (ext !== undefined && !nonEmpty(ext)) throw new MailError("ext 应为非空字符串");
  const ev = store.append({
    kind: "mail.in",
    class: "experience",
    source: via,
    situation: null,
    idem: ext ? `${via}:${ext}` : undefined,
    payload: { from: from.trim(), text, via, ...(nonEmpty(subject) ? { subject: subject.trim() } : {}), ...(urgent ? { urgent: true } : {}), ...(ext ? { ext } : {}) },
  });
  return { id: ev.id, archiveNo: show(store, ev) };
}

// ── 写信 ──

/** 认识的地方：处境里出现过的（睡着、以前的家不算地方；家就是 Soma，10-16） */
function knownPlaces(store: EventStore): Set<string> {
  const rows = store.db.query(`SELECT DISTINCT json_extract(payload, '$.harness') AS h FROM events WHERE class = 'situation' AND fonds = ''`).all() as { h: string | null }[];
  return new Set(rows.map((r) => r.h).filter((h): h is string => !!h && !NOT_PLACES.includes(h)));
}

function resolve(store: EventStore, ref: unknown): PsycheEvent | null {
  if (!nonEmpty(ref)) return null;
  const r = ref.trim().replace(/^\[|\]$/g, "");
  return store.get(r) ?? store.byArchiveNo(r);
}

/**
 * housemates：屋里别的住户的 id（不含自己）。写给他们不用登记通道，每封都算额度——回信也算：
 * 两个住户互相回信、互相叫醒，不算就停不下来（m6.md §八）。
 */
export function sendMail(
  store: EventStore,
  body: Record<string, unknown>,
  housemates: string[] = [],
): { ev: PsycheEvent; id: string; archiveNo: string; budget: { used: number; of: number } } {
  const { to, text, subject, replyTo, for: dest } = body;
  if (!nonEmpty(text)) throw new MailError("text 是空的");
  if (!nonEmpty(to)) throw new MailError("to 是空的：写给谁（Joy、屋里的住户），或 self（交接信）");
  const who = to.trim();
  const people = Object.keys(getChannels(store).channels);
  const housemate = housemates.includes(who);
  if (who !== "self" && !people.includes(who) && !housemate)
    throw new MailError(`没登记 ${who}：现在能写给 ${[...people, ...housemates].join("、")}，或 self（交接信）`);
  if (subject !== undefined && typeof subject !== "string") throw new MailError("subject 应为字符串");
  if (dest !== undefined) {
    if (who !== "self") throw new MailError("for 只给交接信用（to: self）");
    if (!nonEmpty(dest) || !knownPlaces(store).has(dest.trim())) throw new MailError(`不认识这个地方：${String(dest)}（认识：${[...knownPlaces(store)].join("、")}）`);
  }
  let reply: PsycheEvent | null = null;
  if (replyTo !== undefined) {
    if (who === "self") throw new MailError("交接信不回信，不挂 replyTo");
    reply = resolve(store, replyTo);
    if (!reply || reply.kind !== "mail.in" || (reply.payload as { from: string }).from !== who) throw new MailError(`replyTo 要指向 ${who} 发来的一封信（档号）`);
  }
  const settings = getSettings(store);
  if (who !== "self" && (!reply || housemate)) {
    const b = budgetToday(store);
    if (b.used >= settings.wakeBudget) throw new MailError(`今天额度 ${b.used}/${settings.wakeBudget} 用完了（醒 ${b.woke} · 写信 ${b.mail}），明天 0 点重置；${housemate ? "写给住户每封都算" : "回她的信（挂 replyTo）不算额度"}`);
  }
  const here = placeOf(store);
  const ev = store.append({
    kind: "mail.out",
    class: "self",
    source: "agent",
    payload: {
      to: who,
      text,
      ...(nonEmpty(subject) ? { subject: subject.trim() } : {}),
      ...(reply ? { replyTo: reply.id } : {}),
      ...(nonEmpty(dest) ? { for: dest.trim() } : {}),
      // 写给住户：回信也算额度（budgetToday 认这个）
      ...(housemate ? { house: true } : {}),
      from: { harness: here?.harness ?? null, session: here?.session ?? null },
    },
  });
  return { ev, id: ev.id, archiveNo: show(store, ev), budget: { used: budgetToday(store).used, of: settings.wakeBudget } };
}

// ── 来往的信 ──

export interface MailView {
  id: string;
  archiveNo: string;
  at: number;
  dir: "in" | "out" | "handoff";
  from?: string;
  to?: string;
  via?: string;
  subject?: string;
  urgent?: boolean;
  for?: string;
  replyTo?: string;
  read?: boolean;
  chars: number;
  /** 来信 / 交接信翻开了才有；它写给人的信一直有 */
  text?: string;
  /** 写给人的：送没送出去（failed 带原因） */
  delivery?: { via: string; ok: boolean; error?: string }[];
}

const readRefs = (store: EventStore) => new Set(ownSince(store, "mail.read").flatMap((e) => (e.payload as { refs: string[] }).refs));

function view(store: EventStore, ev: PsycheEvent, read: Set<string>, open = false): MailView {
  const p = ev.payload as Record<string, any>;
  const base = { id: ev.id, archiveNo: show(store, ev), at: ev.at, chars: Array.from(p.text as string).length, ...(p.subject ? { subject: p.subject } : {}) };
  if (ev.kind === "mail.in") {
    const r = read.has(ev.id) || open;
    return { ...base, dir: "in", from: p.from, via: p.via, ...(p.urgent ? { urgent: true } : {}), read: r, ...(r ? { text: p.text } : {}) };
  }
  if (p.to === "self") {
    const r = read.has(ev.id) || open;
    return { ...base, dir: "handoff", ...(p.for ? { for: p.for } : {}), read: r, ...(r ? { text: p.text } : {}) };
  }
  const sent = store.readSyslog({ kind: "mail.sent", limit: 100_000 }).map((l) => l.detail as { ref: string; via: string; ok: boolean; error?: string });
  const last = new Map<string, { via: string; ok: boolean; error?: string }>();
  for (const d of sent.reverse()) if (d.ref === ev.id) last.set(d.via, { via: d.via, ok: d.ok, ...(d.error ? { error: d.error } : {}) });
  const replyTo = p.replyTo ? store.get(p.replyTo) : null;
  return { ...base, dir: "out", to: p.to, text: p.text, ...(replyTo ? { replyTo: show(store, replyTo) } : {}), delivery: [...last.values()] };
}

/**
 * 来往的信。full = 写信那一边看（Soma 留言页）：来信给全文——那是她自己写的；不记已读，已读只看他翻没翻。
 * 他看（MCP mail）不带 full：没翻开的只给谁、几时、多少字。
 */
export function listMail(store: EventStore, days = 7, full = false): { mails: MailView[]; unread: number } {
  const since = store.now() - days * 86_400_000;
  const read = readRefs(store);
  const evs = [...ownSince(store, "mail.in"), ...ownSince(store, "mail.out")].filter((e) => e.at >= since).sort((a, b) => b.at - a.at);
  const mails = evs.map((e) => {
    const v = view(store, e, read);
    return full && v.dir === "in" ? { ...v, text: (e.payload as { text: string }).text } : v;
  });
  return { mails, unread: mails.filter((m) => m.read === false).length };
}

/** 翻开：给全文；没读过的记一条 mail.read */
export function openMail(store: EventStore, refs: unknown): { mails: MailView[] } {
  if (!Array.isArray(refs) || !refs.length) throw new MailError("refs 应为档号数组（要翻开哪几封）");
  const read = readRefs(store);
  const evs = refs.map((r) => {
    const ev = resolve(store, r);
    if (!ev || !(ev.kind === "mail.in" || (ev.kind === "mail.out" && (ev.payload as { to: string }).to === "self"))) throw new MailError(`${String(r)} 不是来信或交接信`);
    return ev;
  });
  const fresh = [...new Map(evs.filter((e) => !read.has(e.id)).map((e) => [e.id, e])).values()];
  if (fresh.length)
    store.append({
      kind: "mail.read",
      class: "self",
      source: "agent",
      payload: { refs: fresh.map((e) => e.id), seen: fresh.map((e) => (e.kind === "mail.in" ? `${(e.payload as { from: string }).from} 的信` : "交接信")) },
    });
  return { mails: evs.map((e) => view(store, e, read, true)) };
}

// ── 在哪 ──

export function where(store: EventStore) {
  const here = placeOf(store);
  const last = lastActive(store);
  const since = here?.session
    ? (store.db.query(`SELECT MIN(at) AS at FROM events WHERE class = 'situation' AND fonds = '' AND json_extract(payload, '$.session') = ?`).get(here.session) as { at: number | null }).at
    : null;
  return {
    harness: here?.harness ?? null,
    session: here?.session ?? null,
    since,
    awake: !!last && store.now() - last.at < AWAKE_MS,
  };
}

export { undelivered };
