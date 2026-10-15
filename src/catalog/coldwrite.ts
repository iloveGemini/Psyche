/**
 * 冷写（catalog.md §三，契约 m2.md）：它睡觉时，看跨会话的经历和书架，写回事实、明说的规矩、规律、镜子。
 *
 * 系统只做确定性的事：摆材料（游标之后的经历）、按它自己写的 watch 词机械地找候选证据、校验、数证据。
 * 归纳成什么由它写；没判的候选记进 coldwrite.done，积压可见，不让它自报。
 * 游标 = 最近一条 coldwrite.done 的 upTo，读时算，不另存表。
 */
import type { EventStore, PsycheEvent } from "../store/events.ts";
import { displayArchiveNo } from "../store/events.ts";
import { localDay } from "../core/time.ts";
import { sessionOf } from "../archive/experience.ts";
import { computeStats, pickTracked, TRACK_KEYS } from "../reading/stats.ts";
import { ENTRY_FIELDS, SHELVES, countedEvidence, readShelf, rootOf, trackedByPerson, type ShelfEntry } from "../reading/shelf.ts";
import { renderExperience } from "../archive/render.ts";

export class ColdwriteError extends Error {}

export interface MaterialLine {
  eventId: string;
  archiveNo: string;
  at: number;
  kind: string;
  text: string;
}

const refYear = (store: EventStore) => Number(localDay(store.now(), store.timeZone).slice(0, 4));
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
/** 冷写写的事件：不当材料、不当证据 */
const OWN = `kind LIKE 'semantic.%' OR kind = 'coldwrite.done'`;

export function coldCursor(store: EventStore): string {
  const r = store.db.query(`SELECT MAX(json_extract(payload, '$.upTo')) AS c FROM events WHERE kind = 'coldwrite.done' AND fonds = ''`).get() as { c: string | null };
  return r.c ?? "";
}

/** 当前最后一条可当材料的事件 */
function lastMaterialId(store: EventStore): string | null {
  const r = store.db.query(`SELECT MAX(id) AS id FROM events WHERE fonds = '' AND class <> 'situation' AND NOT (${OWN})`).get() as { id: string | null };
  return r.id;
}

/** (since, upTo] 内的可见经历（有情节的给情节，没写情节的给原话），按会话分组，组按首行时间、行按 at 排 */
/** 会话在哪个地方（处境的 harness） */
export function harnessOf(store: EventStore, session: string | null): string | null {
  if (!session) return null;
  const r = store.db
    .query(`SELECT json_extract(payload, '$.harness') AS h FROM events WHERE class = 'situation' AND json_extract(payload, '$.session') = ? ORDER BY id LIMIT 1`)
    .get(session) as { h: string | null } | null;
  return r?.h ?? null;
}

/**
 * 信（m6.md §六）：来信不挂会话，自成一组（session null）。没翻开的不进材料（它还不知道写了什么）；
 * 这段里翻开的，哪怕信是上次整理前到的，也补进来——不然翻开得晚的信永远进不了材料。
 */
export function materialLines(store: EventStore, since: string, upTo: string): { session: string | null; harness: string | null; lines: MaterialLine[] }[] {
  type Row = { event_id: string; archive_no: string; at: number; kind: string; text: string; session: string | null };
  const inRange = store.db
    .query(
      `SELECT event_id, archive_no, at, kind, text, session FROM p_experience
       WHERE covered = 0 AND class <> 'situation' AND event_id > ? AND event_id <= ? ORDER BY at, event_id`,
    )
    .all(since, upTo) as Row[];
  const readAll = new Set(
    (store.db.query(`SELECT payload FROM events WHERE kind = 'mail.read' AND fonds = '' AND id <= ?`).all(upTo) as { payload: string }[]).flatMap((r) => JSON.parse(r.payload).refs as string[]),
  );
  const readNow = (store.db.query(`SELECT payload FROM events WHERE kind = 'mail.read' AND fonds = '' AND id > ? AND id <= ?`).all(since, upTo) as { payload: string }[]).flatMap(
    (r) => JSON.parse(r.payload).refs as string[],
  );
  const have = new Set(inRange.map((r) => r.event_id));
  const late = readNow
    .filter((id) => !have.has(id))
    .map((id) => store.db.query(`SELECT event_id, archive_no, at, kind, text, session FROM p_experience WHERE event_id = ? AND kind = 'mail.in'`).get(id) as Row | null)
    .filter((r): r is Row => !!r);
  const rows = [...inRange.filter((r) => r.kind !== "mail.in" || readAll.has(r.event_id)), ...late].sort((a, b) => a.at - b.at || (a.event_id < b.event_id ? -1 : 1));
  const year = refYear(store);
  const groups = new Map<string | null, MaterialLine[]>();
  for (const r of rows) {
    const g = groups.get(r.session) ?? [];
    g.push({ eventId: r.event_id, archiveNo: displayArchiveNo(r.archive_no, year), at: r.at, kind: r.kind, text: r.text });
    groups.set(r.session, g);
  }
  return [...groups].map(([session, lines]) => ({ session, harness: harnessOf(store, session), lines })).sort((a, b) => a.lines[0].at - b.lines[0].at);
}

