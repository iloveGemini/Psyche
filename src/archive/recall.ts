/**
 * recall（m1.md §四）：在经历投影的可见行（未被覆盖的原话 + 情节）里全文检索。
 *
 * FTS5 trigram 按三字一组切，中英文都能查；但少于 3 个字的词切不出来，这时退回 LIKE。
 * 查询按空白分词，各词都要命中。FTS 按相关度再按时间（新的在前）排；LIKE 没有相关度，只按时间。
 *
 * 混合检索（10-14，m3.md）：配了嵌入服务时，字面一份、向量一份，按名次合并（RRF）。字面管准（人名、表名、两个字的词），
 * 向量管意思相近、用词不同。没配就只有字面。
 *
 * 不搜回声（10-14 验收时撞上）：
 *   - 自己动用记忆的那几行（「我翻了翻记忆，找『X』」「我看了看自己的书架」）——查什么就命中什么；
 *   - 给了 session 时，这个会话最后一条 message.in 及之后：就是这一轮刚问的话，本来就在上下文里。
 */
import type { Database } from "bun:sqlite";
import { hasFts } from "./experience.ts";
import { cosine, fromBlob, syncVectors, vectorOf, type Embedder } from "./vectors.ts";
import { keywords } from "../core/words.ts";
import { readShelf, renderEntry, type ShelfEntry } from "../reading/shelf.ts";

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
export const NOT_MEMORY_TOOL = `NOT (p.kind = 'tool.call' AND EXISTS (SELECT 1 FROM events e WHERE e.id = p.event_id
  AND (json_extract(e.payload, '$.name') LIKE 'mcp\\_\\_psyche\\_\\_%' ESCAPE '\\'
       OR json_extract(e.payload, '$.name') IN ('hotwrite', 'hotwrite_segment'))))`;

/** 这一轮从哪条开始：该会话最后一条 message.in 的 id；没有就不排除 */
function turnStart(db: Database, session?: string): string {
  if (!session) return "\uffff";
  const r = db.query(`SELECT MAX(event_id) AS id FROM p_experience WHERE session = ? AND kind = 'message.in'`).get(session) as { id: string | null } | null;
  return r?.id ?? "\uffff";
}

/** 可见行的条件与参数：没被覆盖、在时间范围内、不是记忆工具行、不是本会话这一轮 */
function visibility(db: Database, query: Omit<RecallQuery, "q">): { sql: string; args: (string | number | null)[] } {
  return {
    sql: `p.covered = 0 AND p.at >= ? AND p.at < ? AND ${NOT_MEMORY_TOOL} AND NOT (p.session IS ? AND p.event_id >= ?)`,
    args: [query.from ?? 0, query.to ?? Number.MAX_SAFE_INTEGER, query.session ?? null, turnStart(db, query.session)],
  };
}

type Row = { event_id: string; archive_no: string; at: number; kind: string; text: string };
const toLine = (r: Row): RecallLine => ({ eventId: r.event_id, archiveNo: r.archive_no, at: r.at, kind: r.kind, text: r.text });

/** 向量那一份：可见行里与 qvec 余弦最高的前 limit 条（暴力算，几万条以内够快） */
export function semanticRecall(db: Database, qvec: Float32Array, model: string, query: Omit<RecallQuery, "q">, limit: number): (RecallLine & { cos: number })[] {
  const v = visibility(db, query);
  const rows = db
    .query(
      `SELECT p.event_id, p.archive_no, p.at, p.kind, p.text, v.vec FROM p_experience p
       JOIN p_vec v ON v.ref = p.event_id AND v.model = ?
       WHERE p.class <> 'situation' AND ${v.sql}`,
    )
    .all(model, ...v.args) as (Row & { vec: Uint8Array })[];
  return rows
    .map((r) => ({ ...toLine(r), cos: cosine(qvec, fromBlob(r.vec)) }))
    .sort((a, b) => b.cos - a.cos)
    .slice(0, limit);
}

/** 按名次合并：score = Σ 1/(K + 名次)。两边都靠前的排最前 */
export function rrf<T extends { eventId: string }>(lists: T[][], limit: number, K = 60): T[] {
  const score = new Map<string, { item: T; s: number }>();
  for (const list of lists)
    list.forEach((item, i) => {
      const cur = score.get(item.eventId) ?? { item, s: 0 };
      cur.s += 1 / (K + i + 1);
      score.set(item.eventId, cur);
    });
  return [...score.values()].sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.item);
}

