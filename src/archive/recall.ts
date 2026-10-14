/**
 * recall（m1.md §四）：在经历投影的可见行（未被覆盖的原话 + 情节）里全文检索。
 *
 * FTS5 trigram 按三字一组切，中英文都能查；但少于 3 个字的词切不出来，这时退回 LIKE。
 * 查询按空白分词，各词都要命中。FTS 按相关度再按时间（新的在前）排；LIKE 没有相关度，只按时间。
 *
 * 不搜回声（10-14 验收时撞上）：
 *   - 自己动用记忆的那几行（「我翻了翻记忆，找『X』」「我把这一段写成了 N 条情节」）——查什么就命中什么；
 *   - 给了 session 时，这个会话最后一条 message.in 及之后：就是这一轮刚问的话，本来就在上下文里。
 */
import type { Database } from "bun:sqlite";
import { hasFts } from "./experience.ts";

export interface RecallQuery {
  q: string;
  from?: number;
  to?: number;
  limit?: number;
  /** 当前会话：它这一轮的行不搜 */
  session?: string;
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

/** 记忆工具的调用行：Psyche 自己的 MCP 工具，或考卷样本里不带前缀的热写 */
const NOT_MEMORY_TOOL = `NOT (p.kind = 'tool.call' AND EXISTS (SELECT 1 FROM events e WHERE e.id = p.event_id
  AND (json_extract(e.payload, '$.name') LIKE 'mcp\\_\\_psyche\\_\\_%' ESCAPE '\\'
       OR json_extract(e.payload, '$.name') IN ('hotwrite', 'hotwrite_segment'))))`;

/** 这一轮从哪条开始：该会话最后一条 message.in 的 id；没有就不排除 */
function turnStart(db: Database, session?: string): string {
  if (!session) return "\uffff";
  const r = db.query(`SELECT MAX(event_id) AS id FROM p_experience WHERE session = ? AND kind = 'message.in'`).get(session) as { id: string | null } | null;
  return r?.id ?? "\uffff";
}

export function recall(db: Database, query: RecallQuery): RecallLine[] {
  const ts = terms(query.q);
  if (!ts.length) return [];
  const limit = Math.min(Math.max(1, query.limit ?? RECALL_LIMIT), RECALL_MAX);
  const range = [query.from ?? 0, query.to ?? Number.MAX_SAFE_INTEGER];
  const turn = turnStart(db, query.session);
  const visible = `p.covered = 0 AND p.at >= ? AND p.at < ? AND ${NOT_MEMORY_TOOL} AND NOT (p.session IS ? AND p.event_id >= ?)`;
  const args = [...range, query.session ?? null, turn];
  const rows = usesFts(db, query.q)
    ? db
        .query(
          `SELECT p.event_id, p.archive_no, p.at, p.kind, p.text FROM p_experience_fts f
           JOIN p_experience p ON p.rid = f.rowid
           WHERE p_experience_fts MATCH ? AND ${visible}
           ORDER BY bm25(p_experience_fts), p.at DESC, p.event_id DESC LIMIT ?`,
        )
        .all(ts.map((t) => `"${t.replaceAll('"', '""')}"`).join(" AND "), ...args, limit)
    : db
        .query(
          `SELECT p.event_id, p.archive_no, p.at, p.kind, p.text FROM p_experience p
           WHERE ${ts.map(() => `p.text LIKE ? ESCAPE '\\'`).join(" AND ")} AND ${visible}
           ORDER BY p.at DESC, p.event_id DESC LIMIT ?`,
        )
        .all(...ts.map((t) => `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`), ...args, limit);
  return (rows as { event_id: string; archive_no: string; at: number; kind: string; text: string }[]).map((r) => ({
    eventId: r.event_id,
    archiveNo: r.archive_no,
    at: r.at,
    kind: r.kind,
    text: r.text,
  }));
}