/** 候选证据：现行规律 / 镜子 / 留意按它的 watch 词在材料里命中、还没计过的行 */
export function candidatesFor(store: EventStore, shelf: ShelfEntry[], material: MaterialLine[]): { entry: ShelfEntry; lines: (MaterialLine & { hit: string })[] }[] {
  const out: { entry: ShelfEntry; lines: (MaterialLine & { hit: string })[] }[] = [];
  for (const e of shelf) {
    if ((e.shelf !== "rule" && e.shelf !== "mirror" && e.shelf !== "attend") || !e.watch?.length) continue;
    const counted = countedEvidence(store.db, e.root);
    const lines = material.flatMap((l) => {
      if (counted.has(l.eventId)) return [];
      const hit = e.watch!.find((w) => w && l.text.includes(w));
      return hit ? [{ ...l, hit }] : [];
    });
    if (lines.length) out.push({ entry: e, lines });
  }
  return out;
}

export function readColdwrite(store: EventStore) {
  const since = coldCursor(store);
  const last = lastMaterialId(store);
  const upTo = last && last > since ? last : null;
  const groups = upTo ? materialLines(store, since, upTo) : [];
  const shelf = readShelf(store.db);
  const year = refYear(store);
  const shown = (e: ShelfEntry) => ({ ...e, archiveNo: displayArchiveNo(e.archiveNo, year) });
  const candidates = candidatesFor(store, shelf, groups.flatMap((g) => g.lines));
  // 统计：这段 = 上次整理那一刻到这次材料里最后一条消息（按发生时间）；第一次从最早一条算
  // 不用 upTo 那条的时刻：它可能是情节，情节的时刻是它所引的第一行，会把最后那次对话截掉
  const msgAt = (agg: "MIN" | "MAX", maxId = "\uffff") =>
    (store.db.query(`SELECT ${agg}(at) AS at FROM events WHERE fonds = '' AND kind IN ('message.in', 'message.out') AND id <= ?`).get(maxId) as { at: number | null }).at;
  const periodFrom = since ? store.get(since)!.at : (msgAt("MIN") ?? 0);
  const periodTo = upTo ? Math.max(msgAt("MAX", upTo) ?? 0, store.get(upTo)!.at) + 1 : 0;
  // 只给它 track 了的（attention.md §四）；全表走 /v1/stats
  const stats = upTo ? pickTracked(computeStats(store.db, { from: periodFrom, to: periodTo, timeZone: store.timeZone }), trackedByPerson(store.db)) : null;
  return {
    upTo,
    since,
    stats,
    feedback: upTo ? feedbackLines(store, since, upTo) : [],
    material: groups.map((g) => ({ session: g.session, harness: g.harness, from: g.lines[0].at, to: g.lines.at(-1)!.at, lines: g.lines.map(({ eventId, ...l }) => l) })),
    shelf: shelf.map(shown),
    candidates: candidates.map((c) => ({ target: shown(c.entry).archiveNo, lines: c.lines.map(({ eventId, ...l }) => l) })),
  };
}

