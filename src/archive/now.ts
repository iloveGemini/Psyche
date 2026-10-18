/**
 * `<now>`（m1.md §四）：每轮开头注入的一小段事实。只陈述，不用它的口吻。
 *
 * 全部读时算（与时间相关的不存，projections.ts 原则 2）。
 */
import type { EventStore } from "../store/events.ts";
import { wallClock } from "../core/time.ts";
import { readSegment, resolveSession, segmentEvents } from "../catalog/hotwrite.ts";
import { pendingGists } from "../catalog/gist.ts";
import { NOT_PLACE_SQL } from "../channel/inbox.ts";
import { shelfWarnings } from "../reading/shelf.ts";

const pad = (n: number) => String(n).padStart(2, "0");
const IDLE_MS = 3 * 3600_000;
const DAY_MS = 86_400_000;
const TIDY_EPISODES = 5;
const RUN_LABEL: Record<string, string> = { catchup: "补写", tidy: "整理", gist: "梗概", birth: "出生" };

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

  let s: string | null = null;
  try {
    s = resolveSession(store, session);
  } catch {
    // 没有会话：不报会话起点和未写条数
  }
  // 取 <now> 的那个会话在哪；没给会话才用全局当前处境（几个地方同时跑时全局的会被顶掉）
  const own = s ? store.situationOfSession(s, now) : null;
  const sit = ((own ? store.get(own) : store.situation)?.payload) as { harness?: string; session?: string } | undefined;
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
  if (prev) lines.push(`上次有人跟我说话：${prev.who}，${ago(now - prev.at)}${"mail" in prev ? "（来信，看过了）" : ""}`);

  if (s) lines.push(`还没写进记忆的：${readSegment(store, s).lines.length} 条`);
  return `<now>\n${lines.join("\n")}\n</now>`;
}

/**
 * 备考表（<now> 的一行）：代码实时扫描记忆库中的断层（GAP）、后台失败（FAILED）与待整理变动；
 * 正常时返回 null，有缺口或变动时实时显示，补齐或整理完下一轮自动消失。
 */
