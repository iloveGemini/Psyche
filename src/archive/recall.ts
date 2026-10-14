/**
 * recall（m1.md §四）：在经历投影的可见行（未被覆盖的原话 + 情节）里全文检索。
 *
 * FTS5 trigram 按三字一组切，中英文都能查；但少于 3 个字的词切不出来，这时退回 LIKE。
 * 查询按空白分词，各词都要命中。FTS 按相关度再按时间（新的在前）排；LIKE 没有相关度，只按时间。
 */
import type { Database } from "bun:sqlite";
import { hasFts } from "./experience.ts";

export interface RecallQuery {
  q: string;
  from?: number;
  to?: number;
  limit?: number;
}

export interface RecallLine {
  eventId: string;
  archiveNo: string;
  at: number;
  kind: string;
  text: string;
}

export const RECALL_LIMIT = 20;
export const RECALL_MAX = 200;

const terms = (q: string) => q.trim().split(/\s+/).filter(Boolean);
/** 按字算长度（不是 UTF-16 码元） */
const chars = (s: string) => Array.from(s).length;

/** 能不能走 FTS：有虚表，且每个词至少 3 个字 */
export function usesFts(db: Database, q: string): boolean {
  const ts = terms(q);
  return hasFts(db) && ts.length > 0 && ts.every((t) => chars(t) >= 3);
}

export function recall(db: Database, query: RecallQuery): RecallLine[] {
  const ts = terms(query.q);
  if (!ts.length) return [];
  const limit = Math.min(Math.max(1, query.limit ?? RECALL_LIMIT), RECALL_MAX);
  const range = [query.from ?? 0, query.to ?? Number.MAX_SAFE_INTEGER];
  const rows = usesFts(db, query.q)
    ? db
        .query(
          `SELECT p.event_id, p.archive_no, p.at, p.kind, p.text FROM p_experience_fts f
           JOIN p_experience p ON p.rid = f.rowid
           WHERE p_experience_fts MATCH ? AND p.covered = 0 AND p.at >= ? AND p.at < ?
           ORDER BY bm25(p_experience_fts), p.at DESC, p.event_id DESC LIMIT ?`,
        )
        .all(ts.map((t) => `"${t.replaceAll('"', '""')}"`).join(" AND "), ...range, limit)
    : db
        .query(
          `SELECT event_id, archive_no, at, kind, text FROM p_experience
           WHERE ${ts.map(() => `text LIKE ? ESCAPE '\\'`).join(" AND ")} AND covered = 0 AND at >= ? AND at < ?
           ORDER BY at DESC, event_id DESC LIMIT ?`,
        )
        .all(...ts.map((t) => `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`), ...range, limit);
  return (rows as { event_id: string; archive_no: string; at: number; kind: string; text: string }[]).map((r) => ({
    eventId: r.event_id,
    archiveNo: r.archive_no,
    at: r.at,
    kind: r.kind,
    text: r.text,
  }));
}
