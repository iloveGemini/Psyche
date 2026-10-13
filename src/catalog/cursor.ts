/**
 * 待编目游标（catalog.md §三）：每道工序独立游标，哪道失败只重跑哪道。
 *
 * 游标是编目的进度，不是真相：丢了最多重跑一遍，产出的梦事件按幂等键不会重复。
 */
import type { Database } from "bun:sqlite";

export function ensureCursorTable(db: Database) {
  db.run(`CREATE TABLE IF NOT EXISTS catalog_cursors (stage TEXT PRIMARY KEY, last_id TEXT NOT NULL)`);
}

export function getCursor(db: Database, stage: string): string {
  ensureCursorTable(db);
  return (db.query(`SELECT last_id FROM catalog_cursors WHERE stage = ?`).get(stage) as { last_id: string } | null)?.last_id ?? "";
}

export function setCursor(db: Database, stage: string, lastId: string) {
  ensureCursorTable(db);
  db.query(`INSERT INTO catalog_cursors (stage, last_id) VALUES (?, ?) ON CONFLICT (stage) DO UPDATE SET last_id = excluded.last_id`).run(stage, lastId);
}