export function noteSheetLine(store: EventStore, session?: string): string | null {
  const now = store.now();
  const tz = store.timeZone;
  const w = wallClock(now, tz);
  const items: string[] = [];

  let curSession: string | null = null;
  try {
    curSession = resolveSession(store, session);
  } catch {
    // 无活跃会话
  }
  const curStart = curSession
    ? (
        store.db
          .query(`SELECT MIN(at) AS at FROM events WHERE class = 'situation' AND fonds = '' AND json_extract(payload, '$.session') = ?`)
          .get(curSession) as { at: number | null }
      ).at
    : null;

  // 1. 记忆断层（GAP）：非当前会话的旧会话还有未写进 episode 的经历行
  const sessionRows = store.db
    .query(
      `SELECT DISTINCT json_extract(s.payload, '$.session') AS s
       FROM events s
       WHERE s.class = 'situation' AND s.fonds = '' AND ${NOT_PLACE_SQL}
         AND json_extract(s.payload, '$.session') IS NOT NULL`,
    )
    .all() as { s: string }[];
  let oldSessions = 0;
  let oldLines = 0;
  for (const { s: other } of sessionRows) {
    if (other === curSession) continue;
    const evs = segmentEvents(store, other);
    if (!evs.length) continue;
    const lastAt = Math.max(...evs.map((e) => e.at));
    if ((curStart !== null && lastAt <= curStart) || now - lastAt >= IDLE_MS) {
      const n = readSegment(store, other).lines.length;
      if (n > 0) {
        oldSessions++;
        oldLines += n;
      }
    }
  }
  if (oldSessions > 0) items.push(`未写情节的旧会话 ${oldSessions} 段（共 ${oldLines} 条）`);

  // 2. 梗概缺口（GAP）：过完了还没写梗概的天 / 周 / 月
  const pending = pendingGists(store);
  if (pending.length > 0) {
    const keys = pending.slice(0, 3).map((p) => p.key).join("、");
    items.push(`待写梗概：${keys}${pending.length > 3 ? ` 等 ${pending.length} 段` : ""}`);
  }

  // 3. 后台睡眠任务异常（FAILED）：最近一次 tidy / gist / catchup 出错或未提交且尚未恢复
  const runs = (
    store.db.query(`SELECT at, detail FROM system_log WHERE kind = 'wake.run' ORDER BY id`).all() as { at: number; detail: string }[]
  ).map((r) => ({ at: r.at, ...(JSON.parse(r.detail) as { key: string; ms?: number; error?: string; produced?: Record<string, number> }) }));
  const latestByKind = new Map<string, (typeof runs)[number]>();
  for (const r of runs) {
    const by = r.key.split(":")[0];
    if (by === "tidy" || by === "gist" || by === "catchup") latestByKind.set(by, r);
  }
  const lastColdDone = store.db
    .query(`SELECT id, at FROM events WHERE kind = 'coldwrite.done' AND fonds = '' ORDER BY id DESC LIMIT 1`)
    .get() as { id: string; at: number } | null;

  for (const [by, r] of latestByKind) {
    const label = RUN_LABEL[by] ?? by;
    if (r.error) {
      if (by === "tidy" && lastColdDone && lastColdDone.at >= r.at) continue;
      if (by === "gist" && pending.length === 0) continue;
      if (by === "catchup") {
        const sess = r.key.split(":")[1];
        if (sess && readSegment(store, sess).lines.length === 0) continue;
      }
      items.push(`后台${label}失败于 ${stamp(r.at, tz, w.year)}`);
    } else if (by === "tidy" && (r.produced?.shelf ?? 0) === 0 && (!lastColdDone || lastColdDone.at < r.at - (r.ms ?? 0) - 5_000)) {
      items.push(`后台${label}未交回（${stamp(r.at, tz, w.year)}）`);
    }
  }

  // 4. 连续静默缺口（GAP）：最近 7 天内相邻对话间隔 ≥ 24h
  const recentTalks = store.db
    .query(
      `SELECT at FROM events
       WHERE fonds = '' AND kind IN ('message.in', 'message.out', 'mail.in') AND at >= ?
       ORDER BY at ASC, id ASC`,
    )
    .all(now - 7 * DAY_MS) as { at: number }[];
  let lastGap: { from: number; to: number; hours: number } | null = null;
  for (let i = 1; i < recentTalks.length; i++) {
    const diff = recentTalks[i].at - recentTalks[i - 1].at;
    if (diff >= DAY_MS) {
      lastGap = { from: recentTalks[i - 1].at, to: recentTalks[i].at, hours: Math.floor(diff / 3600_000) };
    }
  }
  if (lastGap) {
    items.push(`静默缺口：${stamp(lastGap.from, tz, w.year)} 至 ${stamp(lastGap.to, tz, w.year)} 连续 ${lastGap.hours}h 无记录`);
  }

  // 5. 书架积压与规律闭环预警（实时变动）
  const epSince = (
    store.db
      .query(
        `SELECT COUNT(*) AS n FROM events
         WHERE kind = 'episode' AND fonds = '' AND id > ?
           AND id NOT IN (SELECT to_id FROM links WHERE rel = 'revises')`,
      )
      .get(lastColdDone?.id ?? "") as { n: number }
  ).n;
  if (epSince >= TIDY_EPISODES) {
    items.push(`书架待整理：已攒 ${epSince} 条新情节（上次整理：${lastColdDone ? stamp(lastColdDone.at, tz, w.year) : "从未"}）`);
  }

  const warnings = shelfWarnings(store);
  if (warnings.length > 0) {
    const wText = warnings
      .map((x) => `[${x.archiveNo}] ${x.reason === "no_against" ? `待复核（印证 ${x.for}/反例 0）` : "久未验证"}`)
      .join("、");
    items.push(`规律预警：${wText}`);
  }

  return items.length ? `备考：${items.join(" · ")}` : null;
}
