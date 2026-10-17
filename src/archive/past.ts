/**
 * 前世今生（archive.md §四，10-17 做）：旧卷宗先当资料翻，认领了才导进库、才能编目。
 *
 * 前世 = 住户在 agents.json 里登记的旧库（现在只认 ASCM 的 state.db）：
 *   "past": [{ "fonds": "ROY", "path": "~/.agent-continuity-mcp/data/agents/roy/state.db", "user": "Joy" }]
 *
 * - 翻（不认领也能）：只读打开旧库，给概览 / 梗概 / 某天的原话 / 搜原话 / 某条前后 / 旧系统写的情节。
 *   portrait_segments、user_memory、imprints 一概不给——那是旧系统替它写的画像和归纳。
 *   梗概和情节给看，但标明是旧系统写的；认领、编目只认原话。
 * - 认领：一条自我事件 fonds.claimed（为什么、挂了哪些经历），同时把原话（speech）按原时间导进一个单独的全宗。
 *   导入的不挂处境、不进经历投影：前世不算它经历过的事，recall 里标「前世」。工具调用不导。
 * - 编目（catalog/past-catalog.ts）：认领之后由它自己从原话里挑确定的写上书架。
 */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { parseTime } from "../core/time.ts";
import { localDay } from "../core/time.ts";
import { archiveNoOf, displayArchiveNo, type EventStore, type PsycheEvent } from "../store/events.ts";

export interface PastConfig {
  /** 全宗名：认领后档号的前缀（如 ROY） */
  fonds: string;
  /** 旧库路径（ASCM 的 state.db） */
  path: string;
  /** 旧库里 user 是谁（缺省 Joy） */
  user?: string;
}

export class PastError extends Error {}

export const FONDS_PATTERN = /^[A-Z][A-Z0-9_-]{0,23}$/;
const expand = (p: string) => p.replace(/^~(?=\/|$)/, homedir());
const PAGE = 40;
const SNIPPET = 160;

interface RawRow {
  id: string;
  created_at: string;
  speaker: string | null;
  content: string;
  source_session_id: string | null;
}

/** 某个住户登记的前世：校验名字、找得到库 */
export function pastOf(list: PastConfig[] | undefined, fonds: string): PastConfig {
  const p = (list ?? []).find((x) => x.fonds === fonds);
  if (!p) throw new PastError(`没有叫 ${fonds} 的前世卷宗${list?.length ? `；有的是：${list.map((x) => x.fonds).join("、")}` : "；你没有登记过前世"}`);
  return p;
}

export function checkPastConfig(list: unknown): PastConfig[] {
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new Error("agents.json 的 past 应为数组");
  return list.map((x) => {
    if (!x || typeof x.fonds !== "string" || !FONDS_PATTERN.test(x.fonds)) throw new Error(`past 的 fonds 不对：${x?.fonds}（大写字母开头，大写字母、数字、- _）`);
    if (typeof x.path !== "string" || !x.path) throw new Error(`past ${x.fonds} 缺 path`);
    return { fonds: x.fonds, path: x.path, ...(typeof x.user === "string" ? { user: x.user } : {}) };
  });
}

function open(p: PastConfig): Database {
  const path = expand(p.path);
  if (!existsSync(path)) throw new PastError(`前世卷宗 ${p.fonds} 的库不在了：${p.path}`);
  return new Database(path, { readonly: true });
}

