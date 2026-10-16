/**
 * 书架投影（m2.md §四，reading-room.md §一 §二）：阅览室里它写的条目，现行版 + 证据计数。
 *
 * 一条书架条目 = 一串 semantic.* 事件：proposed 起头，revised 换新版，evidence 记判断，retired 收起。
 * 计数从证据链接数出来（按次，不按行），不让它自评；强弱曲线（敏感化 / 钝化）后置，读时另算。
 */
import type { Database } from "bun:sqlite";
import { displayArchiveNo, type EventStore, type PsycheEvent } from "../store/events.ts";
import type { Projector } from "../store/projections.ts";
import { sessionOf } from "../archive/experience.ts";
import { localDay } from "../core/time.ts";
import { renderExperience } from "../archive/render.ts";

export const SHELVES = ["fact", "told", "rule", "mirror", "attend", "relation"] as const;
export type Shelf = (typeof SHELVES)[number];
/** 条目字段：proposed 给全，revised 只给要改的 */
export const ENTRY_FIELDS = ["text", "when", "then", "observe", "quote", "watch", "about", "track"] as const;

export interface ShelfEntry {
  root: string;
  /** 现行版的事件 id 与档号 */
  current: string;
  archiveNo: string;
  shelf: Shelf;
  text: string;
  when?: string;
  then?: string;
  observe?: string;
  quote?: string;
  watch?: string[];
  /** 留意 / 关系：关于谁 */
  about?: string;
  /** 它要盯的统计指标（stats.ts 的 TRACK_KEYS），要有 about */
  track?: string[];
  retired: boolean;
  for: number;
  against: number;
  irrelevant: number;
  lastEvidenceAt: number | null;
  /** 现行版写于何时 */
  at: number;
}

const ev_ = (db: Database, id: string) => {
  const r = db.query(`SELECT * FROM events WHERE id = ?`).get(id) as Record<string, any>;
  return { ...r, payload: JSON.parse(r.payload) } as PsycheEvent;
};

const evidenceOf = (db: Database, id: string) =>
  db.query(`SELECT l.to_id AS id, e.at AS at FROM links l JOIN events e ON e.id = l.to_id WHERE l.from_id = ? AND l.rel = 'evidence'`).all(id) as {
    id: string;
    at: number;
  }[];

/** 版本事件 → 所属条目的 root */
export function rootOf(db: Database, versionId: string): string | null {
  return (db.query(`SELECT root FROM p_shelf_ver WHERE id = ?`).get(versionId) as { root: string } | null)?.root ?? null;
}

