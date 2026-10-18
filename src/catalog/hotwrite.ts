/**
 * 热写（catalog.md §二，契约 m1.md §二）：收尾时，它把这一段写成情节。
 *
 * 段 = 会话 S 里、自己全宗的经历/自我事件（不含情节本身），id 在 (游标, 当前最后一条]。
 * 游标 = S 已有情节的 payload.upTo 最大值，读时算，不另存表：情节就是进度。
 * 系统只给清单、只做校验；写什么、怎么写是它的事，系统不替它补。
 */
import type { EventStore, PsycheEvent } from "../store/events.ts";
import { displayArchiveNo } from "../store/events.ts";
import { localDay } from "../core/time.ts";
import { renderExperience } from "../archive/render.ts";
import { checkPins, PinError } from "../self/pinned.ts";

export class HotwriteError extends Error {}

export interface SegmentLine {
  archiveNo: string;
  at: number;
  kind: string;
  text: string;
}

export interface EntryInput {
  text: string;
  felt?: string;
  cites: string[];
}

/** 会话：省略 = 当前处境的会话 */
export function resolveSession(store: EventStore, session?: string): string {
  if (session) return session;
  const s = (store.situation?.payload as { session?: unknown } | undefined)?.session;
  if (typeof s !== "string" || !s) throw new HotwriteError("不知道是哪个会话：当前处境没有 session，也没传 session");
  return s;
}

/** 游标(S)：已有情节的 upTo 最大值（按 id 比）；没有 = ""（从头） */
export function cursorOf(store: EventStore, session: string): string {
  const r = store.db
    .query(
      `SELECT MAX(json_extract(payload, '$.upTo')) AS c FROM events
       WHERE kind = 'episode' AND fonds = '' AND json_extract(payload, '$.session') = ?`,
    )
    .get(session) as { c: string | null };
  return r.c ?? "";
}

/** 段内事件，按 id 排。upTo 给了就截到 upTo */
export function segmentEvents(store: EventStore, session: string, upTo?: string): PsycheEvent[] {
  const rows = store.db
    .query(
      `SELECT e.id FROM events e JOIN events s ON s.id = e.situation
       WHERE e.fonds = '' AND e.class IN ('experience', 'self') AND e.kind <> 'episode'
         AND json_extract(s.payload, '$.session') = ? AND e.id > ? AND e.id <= ?
       ORDER BY e.id`,
    )
    .all(session, cursorOf(store, session), upTo ?? "￿") as { id: string }[];
  return rows.map((r) => store.get(r.id)!);
}

const refYear = (store: EventStore) => Number(localDay(store.now(), store.timeZone).slice(0, 4));

/** 段的清单：经历模板渲染，返回 null 的跳过；按发生时间排 */
export function segmentLines(store: EventStore, events: PsycheEvent[]): SegmentLine[] {
  const year = refYear(store);
  const lines: (SegmentLine & { id: string })[] = [];
  for (const ev of events) {
    const text = renderExperience(ev);
    if (text !== null) lines.push({ id: ev.id, archiveNo: displayArchiveNo(ev.archiveNo, year), at: ev.at, kind: ev.kind, text });
  }
  lines.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  return lines.map(({ id, ...l }) => l);
}

/** GET /v1/hotwrite 的正文（不含提示词） */
export function readSegment(store: EventStore, session?: string): { session: string; upTo: string | null; lines: SegmentLine[] } {
  const s = resolveSession(store, session);
  const events = segmentEvents(store, s);
  return { session: s, upTo: events.at(-1)?.id ?? null, lines: segmentLines(store, events) };
}

const idemOf = (session: string, upTo: string, n: number) => `hot:${session}:${upTo}:${n}`;

