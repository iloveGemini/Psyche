/**
 * 还开着的事：线索卷的最小一版（notes/plan/m7.md）。
 *
 * - 开卷、记碎片、合卷都是它写的（self 事件），口子上校验，写错直接拒。系统不改、不合、不催、不判兑现没有。
 * - 现行状态读时现算；出生前的卷不带过去（同作息）。
 * - noted / closed 的 payload 里系统顺手抄上卷名：经历模板是纯函数，看不到开卷那条。
 */
import type { EventStore, PsycheEvent } from "../store/events.ts";
import { displayArchiveNo } from "../store/events.ts";
import { localDay } from "../core/time.ts";
import { ownSince } from "./self.ts";

export class ThreadError extends Error {}

export type ThreadType = "promise" | "matter";
export type CloseHow = "done" | "dropped" | "moot";
export const CLOSE_HOW: Record<CloseHow, string> = { done: "做到了", dropped: "不做了", moot: "不用做了" };

export interface Thread {
  id: string;
  archiveNo: string;
  type: ThreadType;
  title: string;
  to?: string;
  openedAt: number;
  lastAt: number;
  notes: { at: number; text: string }[];
  closed?: { at: number; how: CloseHow; why: string };
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const year = (store: EventStore) => Number(localDay(store.now(), store.timeZone).slice(0, 4));

/** 全部卷（含合上的），按开卷时间从旧到新 */
export function readThreads(store: EventStore): Thread[] {
  const y = year(store);
  const byId = new Map<string, Thread>();
  for (const ev of ownSince(store, "thread.opened")) {
    const p = ev.payload as { type: ThreadType; title: string; to?: string };
    byId.set(ev.id, { id: ev.id, archiveNo: displayArchiveNo(ev.archiveNo, y), type: p.type, title: p.title, ...(p.to ? { to: p.to } : {}), openedAt: ev.at, lastAt: ev.at, notes: [] });
  }
  const later = [...ownSince(store, "thread.noted"), ...ownSince(store, "thread.closed")].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  for (const ev of later) {
    const p = ev.payload as { target: string; text?: string; how?: CloseHow; why?: string };
    const t = byId.get(p.target);
    if (!t) continue;
    if (ev.kind === "thread.noted") {
      t.notes.push({ at: ev.at, text: p.text! });
      t.lastAt = ev.at;
    } else t.closed = { at: ev.at, how: p.how!, why: p.why! };
  }
  return [...byId.values()];
}

export const openThreads = (store: EventStore) => readThreads(store).filter((t) => !t.closed);

/** 证据只认自己全宗的经历和情节（同自述的闸） */
function resolveCites(store: EventStore, cites: unknown) {
  if (cites === undefined) return [];
  if (!Array.isArray(cites)) throw new ThreadError("cites 应为档号数组");
  const out = new Map<string, PsycheEvent>();
  for (const c of cites) {
    const ev = typeof c === "string" ? store.byArchiveNo(c.trim().replace(/^\[|\]$/g, "")) : null;
    if (!ev) throw new ThreadError(`引的 ${String(c)} 查不到`);
    // 自己写出去的信也算（10-16 a1：回 Joy 的那封被拒，"我自己写、自己发的却不算我的经历"）
    if (ev.fonds || !(ev.class === "experience" || ev.kind === "episode" || ev.kind === "mail.out")) throw new ThreadError(`引的 ${c} 不是你的经历、情节或你写的信，不能当证据`);
    out.set(ev.id, ev);
  }
  return [...out.values()].map((e) => ({ to: e.id, rel: "evidence" }));
}

/** 指认一卷：收开卷那条的档号；合上的不能再动 */
function resolveOpen(store: EventStore, target: unknown): Thread {
  if (!nonEmpty(target)) throw new ThreadError("缺 target（开卷那条的档号）");
  const ev = store.byArchiveNo(target.trim().replace(/^\[|\]$/g, ""));
  if (!ev || ev.kind !== "thread.opened") throw new ThreadError(`${target} 不是一卷开着的事（要开卷那条的档号，用 threads 看）`);
  const t = readThreads(store).find((x) => x.id === ev.id);
  if (!t) throw new ThreadError(`${target} 是出生前开的卷，不算你的`);
  if (t.closed) throw new ThreadError(`「${t.title}」已经合上了；接着这件事要开新卷，在 note 里提 ${t.archiveNo}`);
  return t;
}

/** POST /v1/threads：{ type, title, to?, note?, cites? } */
export function openThread(store: EventStore, body: Record<string, unknown>) {
  const { type, title, to, note, cites } = body;
  if (type !== "promise" && type !== "matter") throw new ThreadError("type 应为 promise（答应过谁什么）或 matter（挂着、等后续的事）");
  if (!nonEmpty(title)) throw new ThreadError("title 是空的");
  if (to !== undefined && typeof to !== "string") throw new ThreadError("to 应为字符串");
  if (type === "promise" && !nonEmpty(to)) throw new ThreadError("promise 要写 to（答应的是谁）");
  if (note !== undefined && typeof note !== "string") throw new ThreadError("note 应为字符串");
  const links = resolveCites(store, cites);
  const ev = store.append({
    kind: "thread.opened",
    class: "self",
    source: "agent",
    payload: { type, title: title.trim(), ...(nonEmpty(to) ? { to: to.trim() } : {}), ...(nonEmpty(note) ? { note: note.trim() } : {}) },
    links,
  });
  return { archiveNo: displayArchiveNo(ev.archiveNo, year(store)) };
}

/** POST /v1/threads/note：{ target, text, cites? } */
export function noteThread(store: EventStore, body: Record<string, unknown>) {
  const t = resolveOpen(store, body.target);
  if (!nonEmpty(body.text)) throw new ThreadError("text 是空的");
  const ev = store.append({ kind: "thread.noted", class: "self", source: "agent", payload: { target: t.id, title: t.title, text: body.text.trim() }, links: resolveCites(store, body.cites) });
  return { archiveNo: displayArchiveNo(ev.archiveNo, year(store)) };
}

/** POST /v1/threads/close：{ target, how, why, cites? } */
export function closeThread(store: EventStore, body: Record<string, unknown>) {
  const t = resolveOpen(store, body.target);
  if (!(typeof body.how === "string" && body.how in CLOSE_HOW)) throw new ThreadError("how 应为 done（做到了）/ dropped（不做了）/ moot（不用做了）");
  if (!nonEmpty(body.why)) throw new ThreadError("要写 why");
  const ev = store.append({ kind: "thread.closed", class: "self", source: "agent", payload: { target: t.id, title: t.title, how: body.how, why: body.why.trim() }, links: resolveCites(store, body.cites) });
  return { archiveNo: displayArchiveNo(ev.archiveNo, year(store)) };
}

const ago = (ms: number) => {
  const h = Math.floor(ms / 3600_000);
  if (h < 1) return "不到 1 小时";
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
};

/** `<now>` 的一行：开着几件、答应的几件、最久没动的一件；没有开着的就没这一行 */
export function threadsLine(store: EventStore): string | null {
  const open = openThreads(store);
  if (!open.length) return null;
  const promises = open.filter((t) => t.type === "promise");
  const stale = [...open].sort((a, b) => a.lastAt - b.lastAt)[0];
  return `还开着的事：${open.length} 件${promises.length ? `（答应别人的 ${promises.length} 件）` : ""}；最久没动：「${stale.title}」，${ago(store.now() - stale.lastAt)}`;
}

/** 种子里的一段：全部开着的，从旧到新，带最近一笔 */
export function renderOpenThreads(store: EventStore): string | null {
  const open = openThreads(store);
  if (!open.length) return null;
  const d = (at: number) => localDay(at, store.timeZone).slice(5);
  return [
    "【还开着的事】",
    ...open.map((t) => {
      const last = t.notes.at(-1);
      return `[${t.archiveNo}] ${t.type === "promise" ? `答应 ${t.to}：` : ""}${t.title}（${d(t.openedAt)} 起${last ? `；最近 ${d(last.at)}：${last.text}` : ""}）`;
    }),
  ].join("\n");
}
