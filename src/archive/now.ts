/**
 * `<moment>`（m1.md §四，原名 `<now>`）：每轮开头注入的一小段事实。只陈述，不用它的口吻。
 *
 * 全部读时算（与时间相关的不存，projections.ts 原则 2）。
 */
import type { EventStore } from "../store/events.ts";
import { wallClock } from "../core/time.ts";
import { readSegment, resolveSession } from "../catalog/hotwrite.ts";
import type { StateItem } from "./moment.ts";
import { pendingGists } from "../catalog/gist.ts";

const pad = (n: number) => String(n).padStart(2, "0");
const GAP_MS = 3600_000;
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

/**
 * moment 开头的几项：现在（每轮都给）、在哪、上次有人跟我说话。后两项过状态闸（moment.ts）。
 * 「还没写进记忆的 N 条」10-27 撤了：收尾由地方按上下文自动触发，它不用管。
 */
export function momentHead(store: EventStore, session?: string): { time: string; items: StateItem[] } {
  const now = store.now();
  const tz = store.timeZone;
  const w = wallClock(now, tz);
  const time = `现在：${w.year}-${pad(w.month)}-${pad(w.day)} ${w.weekday} ${pad(w.hour)}:${pad(w.minute)}`;
  const items: StateItem[] = [];

  let s: string | null = null;
  try {
    s = resolveSession(store, session);
  } catch {
    // 没有会话：不报会话起点
  }
  // 取 moment 的那个会话在哪；没给会话才用全局当前处境（几个地方同时跑时全局的会被顶掉）
  const own = s ? store.situationOfSession(s, now) : null;
  const sit = ((own ? store.get(own) : store.situation)?.payload) as { harness?: string; session?: string } | undefined;
  if (sit?.harness) {
    const start = s
      ? (store.db
          .query(`SELECT MIN(at) AS at FROM events WHERE class = 'situation' AND fonds = '' AND json_extract(payload, '$.session') = ?`)
          .get(s) as { at: number | null }).at
      : null;
    items.push({ key: "where", sig: `${sit.harness}|${start ?? ""}`, text: `在：${sit.harness}${start !== null ? `，本会话从 ${stamp(start, tz, w.year)} 起` : ""}` });
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
  if (prev)
    items.push({
      key: "prev",
      // 换了人，或隔了 1 小时以上才算变；聊着的时候「6 分钟前 → 9 分钟前」不重报
      sig: `${prev.who}|${now - prev.at >= GAP_MS ? prev.at : ""}`,
      text: `上次有人跟我说话：${prev.who}，${ago(now - prev.at)}${"mail" in prev ? "（来信，看过了）" : ""}`,
    });
  return { time, items };
}

/**
 * 备考（moment 的一项）：只报后台睡着时的活出了错——补写 / 整理 / 梗概失败或未交回，恢复了下一轮就没了。
 * 10-27 撤了旧会话未写、梗概未写、静默缺口、书架待整理、规律预警：系统正常时它不用管，挂着只添焦灼（规律预警在体检面板）。
 */
export function noteSheetLine(store: EventStore): string | null {
  const w = wallClock(store.now(), store.timeZone);
  const items: string[] = [];
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
      if (by === "gist" && pendingGists(store).length === 0) continue;
      if (by === "catchup") {
        const sess = r.key.split(":")[1];
        if (sess && readSegment(store, sess).lines.length === 0) continue;
      }
      items.push(`后台${label}失败于 ${stamp(r.at, store.timeZone, w.year)}`);
    } else if (by === "tidy" && (r.produced?.shelf ?? 0) === 0 && (!lastColdDone || lastColdDone.at < r.at - (r.ms ?? 0) - 5_000)) {
      items.push(`后台${label}未交回（${stamp(r.at, store.timeZone, w.year)}）`);
    }
  }
  return items.length ? `备考：${items.join(" · ")}` : null;
}

/** 只要开头几项、不过闸（评测用） */
export function renderNow(store: EventStore, session?: string): string {
  const h = momentHead(store, session);
  return `<moment>\n${[h.time, ...h.items.map((i) => i.text).filter(Boolean)].join("\n")}\n</moment>`;
}
