/**
 * 梗概（10-16，notes/design/lib-vs-harness.md「压缩不要摘要，拼它自己写过的」）：天 / 周 / 月，越远越粗。
 *
 * 它睡着时自己写（asleep.ts 的 gist），不是系统摘要——记忆只能由它本人产生。系统只做确定性的事：
 * 算哪些天 / 周 / 月过完了还没写、摆材料（天看那天的情节，周看那周的天，月看那月的周）、校验长度。
 * Soma 换会话时，用它们拼接着往下过的上下文（continuity.ts）。
 *
 * - 天：那天有情节、那天已经过完。周（ISO，周一起）：那周过完、里面有天的梗概。月：那月过完、里面有周或天的梗概。
 * - 同一段可以重写，后写的算数（事件不改）。
 */
import type { EventStore } from "../store/events.ts";
import { localDay } from "../core/time.ts";

export class GistError extends Error {}

export type Span = "day" | "week" | "month";
export const SPANS: Span[] = ["day", "week", "month"];
/** 定长：超了拒，让它自己删 */
export const GIST_LIMIT: Record<Span, number> = { day: 300, week: 500, month: 800 };
export const SPAN_NAME: Record<Span, string> = { day: "天", week: "周", month: "月" };

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const len = (s: string) => Array.from(s).length;

// ── 日历（按本地日期字符串算，不碰时区） ──

const ymd = (day: string) => day.split("-").map(Number) as [number, number, number];
const utc = (day: string) => {
  const [y, m, d] = ymd(day);
  return Date.UTC(y, m - 1, d);
};
const dayOfUtc = (t: number) => new Date(t).toISOString().slice(0, 10);

/** ISO 周：YYYY-Www（周一起） */
export function weekOf(day: string): string {
  const t = utc(day);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // 周一 = 0
  const thursday = t + (3 - dow) * 86_400_000;
  const year = new Date(thursday).getUTCFullYear();
  const jan4 = Date.UTC(year, 0, 4);
  const week1Monday = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * 86_400_000;
  const w = Math.floor((thursday - week1Monday) / (7 * 86_400_000)) + 1;
  return `${year}-W${String(w).padStart(2, "0")}`;
}

/** 那周的最后一天（周日） */
function weekEnd(day: string): string {
  const t = utc(day);
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  return dayOfUtc(t + (6 - dow) * 86_400_000);
}

export const monthOf = (day: string) => day.slice(0, 7);

export function keyOf(span: Span, day: string): string {
  return span === "day" ? day : span === "week" ? weekOf(day) : monthOf(day);
}

/** 那一段的最后一天：过了它才算过完 */
function lastDay(span: Span, day: string): string {
  if (span === "day") return day;
  if (span === "week") return weekEnd(day);
  const [y, m] = ymd(day);
  return dayOfUtc(Date.UTC(y, m, 0));
}

const validKey = (span: Span, key: string) =>
  span === "day" ? /^\d{4}-\d{2}-\d{2}$/.test(key) : span === "week" ? /^\d{4}-W\d{2}$/.test(key) : /^\d{4}-\d{2}$/.test(key);

// ── 读库 ──

export interface Gist {
  span: Span;
  key: string;
  text: string;
  at: number;
}