// ── 反馈线（attention.md §五）：我做了什么 → 结果，一律给，不看它留意了什么 ──

export interface FeedbackLine {
  archiveNo: string;
  at: number;
  kind: string;
  text: string;
}
export interface Feedback {
  acts: FeedbackLine[];
  next: FeedbackLine | null;
}

/**
 * (since, upTo] 内机械配对，用原始行（情节覆盖了也给：情节是它的说法，可能把她的反应写轻了）：
 *   对话：同一会话里我连着说的几条 → 其后第一条她的话（1 天内，没有就是 null）；
 *   工具：只列出错的，配上那次调用。
 */
export function feedbackLines(store: EventStore, since: string, upTo: string): Feedback[] {
  const year = refYear(store);
  const rows = store.db
    .query(
      `SELECT * FROM events WHERE fonds = '' AND kind IN ('message.in', 'message.out', 'tool.call', 'tool.result') AND id > ? AND id <= ? ORDER BY at, id`,
    )
    .all(since, upTo) as Record<string, any>[];
  const evs = rows.map((r) => ({ ...r, payload: JSON.parse(r.payload), archiveNo: `${r.day}#${r.seq}` }) as PsycheEvent);
  const line = (e: PsycheEvent): FeedbackLine => ({ archiveNo: displayArchiveNo(e.archiveNo, year), at: e.at, kind: e.kind, text: renderExperience(e) ?? "" });
  const out: (Feedback & { at: number })[] = [];
  const DAY = 86_400_000;

  // 对话：按会话走
  const open = new Map<string, PsycheEvent[]>();
  const flush = (session: string, next: PsycheEvent | null) => {
    const acts = open.get(session);
    if (acts?.length) out.push({ acts: acts.map(line), next: next && next.at - acts.at(-1)!.at <= DAY ? line(next) : null, at: acts[0].at });
    open.delete(session);
  };
  for (const e of evs) {
    if (e.kind !== "message.in" && e.kind !== "message.out") continue;
    const s = sessionOf(store.db, e) ?? "";
    if (e.kind === "message.out") open.set(s, [...(open.get(s) ?? []), e]);
    else flush(s, e);
  }
  for (const s of [...open.keys()]) flush(s, null);

  // 工具：出错的配上调用
  const calls = new Map(evs.filter((e) => e.kind === "tool.call").map((e) => [(e.payload as { callId: string }).callId, e]));
  for (const e of evs) {
    const p = e.payload as { callId: string; ok: boolean };
    if (e.kind !== "tool.result" || p.ok) continue;
    const call = calls.get(p.callId);
    out.push({ acts: call ? [line(call)] : [], next: line(e), at: call?.at ?? e.at });
  }
  return out.sort((a, b) => a.at - b.at).map(({ at, ...f }) => f);
}

// ── 写回 ──

type Op = "propose" | "evidence" | "revise" | "retire";
const OP_KIND: Record<Op, string> = { propose: "semantic.proposed", evidence: "semantic.evidence", revise: "semantic.revised", retire: "semantic.retired" };

interface Checked {
  op: Op;
  kind: string;
  payload: Record<string, unknown>;
  links: { to: string; rel: string; props?: unknown }[];
  root?: string;
  cited: PsycheEvent[];
}

/** 证据只认自己全宗的经历和情节，不认书架条目和处境 */
function resolveCites(store: EventStore, cites: unknown, at: string, upTo: string): PsycheEvent[] {
  if (!Array.isArray(cites)) throw new ColdwriteError(`${at}的 cites 应为数组`);
  const out = new Map<string, PsycheEvent>();
  for (const c of cites) {
    const ev = typeof c === "string" ? store.byArchiveNo(c.trim().replace(/^\[|\]$/g, "")) : null;
    if (!ev) throw new ColdwriteError(`${at}引的 ${String(c)} 查不到`);
    if (ev.fonds || ev.class === "situation" || ev.kind.startsWith("semantic.") || ev.kind === "coldwrite.done")
      throw new ColdwriteError(`${at}引的 ${c} 不是你的经历或情节，不能当证据`);
    if (ev.id > upTo) throw new ColdwriteError(`${at}引的 ${c} 在这次材料之后`);
    out.set(ev.id, ev);
  }
  return [...out.values()];
}

