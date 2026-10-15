/**
 * `<now>`（m1.md §四）：每轮开头注入的一小段事实。只陈述，不用它的口吻。
 *
 * 全部读时算（与时间相关的不存，projections.ts 原则 2）。
 */
import type { EventStore } from "../store/events.ts";
import { wallClock } from "../core/time.ts";
import { readSegment, resolveSession } from "../catalog/hotwrite.ts";

const pad = (n: number) => String(n).padStart(2, "0");

/** 本地时间：同年省略年份（`10-14 09:30`），跨年带上 */
function stamp(at: number, timeZone: string, refYear: number): string {
  const w = wallClock(at, timeZone);
  return `${w.year === refYear ? "" : `${w.year}-`}${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)}`;
}

/** 多久前：分钟 / 小时 / 天，取整 */
export function ago(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

export function renderNow(store: EventStore, session?: string): string {
  const now = store.now();
  const tz = store.timeZone;
  const w = wallClock(now, tz);
  const lines = [`现在：${w.year}-${pad(w.month)}-${pad(w.day)} ${w.weekday} ${pad(w.hour)}:${pad(w.minute)}`];

  const sit = store.situation?.payload as { harness?: string; session?: string } | undefined;
  let s: string | null = null;
  try {
    s = resolveSession(store, session);
  } catch {
    // 没有会话：不报会话起点和未写条数
  }
  if (sit?.harness) {
    const start = s
      ? (store.db
          .query(`SELECT MIN(at) AS at FROM events WHERE class = 'situation' AND fonds = '' AND json_extract(payload, '$.session') = ?`)
          .get(s) as { at: number | null }).at
      : null;
    lines.push(`在：${sit.harness}${start !== null ? `，本会话从 ${stamp(start, tz, w.year)} 起` : ""}`);
  }

  // 最近一条 message.in 是这一轮正在说的话；"上次"是它之前那条。翻开过的来信也算有人找我（m6.md §六），取两者较晚的
  const prevMsg = store.db
    .query(`SELECT json_extract(payload, '$.from') AS who, at FROM events WHERE kind = 'message.in' AND fonds = '' ORDER BY at DESC, id DESC LIMIT 1 OFFSET 1`)
    .get() as { who: string; at: number } | null;
  const lastMail = store.db
    // 只算翻开过的：没看的信在收件箱那行，勿扰挡着的不该从这里漏出来
    .query(
      `SELECT json_extract(e.payload, '$.from') AS who, e.at FROM events e WHERE e.kind = 'mail.in' AND e.fonds = ''
         AND EXISTS (SELECT 1 FROM events r, json_each(json_extract(r.payload, '$.refs')) j WHERE r.kind = 'mail.read' AND r.fonds = '' AND j.value = e.id)
       ORDER BY e.at DESC, e.id DESC LIMIT 1`,
    )
    .get() as { who: string; at: number } | null;
  const prev = lastMail && (!prevMsg || lastMail.at > prevMsg.at) ? { ...lastMail, mail: true } : prevMsg;
  if (prev) lines.push(`上次有人跟我说话：${prev.who}，${ago(now - prev.at)}${"mail" in prev ? "（来信）" : ""}`);

  if (s) lines.push(`还没写进记忆的：${readSegment(store, s).lines.length} 条`);
  return `<now>\n${lines.join("\n")}\n</now>`;
}