/** 同一 (会话, upTo) 已经写过：按幂等键取回，重试拿到同一批 */
function existingEpisodes(store: EventStore, session: string, upTo: string): PsycheEvent[] {
  const out: PsycheEvent[] = [];
  for (let n = 1; ; n++) {
    const r = store.db.query(`SELECT id FROM events WHERE source = 'agent' AND idem = ?`).get(idemOf(session, upTo, n)) as { id: string } | null;
    if (!r) return out;
    out.push(store.get(r.id)!);
  }
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** 事件属于哪个会话的段：自己全宗、经历/自我、不是情节，经所挂处境查；不属于任何段 = null */
function sessionOfEvent(store: EventStore, ev: PsycheEvent): string | null {
  if (ev.fonds || ev.class === "situation" || ev.kind === "episode" || !ev.situation) return null;
  const s = (store.get(ev.situation)?.payload as { session?: unknown } | undefined)?.session;
  return typeof s === "string" ? s : null;
}

/** 校验一条：返回它所引事件（去重） */
function checkEntry(store: EventStore, e: unknown, i: number, session: string, cursor: string, upTo: string): PsycheEvent[] {
  const at = `第 ${i + 1} 条`;
  if (!e || typeof e !== "object") throw new HotwriteError(`${at}不是对象`);
  const { text, felt, cites } = e as Record<string, unknown>;
  if (!nonEmpty(text)) throw new HotwriteError(`${at}的 text 是空的`);
  if (felt !== undefined && typeof felt !== "string") throw new HotwriteError(`${at}的 felt 应为字符串`);
  if (!Array.isArray(cites) || !cites.length) throw new HotwriteError(`${at}没有 cites`);
  const cited = new Map<string, PsycheEvent>();
  for (const c of cites) {
    const ev = typeof c === "string" ? store.byArchiveNo(c) : null;
    if (!ev) throw new HotwriteError(`${at}引的 ${String(c)} 查不到`);
    if (sessionOfEvent(store, ev) !== session) throw new HotwriteError(`${at}引的 ${c} 不属于会话 ${session} 的段`);
    if (ev.id <= cursor || ev.id > upTo) throw new HotwriteError(`${at}引的 ${c} 不在本段 (游标, upTo] 内`);
    cited.set(ev.id, ev);
  }
  return [...cited.values()];
}

/** POST /v1/hotwrite：校验全过才写，一个事务，整批进或整批不进 */
export function writeEpisodes(
  store: EventStore,
  input: { session?: string; upTo?: unknown; entries?: unknown; pin?: unknown; unpin?: unknown },
  promptVersion: number,
): { episodes: { id: string; archiveNo: string }[] } {
  const session = resolveSession(store, typeof input.session === "string" ? input.session : undefined);
  const upTo = input.upTo;
  if (!nonEmpty(upTo)) throw new HotwriteError("缺 upTo");
  const year = refYear(store);
  const out = (evs: PsycheEvent[]) => ({ episodes: evs.map((e) => ({ id: e.id, archiveNo: displayArchiveNo(e.archiveNo, year) })) });

  const done = existingEpisodes(store, session, upTo);
  if (done.length) return out(done);

  const cursor = cursorOf(store, session);
  const last = store.get(upTo);
  if (!last || sessionOfEvent(store, last) !== session || last.id <= cursor)
    throw new HotwriteError(`upTo ${upTo} 不是会话 ${session} 段内的事件`);
  const entries = input.entries;
  if (!Array.isArray(entries) || !entries.length) throw new HotwriteError("entries 是空的");
  const checked = entries.map((e, i) => ({ entry: e as EntryInput, cited: checkEntry(store, e, i, session, cursor, upTo) }));
  let pins: ReturnType<typeof checkPins> = null;
  try {
    pins = checkPins(store, input.pin, input.unpin);
  } catch (e) {
    if (e instanceof PinError) throw new HotwriteError(e.message);
    throw e;
  }

  const written = store.db.transaction(() => {
    const eps = checked.map(({ entry, cited }, i) =>
      store.append({
        kind: "episode",
        class: "self",
        source: "agent",
        producer: `hot-write@${promptVersion}`,
        at: Math.min(...cited.map((e) => e.at)),
        payload: { text: entry.text, ...(entry.felt ? { felt: entry.felt } : {}), session, upTo },
        links: cited.map((e) => ({ to: e.id, rel: "cites" })),
        idem: idemOf(session, upTo, i + 1),
      }),
    );
    if (pins) store.append({ kind: "pin.changed", class: "self", source: "agent", payload: pins, idem: `${idemOf(session, upTo, 0)}:pin` });
    return eps;
  })();
  return out(written);
}

/**
 * 改写一条情节（10-14）：写一条新情节，revises 指向旧的；旧条留着，经历里显示新的。
 * 人重讲一件事，原来的说法还在，只是现在讲的不一样了。只能改最新的那版。
 */
export function reviseEpisode(
  store: EventStore,
  input: { target?: unknown; text?: unknown; felt?: unknown; why?: unknown },
): { id: string; archiveNo: string } {
  if (!nonEmpty(input.target)) throw new HotwriteError("缺 target（要改的那条情节的档号）");
  if (!nonEmpty(input.text)) throw new HotwriteError("text 是空的");
  if (input.felt !== undefined && typeof input.felt !== "string") throw new HotwriteError("felt 应为字符串");
  if (input.why !== undefined && typeof input.why !== "string") throw new HotwriteError("why 应为字符串");
  const old = store.byArchiveNo(input.target);
  if (!old || old.kind !== "episode" || old.fonds) throw new HotwriteError(`${input.target} 不是你的情节`);
  const year = refYear(store);
  const idem = `rev:${old.id}`;
  const again = store.db.query(`SELECT id FROM events WHERE source = 'agent' AND idem = ?`).get(idem) as { id: string } | null;
  if (again) {
    const newer = store.get(again.id)!;
    throw new HotwriteError(`${input.target} 已经改写过了，新的是 ${displayArchiveNo(newer.archiveNo, year)}；要改就改那条`);
  }
  const p = old.payload as { session?: string; upTo?: string };
  const cites = store.linksFrom(old.id).filter((l) => l.rel === "cites").map((l) => ({ to: l.to, rel: "cites" }));
  const ev = store.append({
    kind: "episode",
    class: "self",
    source: "agent",
    producer: "revise",
    at: old.at,
    payload: {
      text: input.text,
      ...(input.felt ? { felt: input.felt } : {}),
      ...(input.why ? { why: input.why } : {}),
      session: p.session,
      upTo: p.upTo,
    },
    links: [...cites, { to: old.id, rel: "revises" }],
    idem,
  });
  return { id: ev.id, archiveNo: displayArchiveNo(ev.archiveNo, year) };
}