/** target：现行（最新版、未作废）条目的档号 → 条目 */
function resolveTarget(store: EventStore, target: unknown, at: string): ShelfEntry {
  if (!nonEmpty(target)) throw new ColdwriteError(`${at}缺 target（书架条目的档号）`);
  const ev = store.byArchiveNo(target.trim());
  const root = ev ? rootOf(store.db, ev.id) : null;
  const entry = root ? readShelf(store.db, { includeRetired: true }).find((e) => e.root === root) : undefined;
  if (!ev || !entry) throw new ColdwriteError(`${at}的 target ${target} 不是书架条目`);
  if (entry.retired) throw new ColdwriteError(`${at}的 target ${target} 已经作废了`);
  if (entry.current !== ev.id) throw new ColdwriteError(`${at}的 target ${target} 不是最新版，最新的是 ${displayArchiveNo(entry.archiveNo, refYear(store))}`);
  return entry;
}

function fieldsOf(e: Record<string, unknown>, at: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ENTRY_FIELDS) {
    const v = e[k];
    if (v === undefined) continue;
    if (k === "watch") {
      if (!Array.isArray(v) || !v.every(nonEmpty)) throw new ColdwriteError(`${at}的 watch 应为非空字符串数组`);
    } else if (k === "track") {
      if (!Array.isArray(v) || !v.every((x) => TRACK_KEYS.includes(x as string)))
        throw new ColdwriteError(`${at}的 track 只能取这些：${TRACK_KEYS.join(" / ")}`);
    } else if (typeof v !== "string") throw new ColdwriteError(`${at}的 ${k} 应为字符串`);
    out[k] = v;
  }
  return out;
}

const sessionsOf = (store: EventStore, evs: PsycheEvent[]) => new Set(evs.map((e) => sessionOf(store.db, e)).filter((s) => s !== null));

/** 两次独立的发生之间至少隔这么久，才算"不同时间"（同一会话里跨天、或隔了大半天也算） */
export const DISTINCT_GAP_MS = 6 * 3_600_000;

/**
 * 证据是不是来自"不同时间的独立发生"（reading-room §二）：分属不同会话、不同自然日、或相隔 6 小时以上，满足一条就算。
 * 原来只认不同会话——claude.ai 一个对话连着三天，跨天反复出现的事全写不成规律（10-14 真实数据撞出）。
 */
export function distinctTimes(store: EventStore, evs: PsycheEvent[]): boolean {
  if (sessionsOf(store, evs).size >= 2) return true;
  if (new Set(evs.map((e) => e.day)).size >= 2) return true;
  const ats = evs.map((e) => e.at);
  return Math.max(...ats) - Math.min(...ats) >= DISTINCT_GAP_MS;
}

/** 条目的规则：规律 / 镜子要条件、结果、观察方式；明说的规矩原话要逐字出现在所引的她的话里 */
function checkEntryShape(store: EventStore, shelf: string, f: Record<string, unknown>, cited: PsycheEvent[], at: string) {
  if (!nonEmpty(f.text)) throw new ColdwriteError(`${at}的 text 是空的`);
  if (f.track !== undefined && shelf !== "attend" && shelf !== "relation") throw new ColdwriteError(`${at}：track 只用在留意和关系上`);
  if ((f.track as string[] | undefined)?.length && !nonEmpty(f.about)) throw new ColdwriteError(`${at}：track 要写 about（统计按人数）`);
  if (shelf === "attend" && !(Array.isArray(f.watch) && f.watch.length)) throw new ColdwriteError(`${at}是留意，缺 watch（系统按这些词给你找后来的事）`);
  if (shelf === "relation" && !nonEmpty(f.about)) throw new ColdwriteError(`${at}是关系，缺 about（和谁的关系）`);
  if (shelf === "rule" || shelf === "mirror") {
    for (const k of ["when", "then", "observe"]) if (!nonEmpty(f[k])) throw new ColdwriteError(`${at}是${shelf === "rule" ? "规律" : "镜子"}，缺 ${k}`);
  }
  if (shelf === "told") {
    if (!nonEmpty(f.quote)) throw new ColdwriteError(`${at}是明说的规矩，缺 quote（原话）`);
    const q = (f.quote as string).trim();
    // 引的是情节时，顺着情节挂的档号往下找一层：热写后原话被情节覆盖，材料里只剩情节（10-14 撞出）
    const msgs = cited.flatMap((e) =>
      e.kind === "episode" ? store.linksFrom(e.id).filter((l) => l.rel === "cites").map((l) => store.get(l.to)!).filter(Boolean) : [e],
    );
    if (!msgs.some((e) => e.kind === "message.in" && typeof (e.payload as { text?: unknown }).text === "string" && ((e.payload as { text: string }).text).includes(q)))
      throw new ColdwriteError(`${at}的原话「${q}」在所引的消息里找不到（要逐字；引情节的话，会去情节挂的原件里找）`);
  }
}