/** 嵌入服务卡住时最多等多久（10-19：一次 recall 等了 13 秒，连接被掐断；本地检索本身只要几十毫秒） */
export const QUERY_VECTOR_TIMEOUT_MS = 5_000;

/** 查询的向量：先补齐库里的向量；没配、失败或超时 = null（只用字面；超时后补向量在后台接着跑） */
export async function queryVector(db: Database, embedder: Embedder | undefined, q: string, timeoutMs = QUERY_VECTOR_TIMEOUT_MS): Promise<Float32Array | null> {
  if (!embedder || !q.trim()) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const embedTask = (async () => {
      await syncVectors(db, embedder);
      return (await embedder.embed([q]))[0];
    })();
    const timeoutTask = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`超时（>${timeoutMs}ms）`)), timeoutMs);
    });
    embedTask.catch(() => {}); // 超时后它再出错，不要变成未处理的 rejection
    return await Promise.race([embedTask, timeoutTask]);
  } catch (e) {
    console.error(`向量检索失败，只用字面：${e instanceof Error ? e.message : e}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 混合检索：字面一份、向量一份（有的话），按名次合并 */
export async function hybridRecall(db: Database, embedder: Embedder | undefined, query: RecallQuery, qvec?: Float32Array | null): Promise<RecallLine[]> {
  const limit = Math.min(Math.max(1, query.limit ?? RECALL_LIMIT), RECALL_MAX);
  const lexical = recall(db, { ...query, limit });
  const v = qvec === undefined ? await queryVector(db, embedder, query.q) : qvec;
  if (!v || !embedder) return lexical;
  return rrf([lexical, semanticRecall(db, v, embedder.model, query, limit)], limit);
}

export const SHELF_LIMIT = 5;

/**
 * 书架上的条目（10-14 改）：查询里的实词任一出现、或向量够近，就算命中——原来要求每个词都出现，
 * "得分 积分 记一分"翻不到"Joy 9 分"那条。每条带上依据的档号，想回到现场可以顺着 detail 过去。
 */
export function shelfRecall(db: Database, q: string, qvec: Float32Array | null, model: string | null, limit = SHELF_LIMIT): (ShelfEntry & { evidence: string[] })[] {
  const entries = readShelf(db);
  if (!entries.length) return []; // 没注册书架投影的库，或者书架是空的
  const ks = keywords(q);
  const terms = ks.length ? ks : q.trim().split(/\s+/).filter(Boolean);
  const scored = entries.flatMap((e) => {
    // keywords 把英文转了小写，这边也转（10-17 a2 报：搜 Echore 翻不到写着 Echore 的条目）
    const hay = [e.text, e.when, e.then, e.observe, e.quote, ...(e.watch ?? [])].filter(Boolean).join("\n").toLowerCase();
    const lex = terms.length ? terms.filter((t) => hay.includes(t.toLowerCase())).length / terms.length : 0;
    const v = qvec && model ? vectorOf(db, e.current, model) : null;
    const cos = v && qvec ? cosine(qvec, v) : 0;
    const score = lex + Math.max(0, (cos - 0.55) / 0.25);
    return lex > 0 || cos >= 0.6 ? [{ e, score }] : [];
  });
  const evidence = db.query(
    // 前世编目所引的原话登记为 past，档号带全宗
    `SELECT CASE ev.fonds WHEN '' THEN '' ELSE ev.fonds || '/' END || ev.day || '#' || ev.seq AS no FROM p_shelf_ev s JOIN events ev ON ev.id = s.event_id
     WHERE s.root = ? AND s.stance IN ('for', 'against', 'past') ORDER BY ev.at DESC LIMIT 6`,
  );
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ e }) => ({ ...e, evidence: (evidence.all(e.root) as { no: string }[]).map((r) => r.no) }));
}

/** recall 里书架那一行：条目 + 依据 */
export const renderShelfHit = (e: ShelfEntry & { evidence: string[] }, show: (no: string) => string) =>
  renderEntry(e) + (e.evidence.length ? `；依据：${e.evidence.map(show).join("、")}` : "");

export function recall(db: Database, query: RecallQuery): RecallLine[] {
  const ts = terms(query.q);
  if (!ts.length) return [];
  const limit = Math.min(Math.max(1, query.limit ?? RECALL_LIMIT), RECALL_MAX);
  const { sql: visible, args } = visibility(db, query);
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
  return (rows as Row[]).map(toLine);
}