export const shelfProjector: Projector = {
  name: "shelf",
  version: 2,
  kinds: ["semantic.proposed", "semantic.revised", "semantic.evidence", "semantic.retired"],
  setup(db) {
    db.run(`CREATE TABLE IF NOT EXISTS p_shelf (
      root        TEXT PRIMARY KEY,
      current     TEXT NOT NULL,
      archive_no  TEXT NOT NULL,
      shelf       TEXT NOT NULL,
      fields      TEXT NOT NULL,            -- JSON：text / when / then / observe / quote / watch
      retired     INTEGER NOT NULL DEFAULT 0,
      n_for       INTEGER NOT NULL DEFAULT 0,
      n_against   INTEGER NOT NULL DEFAULT 0,
      n_irrelevant INTEGER NOT NULL DEFAULT 0,
      last_evidence_at INTEGER,
      at          INTEGER NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS p_shelf_ver (id TEXT PRIMARY KEY, root TEXT NOT NULL)`);
    // 每条条目已计过的证据（同一事件只算一次）
    db.run(`CREATE TABLE IF NOT EXISTS p_shelf_ev (root TEXT NOT NULL, event_id TEXT NOT NULL, stance TEXT NOT NULL, PRIMARY KEY (root, event_id))`);
  },
  reset(db) {
    db.run(`DELETE FROM p_shelf`);
    db.run(`DELETE FROM p_shelf_ver`);
    db.run(`DELETE FROM p_shelf_ev`);
  },
  apply(db, ev: PsycheEvent) {
    if (ev.fonds) return;
    const p = ev.payload as Record<string, any>;
    /**
     * 计数按"几次发生"，不按挂了几行（10-14 Joy 定）：一次判断 = 1 次；首批证据按来自几个会话算。
     * 同一事件对同一条目只登记一次；登记过的不再算。
     */
    const count = (root: string, stance: string, evs: { id: string; at: number }[], times: (fresh: { id: string; at: number }[]) => number) => {
      const fresh = evs.filter((e) => db.query(`INSERT OR IGNORE INTO p_shelf_ev (root, event_id, stance) VALUES (?, ?, ?)`).run(root, e.id, stance).changes);
      const n = fresh.length ? times(fresh) : 0;
      if (!n) return;
      const col = stance === "against" ? "n_against" : stance === "irrelevant" ? "n_irrelevant" : "n_for";
      if (stance === "irrelevant") db.run(`UPDATE p_shelf SET ${col} = ${col} + ? WHERE root = ?`, [n, root]);
      else db.run(`UPDATE p_shelf SET ${col} = ${col} + ?, last_evidence_at = MAX(COALESCE(last_evidence_at, 0), ?) WHERE root = ?`, [n, Math.max(...fresh.map((e) => e.at)), root]);
    };
    const bySessions = (fresh: { id: string }[]) => new Set(fresh.map((e) => sessionOf(db, ev_(db, e.id)) ?? e.id)).size;
    if (ev.kind === "semantic.proposed") {
      const fields = Object.fromEntries(ENTRY_FIELDS.filter((k) => p[k] !== undefined).map((k) => [k, p[k]]));
      db.run(`INSERT INTO p_shelf (root, current, archive_no, shelf, fields, at) VALUES (?, ?, ?, ?, ?, ?)`, [ev.id, ev.id, ev.archiveNo, p.shelf, JSON.stringify(fields), ev.at]);
      db.run(`INSERT INTO p_shelf_ver (id, root) VALUES (?, ?)`, [ev.id, ev.id]);
      count(ev.id, "for", evidenceOf(db, ev.id), bySessions);
      return;
    }
    const root = typeof p.target === "string" ? rootOf(db, p.target) : null;
    if (!root) return;
    if (ev.kind === "semantic.revised") {
      const old = db.query(`SELECT fields FROM p_shelf WHERE root = ?`).get(root) as { fields: string };
      const fields = { ...JSON.parse(old.fields), ...Object.fromEntries(ENTRY_FIELDS.filter((k) => p[k] !== undefined).map((k) => [k, p[k]])) };
      db.run(`UPDATE p_shelf SET current = ?, archive_no = ?, fields = ?, at = ? WHERE root = ?`, [ev.id, ev.archiveNo, JSON.stringify(fields), ev.at, root]);
      db.run(`INSERT INTO p_shelf_ver (id, root) VALUES (?, ?)`, [ev.id, root]);
      // 促成修改的事件只登记（不再当新证据），不计印证
      count(root, "revise", evidenceOf(db, ev.id), () => 0);
    } else if (ev.kind === "semantic.evidence") {
      count(root, String(p.stance), evidenceOf(db, ev.id), () => 1);
    } else if (ev.kind === "semantic.retired") {
      db.run(`UPDATE p_shelf SET retired = 1 WHERE root = ?`, [root]);
    }
  },
};

type Row = {
  root: string;
  current: string;
  archive_no: string;
  shelf: Shelf;
  fields: string;
  retired: number;
  n_for: number;
  n_against: number;
  n_irrelevant: number;
  last_evidence_at: number | null;
  at: number;
};

const toEntry = (r: Row): ShelfEntry => ({
  root: r.root,
  current: r.current,
  archiveNo: r.archive_no,
  shelf: r.shelf,
  ...JSON.parse(r.fields),
  retired: !!r.retired,
  for: r.n_for,
  against: r.n_against,
  irrelevant: r.n_irrelevant,
  lastEvidenceAt: r.last_evidence_at,
  at: r.at,
});

/** 现行条目（不含已作废的，除非 includeRetired）；q 按空白分词，各词都要出现在条目字段里 */
export function readShelf(db: Database, opts: { shelf?: string; q?: string; includeRetired?: boolean } = {}): ShelfEntry[] {
  // 没注册书架投影的库（只用经历的场合）：书架就是空的
  if (!db.query(`SELECT 1 FROM sqlite_master WHERE name = 'p_shelf'`).get()) return [];
  const rows = db
    .query(`SELECT * FROM p_shelf WHERE (? IS NULL OR shelf = ?) ${opts.includeRetired ? "" : "AND retired = 0"} ORDER BY at`)
    .all(opts.shelf ?? null, opts.shelf ?? null) as Row[];
  const terms = (opts.q ?? "").trim().split(/\s+/).filter(Boolean);
  return rows.map(toEntry).filter((e) => {
    if (!terms.length) return true;
    const hay = [e.text, e.when, e.then, e.observe, e.quote, e.about, ...(e.watch ?? [])].filter(Boolean).join("\n");
    return terms.every((t) => hay.includes(t));
  });
}

/** 现行条目里 track 的指标，按人（about）合并 */
export function trackedByPerson(db: Database): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const e of readShelf(db)) {
    if (!e.about || !e.track?.length) continue;
    const s = out.get(e.about) ?? new Set<string>();
    e.track.forEach((k) => s.add(k));
    out.set(e.about, s);
  }
  return out;
}