function checkOp(store: EventStore, e: unknown, i: number, upTo: string): Checked {
  const at = `第 ${i + 1} 条`;
  if (!e || typeof e !== "object") throw new ColdwriteError(`${at}不是对象`);
  const o = e as Record<string, unknown>;
  const op = o.op as Op;
  if (!(op in OP_KIND)) throw new ColdwriteError(`${at}的 op 应为 propose / evidence / revise / retire`);
  const cited = resolveCites(store, o.cites, at, upTo);
  const evidence = (props?: unknown) => cited.map((c) => ({ to: c.id, rel: "evidence", ...(props ? { props } : {}) }));

  if (op === "propose") {
    if (!SHELVES.includes(o.shelf as never)) throw new ColdwriteError(`${at}的 shelf 应为 ${SHELVES.join(" / ")}`);
    const f = fieldsOf(o, at);
    checkEntryShape(store, o.shelf as string, f, cited, at);
    if (!cited.length) throw new ColdwriteError(`${at}没有证据（cites）`);
    if (o.shelf === "relation" && readShelf(store.db, { shelf: "relation" }).some((e) => e.about === f.about))
      throw new ColdwriteError(`${at}：关于 ${f.about} 已经有一条关系了，要改就 revise 那条`);
    if ((o.shelf === "rule" || o.shelf === "mirror") && (cited.length < 2 || !distinctTimes(store, cited)))
      throw new ColdwriteError(`${at}是${o.shelf === "rule" ? "规律" : "镜子"}：证据至少 2 条、来自不同时间（不同会话、不同的天、或相隔 6 小时以上；单次不是规律）`);
    return { op, kind: OP_KIND[op], payload: { shelf: o.shelf, ...f }, links: evidence({ stance: "for" }), cited };
  }

  const entry = resolveTarget(store, o.target, at);
  const target = { target: entry.current };
  if (op === "evidence") {
    if (!["for", "against", "irrelevant"].includes(o.stance as string)) throw new ColdwriteError(`${at}的 stance 应为 for / against / irrelevant`);
    if (!cited.length) throw new ColdwriteError(`${at}没挂事件：${o.stance === "against" ? "反例要指出是哪条事件" : "判的是哪条，要挂上"}`);
    const counted = countedEvidence(store.db, entry.root);
    const dup = cited.find((c) => counted.has(c.id));
    if (dup) throw new ColdwriteError(`${at}引的 ${dup.archiveNo} 已经算过这条的证据了`);
    if (o.note !== undefined && typeof o.note !== "string") throw new ColdwriteError(`${at}的 note 应为字符串`);
    return { op, kind: OP_KIND[op], payload: { ...target, stance: o.stance, ...(o.note ? { note: o.note } : {}) }, links: evidence({ stance: o.stance }), root: entry.root, cited };
  }
  if (!nonEmpty(o.why)) throw new ColdwriteError(`${at}要写 why（为什么${op === "revise" ? "改" : "作废"}）`);
  if (!cited.length) throw new ColdwriteError(`${at}没挂证据：看了哪些事才${op === "revise" ? "改" : "作废"}的`);
  if (op === "retire") return { op, kind: OP_KIND[op], payload: { ...target, why: o.why }, links: evidence(), root: entry.root, cited };
  const f = fieldsOf(o, at);
  if (entry.shelf === "relation" && f.about !== undefined && f.about !== entry.about) throw new ColdwriteError(`${at}：关系改写不能换 about（换人就另起一条）`);
  const merged = { ...Object.fromEntries(ENTRY_FIELDS.filter((k) => entry[k] !== undefined).map((k) => [k, entry[k]])), ...f };
  checkEntryShape(store, entry.shelf, merged, cited, at);
  return { op, kind: OP_KIND[op], payload: { ...target, why: o.why, ...f }, links: [...evidence(), { to: entry.current, rel: "revises" }], root: entry.root, cited };
}

