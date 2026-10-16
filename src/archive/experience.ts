/**
 * 经历投影（archive.md §三）：它的记忆本身。
 *
 * 两段式：
 *   近期经历 = 还没热写的段，模板逐条渲染，接近原话（render.ts）；
 *   已整理经历 = 它热写的情节条目（episode），替换所写的那段原话（m1.md §三）。
 * 情节到达时，同会话、id ≤ upTo 的原话行标 covered：原件还在库房，只是默认不再展示。
 *
 * 只收它自己的全宗；导入的旧卷宗不是它的经历（前世不算经历，archive.md §四）。
 * 全文检索用 FTS5 trigram 虚表，随投影一起维护；SQLite 不支持时不建，recall 退回 LIKE。
 */
import type { Database } from "bun:sqlite";
import type { PsycheEvent } from "../store/events.ts";
import type { Projector } from "../store/projections.ts";
import { mailInText, renderExperience } from "./render.ts";

const FTS = "p_experience_fts";
const ftsOf = new WeakMap<Database, boolean>();

/** 这个库有没有 FTS 虚表（setup 时建不出来就没有） */
export function hasFts(db: Database): boolean {
  let has = ftsOf.get(db);
  if (has === undefined) ftsOf.set(db, (has = !!db.query(`SELECT 1 FROM sqlite_master WHERE name = ?`).get(FTS)));
  return has;
}

/** 事件属于哪个会话：情节自己记着；处境看自己的 payload；其余经所挂处境查 */
export function sessionOf(db: Database, ev: PsycheEvent): string | null {
  const p = ev.payload as Record<string, unknown>;
  if (ev.kind === "episode" || ev.class === "situation") return typeof p.session === "string" ? p.session : null;
  if (!ev.situation) return null;
  const r = db.query(`SELECT json_extract(payload, '$.session') AS s FROM events WHERE id = ?`).get(ev.situation) as { s: unknown } | null;
  return typeof r?.s === "string" ? r.s : null;
}

/** 情节的正文：有感受时接一句（当时：…） */
export function episodeText(p: { text: string; felt?: string }): string {
  return p.felt ? `${p.text}（当时：${p.felt}）` : p.text;
}

export const experienceProjector: Projector = {
  name: "experience",
  version: 9,
  setup(db: Database) {
    // 旧版表没有 session / covered：派生数据，直接丢掉，版本号变了会重放
    const cols = db.query(`PRAGMA table_info(p_experience)`).all() as { name: string }[];
    if (cols.length && !cols.some((c) => c.name === "covered")) db.run(`DROP TABLE p_experience`);
    db.run(`CREATE TABLE IF NOT EXISTS p_experience (
      rid        INTEGER PRIMARY KEY,
      event_id   TEXT NOT NULL UNIQUE,
      at         INTEGER NOT NULL,
      archive_no TEXT NOT NULL,
      kind       TEXT NOT NULL,
      class      TEXT NOT NULL,
      situation  TEXT,
      session    TEXT,
      covered    INTEGER NOT NULL DEFAULT 0,
      text       TEXT NOT NULL
    )`);
    db.run(`CREATE INDEX IF NOT EXISTS p_experience_at ON p_experience(at)`);
    db.run(`CREATE INDEX IF NOT EXISTS p_experience_session ON p_experience(session, event_id)`);
    try {
      db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS ${FTS} USING fts5(text, tokenize = 'trigram')`);
    } catch {
      // 没有 FTS5 或 trigram：recall 退回 LIKE
    }
    ftsOf.delete(db);
  },
  reset(db: Database) {
    db.run(`DELETE FROM p_experience`);
    if (hasFts(db)) db.run(`DELETE FROM ${FTS}`);
  },
  apply(db: Database, ev) {
    if (ev.fonds) return;
    const p = ev.payload as Record<string, any>;
    const text = ev.kind === "episode" ? episodeText(p as { text: string; felt?: string }) : renderExperience(ev);
    if (text === null) return;
    const session = sessionOf(db, ev);
    const { rid } = db
      .query(
        `INSERT INTO p_experience (event_id, at, archive_no, kind, class, situation, session, text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING rid`,
      )
      .get(ev.id, ev.at, ev.archiveNo, ev.kind, ev.class, ev.situation, session, text) as { rid: number };
    if (hasFts(db)) db.run(`INSERT INTO ${FTS} (rowid, text) VALUES (?, ?)`, [rid, text]);
    // 情节替换它所写的那段原话：同会话、id ≤ upTo 的原话行不再默认展示（处境行不算段内）
    if (ev.kind === "episode" && session && typeof p.upTo === "string")
      db.run(
        `UPDATE p_experience SET covered = 1
         WHERE session = ? AND event_id <= ? AND kind <> 'episode' AND class <> 'situation'`,
        [session, p.upTo],
      );
    // 翻开了信：那封来信的行换成全文（之前只说有信）；旧向量按"还没看"算的，删掉重算
    if (ev.kind === "mail.read")
      for (const id of (p.refs ?? []) as string[]) {
        const src = db.query(`SELECT kind, payload FROM events WHERE id = ?`).get(id) as { kind: string; payload: string } | null;
        if (src?.kind !== "mail.in") continue;
        const row = db.query(`UPDATE p_experience SET text = ? WHERE event_id = ? RETURNING rid, text`).get(mailInText(JSON.parse(src.payload), true), id) as { rid: number; text: string } | null;
        if (!row) continue;
        if (hasFts(db)) {
          db.run(`DELETE FROM ${FTS} WHERE rowid = ?`, [row.rid]);
          db.run(`INSERT INTO ${FTS} (rowid, text) VALUES (?, ?)`, [row.rid, row.text]);
        }
        if (db.query(`SELECT 1 FROM sqlite_master WHERE name = 'p_vec'`).get()) db.run(`DELETE FROM p_vec WHERE ref = ?`, [id]);
      }
    // 改写：旧的那版不再默认展示
    if (ev.kind === "episode")
      db.run(
        `UPDATE p_experience SET covered = 1 WHERE event_id IN (SELECT to_id FROM links WHERE from_id = ? AND rel = 'revises')`,
        [ev.id],
      );
  },
};

export interface ExperienceLine {
  eventId: string;
  at: number;
  archiveNo: string;
  kind: string;
  text: string;
}

/** 按发生时间排（档号序号按入库顺序，展示按 at，events.md §五）。默认只给未被覆盖的行 + 情节 */
export function readExperience(
  db: Database,
  opts: { from?: number; to?: number; limit?: number; includeCovered?: boolean } = {},
): ExperienceLine[] {
  const rows = db
    .query(
      `SELECT event_id, at, archive_no, kind, text FROM p_experience
       WHERE at >= ? AND at < ? ${opts.includeCovered ? "" : "AND covered = 0"} ORDER BY at, event_id LIMIT ?`,
    )
    .all(opts.from ?? 0, opts.to ?? Number.MAX_SAFE_INTEGER, opts.limit ?? 500) as {
    event_id: string;
    at: number;
    archive_no: string;
    kind: string;
    text: string;
  }[];
  return rows.map((r) => ({ eventId: r.event_id, at: r.at, archiveNo: r.archive_no, kind: r.kind, text: r.text }));
}