/** 某条目已计过的证据事件 */
export function countedEvidence(db: Database, root: string): Set<string> {
  return new Set((db.query(`SELECT event_id FROM p_shelf_ev WHERE root = ?`).all(root) as { event_id: string }[]).map((r) => r.event_id));
}

/** 给它看的一行：书架名 + 正文 + 规律的条件/结果 + 计数 */
export const SHELF_NAME: Record<Shelf, string> = { fact: "事实", told: "明说的规矩", rule: "规律", mirror: "镜子", attend: "留意", relation: "关系" };
export function renderEntry(e: ShelfEntry): string {
  const parts = [`（${SHELF_NAME[e.shelf]}${e.about ? ` · ${e.about}` : ""}）${e.text}`];
  if (e.quote) parts.push(`原话：「${e.quote}」`);
  if (e.when) parts.push(`条件：${e.when}`);
  if (e.then) parts.push(`结果：${e.then}`);
  if (e.observe) parts.push(`怎么观察：${e.observe}`);
  if (e.watch?.length) parts.push(`留意：${e.watch.join("、")}`);
  if (e.track?.length) parts.push(`盯着：${e.track.join("、")}`);
  parts.push(`印证 ${e.for} · 反例 ${e.against}${e.irrelevant ? ` · 判无关 ${e.irrelevant}` : ""}${e.retired ? " · 已作废" : ""}`);
  return parts.join("；");
}

/** 单条书架认知的完整演变链与证据明细（GET /v1/shelf/:no，dashboard.md §4.2.3） */
export function shelfDetail(store: EventStore, archiveNo: string) {
  if (!store.db.query(`SELECT 1 FROM sqlite_master WHERE name = 'p_shelf'`).get()) return null;
  const targetEv = store.byArchiveNo(archiveNo.trim().replace(/^\[|\]$/g, ""));
  if (!targetEv) return null;
  const root = rootOf(store.db, targetEv.id);
  if (!root) return null;
  const entry = readShelf(store.db, { includeRetired: true }).find((e) => e.root === root);
  if (!entry) return null;

  const year = Number(localDay(store.now(), store.timeZone).slice(0, 4));
  const showNo = (no: string) => displayArchiveNo(no, year);

  const verIds = (store.db.query(`SELECT id FROM p_shelf_ver WHERE root = ? ORDER BY id`).all(root) as { id: string }[]).map((r) => r.id);
  const versions = verIds
    .map((id) => store.get(id))
    .filter((ev): ev is PsycheEvent => !!ev)
    .map((ev) => {
      const p = ev.payload as Record<string, unknown>;
      const fields = Object.fromEntries(ENTRY_FIELDS.filter((k) => p[k] !== undefined).map((k) => [k, p[k]]));
      return {
        archiveNo: showNo(ev.archiveNo),
        at: ev.at,
        kind: ev.kind,
        ...(typeof p.why === "string" ? { why: p.why } : {}),
        fields,
      };
    });

  // 关联到该 root 的所有 semantic.* 事件（用于取 note 与判定时间）
  const semEvents = store.db
    .query(
      `SELECT id FROM events
       WHERE fonds = '' AND (id IN (SELECT id FROM p_shelf_ver WHERE root = ?)
         OR (kind IN ('semantic.evidence', 'semantic.retired') AND json_extract(payload, '$.target') IN (SELECT id FROM p_shelf_ver WHERE root = ?)))
       ORDER BY id`,
    )
    .all(root, root) as { id: string }[];

  const judgedMeta = new Map<string, { judgedAt: number; note?: string }>();
  for (const { id } of semEvents) {
    const sev = store.get(id);
    if (!sev) continue;
    const p = sev.payload as { note?: string };
    for (const l of store.linksFrom(sev.id)) {
      if (l.rel !== "evidence" || judgedMeta.has(l.to)) continue;
      judgedMeta.set(l.to, { judgedAt: sev.at, ...(typeof p.note === "string" ? { note: p.note } : {}) });
    }
  }

  const evRows = store.db
    .query(`SELECT event_id, stance FROM p_shelf_ev WHERE root = ? ORDER BY rowid`)
    .all(root) as { event_id: string; stance: string }[];

  const evidences = evRows
    .map(({ event_id, stance }) => {
      const ev = store.get(event_id);
      if (!ev) return null;
      const meta = judgedMeta.get(event_id);
      const text = ev.kind === "episode" ? ((ev.payload as { text?: string })?.text ?? "") : (renderExperience(ev) ?? "");
      return {
        archiveNo: showNo(ev.archiveNo),
        at: ev.at,
        stance,
        judgedAt: meta?.judgedAt ?? ev.at,
        ...(meta?.note ? { note: meta.note } : {}),
        text,
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);

  return {
    root,
    currentArchiveNo: showNo(entry.archiveNo),
    shelf: entry.shelf,
    retired: entry.retired,
    versions,
    evidences,
  };
}