const idemOf = (upTo: string, n: number | "done") => `cold:${upTo}:${n}`;

/** POST /v1/coldwrite：校验全过才写，一个事务；最后写 coldwrite.done（游标与没判的候选） */
export function writeColdwrite(store: EventStore, input: { upTo?: unknown; entries?: unknown }, promptVersion: number) {
  const upTo = input.upTo;
  if (!nonEmpty(upTo)) throw new ColdwriteError("缺 upTo");
  const year = refYear(store);
  const shown = (ev: PsycheEvent, op: string) => ({ id: ev.id, archiveNo: displayArchiveNo(ev.archiveNo, year), op });

  // 重试：同一个 upTo 已经交过，取回同一批
  const done = store.db.query(`SELECT id FROM events WHERE source = 'agent' AND idem = ?`).get(idemOf(upTo, "done")) as { id: string } | null;
  if (done) {
    const evs = store.db.query(`SELECT id FROM events WHERE source = 'agent' AND idem LIKE ? AND idem <> ? ORDER BY id`).all(`cold:${upTo}:%`, idemOf(upTo, "done")) as { id: string }[];
    return { written: evs.map((r) => store.get(r.id)!).map((ev) => shown(ev, Object.entries(OP_KIND).find(([, k]) => k === ev.kind)![0])) };
  }

  const since = coldCursor(store);
  const last = store.get(upTo);
  if (!last || last.id <= since || last.fonds || last.kind.startsWith("semantic.") || last.kind === "coldwrite.done")
    throw new ColdwriteError(`upTo ${upTo} 不是这次材料里的事件`);
  const entries = input.entries ?? [];
  if (!Array.isArray(entries)) throw new ColdwriteError("entries 应为数组（可以是空的：看过了，没什么要写）");

  const checked = entries.map((e, i) => checkOp(store, e, i, upTo));
  // 同一批里同一条目只能改一次 / 作废一次
  const touched = new Set<string>();
  checked.forEach((c, i) => {
    if (c.op !== "revise" && c.op !== "retire") return;
    if (touched.has(c.root!)) throw new ColdwriteError(`第 ${i + 1} 条：同一条目这一批里已经改过或作废过了`);
    touched.add(c.root!);
  });

  // 没判的候选：这次摆出来的候选里，没被本批任何一条挂到对应条目上的
  const material = materialLines(store, since, upTo).flatMap((g) => g.lines);
  const judged = new Set(checked.filter((c) => c.root).flatMap((c) => c.cited.map((e) => `${c.root}:${e.id}`)));
  const unjudged = candidatesFor(store, readShelf(store.db), material).flatMap((c) =>
    c.lines.filter((l) => !judged.has(`${c.entry.root}:${l.eventId}`)).map((l) => ({ target: displayArchiveNo(c.entry.archiveNo, year), line: l.archiveNo })),
  );

  const written = store.db.transaction(() => {
    const evs = checked.map((c, i) =>
      store.append({ kind: c.kind, class: "self", source: "agent", producer: `cold-write@${promptVersion}`, payload: c.payload, links: c.links, idem: idemOf(upTo, i + 1) }),
    );
    store.append({ kind: "coldwrite.done", class: "self", source: "agent", producer: `cold-write@${promptVersion}`, payload: { upTo, since, unjudged }, idem: idemOf(upTo, "done") });
    return evs;
  })();
  return { written: written.map((ev, i) => shown(ev, checked[i].op)), unjudged: unjudged.length };
}