/** 每段最新的一条 */
export function readGists(store: EventStore): Gist[] {
  const rows = store.db
    .query(
      `SELECT at, json_extract(payload, '$.span') AS span, json_extract(payload, '$.key') AS key, json_extract(payload, '$.text') AS text
       FROM events WHERE kind = 'gist' AND fonds = '' ORDER BY id`,
    )
    .all() as Gist[];
  const latest = new Map<string, Gist>();
  for (const g of rows) latest.set(`${g.span}:${g.key}`, g);
  return [...latest.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export interface EpisodeLine {
  id: string;
  at: number;
  day: string;
  text: string;
}

/** 现行的情节（改写过的取最新），按发生时间排 */
export function currentEpisodes(store: EventStore, sinceDay?: string): EpisodeLine[] {
  const rows = store.db
    .query(
      `SELECT id, at, json_extract(payload, '$.text') AS text FROM events
       WHERE kind = 'episode' AND fonds = '' AND id NOT IN (SELECT to_id FROM links WHERE rel = 'revises')
       ORDER BY at, id`,
    )
    .all() as { id: string; at: number; text: string }[];
  return rows
    .map((r) => ({ ...r, day: localDay(r.at, store.timeZone) }))
    .filter((r) => !sinceDay || r.day >= sinceDay);
}

export interface Pending {
  span: Span;
  key: string;
  /** 写这一段看的东西：天 = 那天的情节，周 = 那周的天，月 = 那月的周（没有就天） */
  source: { label: string; text: string }[];
}

/** 过完了、有东西、还没写的段，天 → 周 → 月（周要等那周的天写完，月要等周） */
export function pendingGists(store: EventStore): Pending[] {
  const today = localDay(store.now(), store.timeZone);
  const have = new Set(readGists(store).map((g) => `${g.span}:${g.key}`));
  const gists = readGists(store);
  const eps = currentEpisodes(store);
  const out: Pending[] = [];

  const days = [...new Set(eps.map((e) => e.day))].filter((d) => d < today);
  for (const d of days) {
    if (have.has(`day:${d}`)) continue;
    out.push({ span: "day", key: d, source: eps.filter((e) => e.day === d).map((e) => ({ label: d, text: e.text })) });
  }
  const dayPending = new Set(out.map((p) => p.key));

  const dayGists = gists.filter((g) => g.span === "day");
  const weeks = new Map<string, string[]>();
  for (const d of days) {
    if (lastDay("week", d) >= today) continue;
    const w = weekOf(d);
    weeks.set(w, [...(weeks.get(w) ?? []), d]);
  }
  for (const [w, ds] of weeks) {
    if (have.has(`week:${w}`) || ds.some((d) => dayPending.has(d))) continue;
    out.push({ span: "week", key: w, source: dayGists.filter((g) => weekOf(g.key) === w).map((g) => ({ label: g.key, text: g.text })) });
  }
  const weekPending = new Set(out.filter((p) => p.span === "week").map((p) => p.key));

  const weekGists = gists.filter((g) => g.span === "week");
  const months = new Map<string, string[]>();
  for (const d of days) {
    if (lastDay("month", d) >= today) continue;
    const m = monthOf(d);
    months.set(m, [...(months.get(m) ?? []), d]);
  }
  for (const [m, ds] of months) {
    if (have.has(`month:${m}`) || ds.some((d) => dayPending.has(d) || weekPending.has(weekOf(d)))) continue;
    // 周跨月时算进它周四所在的月（ISO）；没有周的梗概就看天的
    const ws = weekGists.filter((g) => ds.some((d) => weekOf(d) === g.key));
    const source = ws.length ? ws.map((g) => ({ label: g.key, text: g.text })) : dayGists.filter((g) => monthOf(g.key) === m).map((g) => ({ label: g.key, text: g.text }));
    out.push({ span: "month", key: m, source });
  }
  return out;
}

// ── 写 ──

export function writeGist(store: EventStore, body: Record<string, unknown>, promptVersion?: number) {
  const { span, key, text } = body;
  if (!SPANS.includes(span as Span)) throw new GistError(`span 只能是 ${SPANS.join(" / ")}`);
  const s = span as Span;
  if (!nonEmpty(key) || !validKey(s, key.trim())) throw new GistError(`key 不对：${s === "day" ? "YYYY-MM-DD" : s === "week" ? "YYYY-Www" : "YYYY-MM"}`);
  if (!nonEmpty(text)) throw new GistError("text 不能是空的");
  const t = text.trim();
  if (len(t) > GIST_LIMIT[s]) throw new GistError(`${SPAN_NAME[s]}的梗概最多 ${GIST_LIMIT[s]} 字，这段 ${len(t)} 字，删一删再交`);
  const k = key.trim();
  const today = localDay(store.now(), store.timeZone);
  const anchor = s === "day" ? k : s === "month" ? `${k}-01` : null;
  // 周：key 本身不好反推日期，只要求是过去的周（不晚于本周）
  if (anchor ? lastDay(s, anchor) >= today : k >= weekOf(today)) throw new GistError(`${k} 还没过完，过完了再写`);
  const ev = store.append({
    kind: "gist",
    class: "self",
    source: "agent",
    producer: `gist${promptVersion ? `@${promptVersion}` : ""}`,
    payload: { span: s, key: k, text: t },
  });
  return { id: ev.id, span: s, key: k };
}