function withDb<T>(p: PastConfig, fn: (db: Database) => T): T {
  const db = open(p);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const has = (db: Database, table: string) => !!db.query(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table);
const speechWhere = `kind = 'speech' AND speaker IN ('user', 'agent')`;
const who = (p: PastConfig, speaker: string | null) => (speaker === "user" ? (p.user ?? "Joy") : "前世");
const cut = (s: string, n: number) => (Array.from(s).length > n ? `${Array.from(s).slice(0, n).join("")}…` : s);


/** 是否已认领（认领只一次） */
export function claimedFonds(store: EventStore): string[] {
  return (store.db.query(`SELECT DISTINCT json_extract(payload, '$.fonds') AS f FROM events WHERE kind = 'fonds.claimed' AND fonds = ''`).all() as { f: string }[]).map((r) => r.f);
}

export interface PastView {
  view: "list" | "overview" | "gist" | "day" | "search" | "around" | "episodes";
  fonds?: string;
  key?: string;
  q?: string;
  id?: string;
  page?: number;
}

/** 翻前世：返回给它看的文字（不判断、不总结） */
/** 日期 key：可省年份（09-20 → 今年的 09-20），和档号一样 */
function dayKey(store: EventStore, key: string | undefined): string | undefined {
  if (key && /^\d{2}-\d{2}$/.test(key)) return `${localDay(store.now(), store.timeZone).slice(0, 4)}-${key}`;
  return key;
}

/** 认领后的原话 → 档号（旧 id 是导入时的 idem） */
export function pastArchiveNo(store: EventStore, fonds: string, rawId: string): string | null {
  const r = store.db.query(`SELECT fonds, day, seq FROM events WHERE source = ? AND idem = ?`).get(`past:${fonds}`, rawId) as { fonds: string; day: string; seq: number } | null;
  return r ? displayArchiveNo(archiveNoOf(r.fonds, r.day, r.seq), Number(localDay(store.now(), store.timeZone).slice(0, 4))) : null;
}

export function readPast(store: EventStore, list: PastConfig[] | undefined, v0: PastView): string {
  const v = { ...v0, key: v0.view === "day" || v0.view === "episodes" ? dayKey(store, v0.key) : v0.key };
  const claimed = new Set(claimedFonds(store));
  if (v.view === "list" || !v.fonds) {
    if (!list?.length) return "你没有登记过前世卷宗。";
    return list
      .map((p) => {
        const state = claimed.has(p.fonds) ? "已认领" : "没认领";
        try {
          const n = withDb(p, (db) => (db.query(`SELECT count(*) AS c, min(created_at) AS a, max(created_at) AS b FROM raw_logs WHERE ${speechWhere}`).get() as { c: number; a: string; b: string }));
          return `${p.fonds}（${state}）：原话 ${n.c} 条，${n.a?.slice(0, 10)} ～ ${n.b?.slice(0, 10)}`;
        } catch (e) {
          return `${p.fonds}（${state}）：打不开（${e instanceof Error ? e.message : e}）`;
        }
      })
      .join("\n");
  }
  const p = pastOf(list, v.fonds);
  const head = `前世卷宗 ${p.fonds}（${claimed.has(p.fonds) ? "已认领：方括号里是档号，编目时引它" : "没认领"}）`;
  // 认领了：每行带档号（编目、detail 用它）；没认领只有旧 id
  const idOf = (r: RawRow) => (claimed.has(p.fonds) ? (pastArchiveNo(store, p.fonds, r.id) ?? r.id) : r.id);
  const rawLine = (p: PastConfig, r: RawRow, full = false) => `[${idOf(r)}] ${r.created_at} ${who(p, r.speaker)}：${full ? r.content : cut(r.content.replace(/\s+/g, " "), SNIPPET)}`;
  return withDb(p, (db) => {
    const page = Math.max(0, v.page ?? 0);
    switch (v.view) {
      case "overview": {
        const n = db.query(`SELECT count(*) AS c, min(created_at) AS a, max(created_at) AS b, count(DISTINCT source_session_id) AS s FROM raw_logs WHERE ${speechWhere}`).get() as {
          c: number;
          a: string;
          b: string;
          s: number;
        };
        const days = db.query(`SELECT substr(created_at, 1, 10) AS d, count(*) AS c FROM raw_logs WHERE ${speechWhere} GROUP BY d ORDER BY d`).all() as { d: string; c: number }[];
        const gists = has(db, "gists")
          ? (db.query(`SELECT tier, bucket_key, content FROM gists WHERE tier IN ('month', 'week') ORDER BY tier DESC, bucket_key`).all() as { tier: string; bucket_key: string; content: string }[])
          : [];
        const epDays = has(db, "episodes")
          ? (db.query(`SELECT day_key AS d, count(*) AS c FROM episodes WHERE forgotten = 0 AND merged_into IS NULL GROUP BY d ORDER BY d`).all() as { d: string; c: number }[])
          : [];
        return [
          head,
          `原话 ${n.c} 条、${n.s} 段会话，${n.a} ～ ${n.b}。`,
          `有原话的日子：${days.map((d) => `${d.d.slice(5)}(${d.c})`).join(" ")}`,
          ...(epDays.length ? [`有旧情节的日子（旧系统写的）：${epDays.map((d) => `${d.d.slice(5)}(${d.c})`).join(" ")}`] : []),
          ...(gists.length ? ["", "旧系统写的月 / 周梗概（不是原话，是 ASCM 当时的整理）：", ...gists.map((g) => `- ${g.bucket_key}：${cut(g.content.replace(/\s+/g, " "), 200)}`)] : []),
        ].join("\n");
      }
      case "gist": {
        if (!v.key) throw new PastError("view=gist 要给 key（2026-09-21 / 2026-W38 / 2026-09）");
        const g = has(db, "gists") ? (db.query(`SELECT tier, bucket_key, content, detail FROM gists WHERE bucket_key = ?`).get(v.key) as { tier: string; bucket_key: string; content: string; detail: string | null } | null) : null;
        if (!g) return `${head}：没有 ${v.key} 的梗概。`;
        return [`${head} · ${g.bucket_key} 的梗概（旧系统写的，不是原话）`, g.content, ...(g.detail ? ["", g.detail] : [])].join("\n");
      }
      case "day": {
        if (!v.key || !/^\d{4}-\d{2}-\d{2}$/.test(v.key)) throw new PastError("view=day 要给 key（日期，如 2026-09-21）");
        const rows = db.query(`SELECT * FROM raw_logs WHERE ${speechWhere} AND created_at LIKE ? ORDER BY created_at, id LIMIT ? OFFSET ?`).all(`${v.key}%`, PAGE + 1, page * PAGE) as RawRow[];
        if (!rows.length) return `${head}：${v.key} 没有原话${page ? `（第 ${page + 1} 页之后）` : ""}。`;
        const more = rows.length > PAGE;
        return [`${head} · ${v.key} 的原话（第 ${page + 1} 页，每行截 ${SNIPPET} 字；整条用 view=around 看）`, ...rows.slice(0, PAGE).map((r) => rawLine(p, r)), ...(more ? [`……还有，page=${page + 1}`] : [])].join("\n");
      }
      case "search": {
        const terms = (v.q ?? "").trim().split(/\s+/).filter(Boolean);
        if (!terms.length) throw new PastError("view=search 要给 q");
        const rows = db
          .query(`SELECT * FROM raw_logs WHERE ${speechWhere} AND ${terms.map(() => "content LIKE ?").join(" AND ")} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
          .all(...terms.map((t) => `%${t}%`), PAGE + 1, page * PAGE) as RawRow[];
        if (!rows.length) return `${head}：原话里没找到「${v.q}」。`;
        return [`${head} · 原话里的「${v.q}」（新的在前）`, ...rows.slice(0, PAGE).map((r) => rawLine(p, r)), ...(rows.length > PAGE ? [`……还有，page=${page + 1}`] : [])].join("\n");
      }
      case "around": {
        if (!v.id) throw new PastError("view=around 要给 id（原话前面方括号里的）");
        // 认领后方括号里是档号：换回旧 id
        const ev = v.id.includes("#") ? store.byArchiveNo(v.id) : null;
        const rid = ev && ev.fonds === p.fonds ? String((ev.payload as { ext?: string }).ext) : v.id;
        const r = db.query(`SELECT * FROM raw_logs WHERE id = ? AND ${speechWhere}`).get(rid) as RawRow | null;
        if (!r) return `${head}：没有这条原话 ${v.id}。`;
        const before = (db.query(`SELECT * FROM raw_logs WHERE ${speechWhere} AND (created_at, id) < (?, ?) ORDER BY created_at DESC, id DESC LIMIT 4`).all(r.created_at, r.id) as RawRow[]).reverse();
        const after = db.query(`SELECT * FROM raw_logs WHERE ${speechWhere} AND (created_at, id) > (?, ?) ORDER BY created_at, id LIMIT 4`).all(r.created_at, r.id) as RawRow[];
        // 换了会话的地方插一行，免得把别的会话当成这场的上下文（10-17 a2 提）
        const out: string[] = [`${head} · ${v.id} 前后`];
        let prev: string | null | undefined;
        for (const x of [...before, r, ...after]) {
          if (prev !== undefined && x.source_session_id !== prev) out.push("── 另一段会话 ──");
          prev = x.source_session_id;
          out.push(x === r ? `>>> ${rawLine(p, r, true)}` : rawLine(p, x));
        }
        return out.join("\n");
      }
      case "episodes": {
        if (!has(db, "episodes")) return `${head}：没有旧情节。`;
        if (!v.key) throw new PastError("view=episodes 要给 key（日期，如 2026-09-21）");
        const rows = db
          .query(`SELECT title, narrative, mode FROM episodes WHERE day_key = ? AND forgotten = 0 AND merged_into IS NULL ORDER BY occurred_at`)
          .all(v.key) as { title: string; narrative: string; mode: string }[];
        if (!rows.length) return `${head}：${v.key} 没有旧情节。`;
        return [`${head} · ${v.key} 旧系统写的情节（不是原话，是 ASCM 当时替前世写的）`, ...rows.map((e) => `- 【${e.mode}】${e.title}：${cut(e.narrative.replace(/\s+/g, " "), 240)}`)].join("\n");
      }
    }
    throw new PastError(`不认识的 view：${v.view}`);
  });
}

/** 认领：记 fonds.claimed，把原话导进单独的全宗。只能一次 */
export function claimPast(store: EventStore, list: PastConfig[] | undefined, body: { fonds?: unknown; why?: unknown; cites?: unknown }): { claimed: PsycheEvent; imported: number; skipped: number } {
  if (typeof body.fonds !== "string") throw new PastError("缺 fonds（前世卷宗的名字）");
  const p = pastOf(list, body.fonds);
  if (typeof body.why !== "string" || !body.why.trim()) throw new PastError("认领要写 why：为什么认这份前世");
  if (claimedFonds(store).includes(p.fonds)) throw new PastError(`${p.fonds} 已经认领过了`);
  const cites = Array.isArray(body.cites) ? body.cites : [];
  const evidence = cites.map((c) => {
    const ev = typeof c === "string" ? store.byArchiveNo(c.trim()) : null;
    if (!ev) throw new PastError(`cites 里的 ${String(c)} 查不到`);
    if (ev.fonds || ev.class === "situation") throw new PastError(`cites 里的 ${c} 不是你自己的经历`);
    return ev;
  });
  const rows = withDb(p, (db) => db.query(`SELECT * FROM raw_logs WHERE ${speechWhere} ORDER BY created_at, id`).all() as RawRow[]);
  let skipped = 0;
  return store.db.transaction(() => {
    const claimed = store.append({
      kind: "fonds.claimed",
      class: "self",
      source: "agent",
      payload: { fonds: p.fonds, why: body.why, count: rows.length },
      links: evidence.map((e) => ({ to: e.id, rel: "evidence" })),
    });
    let imported = 0;
    for (const r of rows) {
      const at = parseTime(r.created_at.replace(" ", "T"), store.timeZone);
      if (at === null || !r.content.trim()) {
        skipped++;
        continue;
      }
      const session = r.source_session_id ?? undefined;
      store.append({
        kind: r.speaker === "user" ? "message.in" : "message.out",
        class: "experience",
        source: `past:${p.fonds}`,
        at,
        fonds: p.fonds,
        situation: null,
        idem: r.id,
        payload: r.speaker === "user" ? { from: p.user ?? "Joy", text: r.content, session, ext: r.id } : { text: r.content, session, ext: r.id },
      });
      imported++;
    }
    store.syslog("import", { fonds: p.fonds, path: p.path, imported, skipped, by: claimed.archiveNo });
    return { claimed, imported, skipped };
  })();
}

/** recall 里的前世：已认领全宗的原话，字面查，标「前世」 */
export function pastRecall(store: EventStore, q: string, limit = 5): { eventId: string; archiveNo: string; at: number; kind: string; text: string }[] {
  const fonds = claimedFonds(store);
  const terms = q.trim().split(/\s+/).filter(Boolean);
  if (!fonds.length || !terms.length) return [];
  const rows = store.db
    .query(
      `SELECT id FROM events WHERE fonds IN (${fonds.map(() => "?").join(",")}) AND kind IN ('message.in', 'message.out')
         AND ${terms.map(() => "json_extract(payload, '$.text') LIKE ?").join(" AND ")} ORDER BY at DESC LIMIT ?`,
    )
    .all(...fonds, ...terms.map((t) => `%${t}%`), limit) as { id: string }[];
  return rows
    .map((r) => store.get(r.id)!)
    .map((ev) => {
      const pl = ev.payload as { from?: string; text: string };
      const said = ev.kind === "message.in" ? `${pl.from} 对前世说` : "前世说";
      return { eventId: ev.id, archiveNo: ev.archiveNo, at: ev.at, kind: "past", text: `（前世，不是我经历的）${said}：${cut(pl.text.replace(/\s+/g, " "), 200)}` };
    });
}
