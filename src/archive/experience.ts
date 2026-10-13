/**
 * 经历投影（archive.md §三）：它的记忆本身。
 *
 * 两段式：
 *   近期经历 = 上次做梦之后的事件，模板逐条渲染，接近原话（本文件）；
 *   已整理经历 = 编目写的分场叙述 + 角标（编目做好后接进来，scene 事件驱动）。
 * 现在还没有编目，所以全部是"近期"。
 *
 * 只收它自己的全宗；导入的旧卷宗不是它的经历（前世不算经历，archive.md §四）。
 */
import type { Database } from "bun:sqlite";
import type { Projector } from "../store/projections.ts";
import { renderExperience } from "./render.ts";

export const experienceProjector: Projector = {
  name: "experience",
  version: 1,
  setup(db: Database) {
    db.run(`CREATE TABLE IF NOT EXISTS p_experience (
      event_id   TEXT PRIMARY KEY,
      at         INTEGER NOT NULL,
      archive_no TEXT NOT NULL,
      kind       TEXT NOT NULL,
      class      TEXT NOT NULL,
      situation  TEXT,
      text       TEXT NOT NULL
    )`);
    db.run(`CREATE INDEX IF NOT EXISTS p_experience_at ON p_experience(at)`);
  },
  reset(db: Database) {
    db.run(`DELETE FROM p_experience`);
  },
  apply(db: Database, ev) {
    if (ev.fonds) return;
    const text = renderExperience(ev);
    if (text === null) return;
    db.run(`INSERT INTO p_experience (event_id, at, archive_no, kind, class, situation, text) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
      ev.id,
      ev.at,
      ev.archiveNo,
      ev.kind,
      ev.class,
      ev.situation,
      text,
    ]);
  },
};

export interface ExperienceLine {
  eventId: string;
  at: number;
  archiveNo: string;
  kind: string;
  text: string;
}

/** 按发生时间排（档号序号按入库顺序，展示按 at，events.md §五） */
export function readExperience(db: Database, opts: { from?: number; to?: number; limit?: number } = {}): ExperienceLine[] {
  const rows = db
    .query(
      `SELECT event_id, at, archive_no, kind, text FROM p_experience
       WHERE at >= ? AND at < ? ORDER BY at, event_id LIMIT ?`,
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
