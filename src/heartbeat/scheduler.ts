/**
 * 调度（notes/plan/m5.md §二 §五 §六；10-16 收束见 notes/design/lib-vs-harness.md「家 = Soma」）：每分钟判一次。
 *
 * gather（读库）→ decide（纯函数）→ 记唤醒账本（系统日志 `wake`）。两种叫法：
 * - **醒来**（来信、闹钟、定点、心跳）：往它那条连续的会话（Soma）推一轮。Soma 不在 = 当它睡着，不叫、不记账，等它在了再叫。
 *   它正忙着（一轮没完）也照推：Soma 排在后面。那一轮取 `<now>` 时把到点的事写成 `due`、带一次（deliverDue）；
 *   在那之前它自己的哪一轮先取了 `<now>`，就算递过了（`delivered`），不再推。
 * - **睡着时整理**（补写 > 整理 > 梗概）：Psyche 另起一个无头的它（asleep.ts），不进连续会话，同一时间只一个。
 * - 补写、整理、梗概、来信不花额度；它约的（闹钟、定点、心跳）走额度，到点时它醒着（30 分钟内有动静）的不花（10-15 Joy 定）。暂停 = 一律不叫。
 * - 每个候选有 key：叫过、跳过、递过的 key 不再叫（整理 / 补写不会因为没交就每分钟再醒）。
 * - 来信（m6.md §二.3）：她的信没报过就叫醒；勿扰挡住 / 它关了来信叫醒，记一次账（换 key），出了勿扰再叫。
 * - 额度 = 它约的醒（闹钟、定点、心跳）+ 主动写给人的信（没挂 replyTo 的 mail.out，m6.md §〇.3）。
 */
import type { EventStore, PsycheEvent } from "../store/events.ts";
import { fromWallClock, localDay, wallClock } from "../core/time.ts";
import { readSegment, segmentEvents } from "../catalog/hotwrite.ts";
import { ownSince } from "../self/self.ts";
import { alarmKey, dailyKey, firedKeys, getSettings, readSchedule, type Settings } from "./schedule.ts";
import { factsNow, lastActive, mailCandidates, NOT_PLACE_SQL } from "../channel/inbox.ts";
import { pendingGists } from "../catalog/gist.ts";

export const AWAKE_MS = 30 * 60_000;
export const IDLE_MS = 3 * 3600_000;
export const TIDY_EPISODES = 5;
export const TIDY_GAP_MS = 3 * 86_400_000;

export type By = "catchup" | "tidy" | "gist" | "mail" | "alarm" | "daily" | "heartbeat";
export const BUDGETED: ReadonlySet<By> = new Set(["alarm", "daily", "heartbeat"]);
/** 睡着时做的：另起无头会话（asleep.ts），不进连续会话 */
export const ASLEEP: ReadonlySet<By> = new Set(["catchup", "tidy", "gist"]);
export const asleepWork = (c: Candidate) => ASLEEP.has(c.by);
export const BY_NAME: Record<string, string> = { catchup: "补写", tidy: "整理", gist: "梗概", alarm: "闹钟", daily: "定点", heartbeat: "心跳", mail: "来信", manual: "手动" };

export interface Candidate {
  by: By;
  key: string;
  /** 闹钟 / 定点的原话 */
  note?: string;
  /** 补写哪个会话 */
  session?: string;
  /** 补写：还剩几条 */
  lines?: number;
  /** 到点时刻 */
  due?: number;
  /** 到点时它醒着（30 分钟内有动静）：不花额度 */
  awakeAtDue?: boolean;
  /** 来信：哪封 */
  mail?: string;
  /** 来信被挡住：勿扰 / 它关了来信叫醒 */
  hold?: "dnd" | "off";
}

export interface State {
  /** 睡着时的整理正在跑：不再起第二个 */
  asleep: boolean;
  /** 它那条会话（Soma）在：不在就不推醒来 */
  bodyUp: boolean;
  paused: boolean;
  budgetLeft: number;
  /** 已排除叫过 / 跳过 / 递过的；按优先级排好 */
  candidates: Candidate[];
}

export type Decision = { wake: Candidate } | { skip: Candidate; reason: "paused" | "budget" | "dnd" | "off" };

/** 这次叫醒花不花额度 */
export const costs = (c: Candidate) => BUDGETED.has(c.by) && !c.awakeAtDue;

/** 纯函数：此刻叫不叫、叫哪个。叫不了的（整理正在跑 / Soma 不在）先让给后面的 */
export function decide(s: State): Decision | null {
  const c = s.candidates.find((c) => (asleepWork(c) ? !s.asleep : s.bodyUp));
  if (!c) return null;
  if (c.hold) return { skip: c, reason: c.hold };
  if (s.paused) return { skip: c, reason: "paused" };
  if (costs(c) && s.budgetLeft <= 0) return { skip: c, reason: "budget" };
  return { wake: c };
}

// ── 读库 ──

/** 最近一次醒着的动静（口径在 inbox.ts lastActive） */
export function lastActivity(store: EventStore): number | null {
  return lastActive(store)?.at ?? null;
}

interface WakeLog {
  at: number;
  by: string;
  key: string;
  decided: "woke" | "skipped" | "delivered";
  /** 花了额度（woke 时记） */
  budgeted?: boolean;
  reason?: string;
  note?: string;
  session?: string;
}

function wakeLogs(store: EventStore, since = 0): WakeLog[] {
  return (store.db.query(`SELECT at, detail FROM system_log WHERE kind = 'wake' AND at >= ? ORDER BY id`).all(since) as { at: number; detail: string }[]).map((r) => ({
    at: r.at,
    ...JSON.parse(r.detail),
  }));
}

/** 今天花掉的额度：醒（它约的）+ 主动写给人的信 */
export function budgetToday(store: EventStore): { woke: number; mail: number; used: number } {
  const today = localDay(store.now(), store.timeZone);
  const woke = wakeLogs(store, store.now() - 2 * 86_400_000).filter((l) => l.decided === "woke" && (l.budgeted ?? BUDGETED.has(l.by as By)) && localDay(l.at, store.timeZone) === today).length;
  const mail = ownSince(store, "mail.out").filter((e) => {
    const p = e.payload as { to: string; replyTo?: string };
    return p.to !== "self" && !p.replyTo && localDay(e.at, store.timeZone) === today;
  }).length;
  return { woke, mail, used: woke + mail };
}

export function budgetUsedToday(store: EventStore): number {
  return budgetToday(store).used;
}

const dayStart = (store: EventStore, at: number) => {
  const w = wallClock(at, store.timeZone);
  return { w, day: localDay(at, store.timeZone) };
};
const slotAt = (store: EventStore, at: number, hhmm: string) => {
  const { w } = dayStart(store, at);
  const [h, m] = hhmm.split(":").map(Number);
  return fromWallClock(store.timeZone, w.year, w.month, w.day, h, m);
};

/** 某时刻它醒不醒着：之前 30 分钟内有醒着的动静 */
function awakeAt(store: EventStore, at: number): boolean {
  const last = lastActive(store, at);
  return !!last && last.at > at - AWAKE_MS;
}

/** 到点了、还没响（没有 due）的闹钟和定点 */
export function pendingDue(store: EventStore): Candidate[] {
  const cur = readSchedule(store);
  if (!cur) return [];
  const now = store.now();
  const fired = firedKeys(store);
  const out: Candidate[] = cur.schedule.alarms.filter((a) => a.at <= now).map((a) => ({ by: "alarm" as const, key: alarmKey(a), note: a.note, due: a.at }));
  const day = localDay(now, store.timeZone);
  for (const d of cur.schedule.daily) {
    const t = slotAt(store, now, d.at);
    const key = dailyKey(d.at, day);
    // 写作息之前的那个点不算（今天 08:00 写了 07:00，不当场响）
    if (t <= now && t >= cur.at && !fired.has(key)) out.push({ by: "daily", key, note: d.note, due: t });
  }
  for (const c of out) if (awakeAt(store, c.due!)) c.awakeAtDue = true;
  return out.sort((a, b) => a.due! - b.due!);
}

/** 上次醒来（睡着时的整理不算）和有人上次找它，较晚的那个 */
function lastWokeOrSpoken(store: EventStore): number {
  const r = store.db
    .query(
      `SELECT MAX(at) AS at FROM events WHERE fonds = '' AND (kind = 'message.in' OR (kind = 'woke' AND json_extract(payload, '$.by') NOT IN (${[...ASLEEP].map((b) => `'${b}'`).join(", ")})))`,
    )
    .get() as { at: number | null };
  return r.at ?? 0;
}

/** 心跳从"上次醒"和"有人上次找它"较晚者算起（Roxy 教训） */
function heartbeatDue(store: EventStore, settings: Settings): Candidate | null {
  const every = readSchedule(store)?.schedule.heartbeat?.everyMin;
  if (!settings.heartbeat || !every) return null;
  const born = ownSince(store, "schedule.changed")[0]?.at ?? 0;
  const anchor = Math.max(lastWokeOrSpoken(store), born);
  const due = anchor + every * 60_000;
  return due <= store.now() ? { by: "heartbeat", key: `heartbeat:${anchor}`, due } : null;
}

/** 该整理了：空闲 ≥ 3h，且上次整理后新情节 ≥ 5 条，或距上次整理 ≥ 3 天且有新情节 */
function tidyDue(store: EventStore): Candidate | null {
  const last = lastActivity(store);
  if (last !== null && store.now() - last < IDLE_MS) return null;
  const done = store.db.query(`SELECT id, at FROM events WHERE kind = 'coldwrite.done' AND fonds = '' ORDER BY id DESC LIMIT 1`).get() as { id: string; at: number } | null;
  const eps = store.db.query(`SELECT COUNT(*) AS n, MAX(id) AS newest FROM events WHERE kind = 'episode' AND fonds = '' AND id > ?`).get(done?.id ?? "") as { n: number; newest: string | null };
  if (!eps.n) return null;
  const longAgo = !done || store.now() - done.at >= TIDY_GAP_MS;
  if (eps.n < TIDY_EPISODES && !longAgo) return null;
  return { by: "tidy", key: `tidy:${eps.newest}` };
}

/** 该写梗概了：空闲 ≥ 3h，有过完了还没写的天 / 周 / 月（同一批只叫一次） */
function gistDue(store: EventStore): Candidate | null {
  const last = lastActivity(store);
  if (last !== null && store.now() - last < IDLE_MS) return null;
  const pending = pendingGists(store);
  if (!pending.length) return null;
  return { by: "gist", key: `gist:${pending.map((p) => p.key).join(",")}` };
}

/** 有段没写进记忆：会话 ≥ 3h 没动静、还剩 ≥ 1 条；睡着时整理的会话（和以前的家）不算 */
function catchupDue(store: EventStore): Candidate[] {
  const rows = store.db
    .query(`SELECT DISTINCT json_extract(s.payload, '$.session') AS s FROM events s WHERE s.class = 'situation' AND s.fonds = '' AND ${NOT_PLACE_SQL} AND json_extract(s.payload, '$.session') IS NOT NULL`)
    .all() as { s: string }[];
  const out: (Candidate & { last: number })[] = [];
  for (const { s } of rows) {
    const evs: PsycheEvent[] = segmentEvents(store, s);
    if (!evs.length) continue;
    const last = Math.max(...evs.map((e) => e.at));
    if (store.now() - last < IDLE_MS) continue;
    const seg = readSegment(store, s);
    if (!seg.lines.length) continue;
    out.push({ by: "catchup", key: `catchup:${s}:${seg.upTo}`, session: s, lines: seg.lines.length, last });
  }
  return out.sort((a, b) => a.last - b.last).map(({ last, ...c }) => c);
}

export interface GatherOpts {
  /** 睡着时的整理正在跑（缺省没有） */
  asleep?: boolean;
  /** Soma 在不在（缺省在） */
  bodyUp?: boolean;
}

export function gather(store: EventStore, opts: GatherOpts = {}): State {
  const settings = getSettings(store);
  const logged = new Set(wakeLogs(store).map((l) => l.key));
  const hb = heartbeatDue(store, settings);
  const candidates = [...catchupDue(store), tidyDue(store), gistDue(store), ...mailCandidates(store, factsNow(store)), ...pendingDue(store), hb].filter((c): c is Candidate => !!c && !logged.has(c.key));
  return {
    asleep: !!opts.asleep,
    bodyUp: opts.bodyUp ?? true,
    paused: settings.paused,
    budgetLeft: settings.wakeBudget - budgetUsedToday(store),
    candidates,
  };
}

function log(store: EventStore, decided: WakeLog["decided"], c: Candidate, reason?: string) {
  store.syslog("wake", {
    by: c.by,
    key: c.key,
    decided,
    ...(decided === "woke" ? { budgeted: costs(c) } : {}),
    ...(reason ? { reason } : {}),
    ...(c.note ? { note: c.note } : {}),
    ...(c.session ? { session: c.session } : {}),
    ...(c.mail ? { mail: c.mail } : {}),
  });
}

/** 判一次并记账；叫醒由调用方去做（main.ts：醒来推给 Soma，整理起 asleep.ts） */
export function tick(store: EventStore, opts: GatherOpts = {}): Decision | null {
  const d = decide(gather(store, opts));
  if (d && "wake" in d) log(store, "woke", d.wake);
  else if (d) log(store, "skipped", d.skip, d.reason);
  return d;
}

/** 一次叫醒跑完（此刻）：记这次留下了什么（统计，不是评价）。睡着时整理的跑完记；推给 Soma 的醒来不在这里记 */
export function logRun(store: EventStore, key: string, run: { session: string; costUsd?: number; ms: number; error?: string }) {
  // 按这次跑的时间窗数它写下的自我事件：补写的情节挂在原会话的处境上，不在这次的会话里
  const evs = store.db
    .query(`SELECT kind FROM events WHERE class = 'self' AND fonds = '' AND source = 'agent' AND recorded >= ? AND recorded <= ?`)
    .all(store.now() - run.ms, store.now()) as { kind: string }[];
  const n = (f: (k: string) => boolean) => evs.filter((e) => f(e.kind)).length;
  const produced = {
    episodes: n((k) => k === "episode"),
    shelf: n((k) => k.startsWith("semantic.")),
    diary: n((k) => k === "diary"),
    prompt: n((k) => k === "prompt.changed"),
    schedule: n((k) => k === "schedule.changed"),
  };
  store.syslog("wake.run", { key, ...run, produced });
  return produced;
}

// ── 递进去：<now> 取的时候 ──

/** 到点的闹钟 / 定点写成 due（经历），返回这次递的；推给 Soma 的那一轮取 <now> 时也走这里 */
export function deliverDue(store: EventStore): PsycheEvent[] {
  const pending = pendingDue(store);
  if (!pending.length) return [];
  const woke = new Set(wakeLogs(store).filter((l) => l.decided === "woke").map((l) => l.key));
  return store.db.transaction(() =>
    pending.map((c) => {
      const ev = store.append({ kind: "due", class: "experience", source: "psyche", payload: { by: c.by, key: c.key, note: c.note ?? "", at: c.due } });
      if (!woke.has(c.key)) log(store, "delivered", c);
      return ev;
    }),
  )();
}

const pad = (n: number) => String(n).padStart(2, "0");
const hm = (store: EventStore, at: number) => {
  const w = wallClock(at, store.timeZone);
  return `${pad(w.hour)}:${pad(w.minute)}`;
};
const stamp = (store: EventStore, at: number) => {
  const w = wallClock(at, store.timeZone);
  return `${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)}`;
};

/** <now>「刚发生」：这次递进来的（到点的事 + 来信 / 交接信的消息），按时刻排 */
export function renderJustHappened(store: EventStore, dues: PsycheEvent[], mails: { at: number; line: string }[] = []): string | null {
  const items = [
    ...dues.map((e) => {
      const p = e.payload as { by: string; note: string; at: number };
      return { at: p.at, line: `- ${BY_NAME[p.by] ?? p.by}（约在 ${hm(store, p.at)}）${p.note ? `：${p.note}` : ""}` };
    }),
    ...mails,
  ].sort((a, b) => a.at - b.at);
  if (!items.length) return null;
  return `刚发生：\n${items.map((i) => i.line).join("\n")}`;
}

/** 下一个它约的醒：闹钟、定点、心跳（开着时） */
export function nextWake(store: EventStore): Candidate | null {
  const cur = readSchedule(store);
  if (!cur) return null;
  const now = store.now();
  const c: Candidate[] = cur.schedule.alarms.filter((a) => a.at > now).map((a) => ({ by: "alarm", key: alarmKey(a), note: a.note, due: a.at }));
  for (const d of cur.schedule.daily) {
    const today = slotAt(store, now, d.at);
    const t = today > now ? today : slotAt(store, now + 86_400_000, d.at);
    c.push({ by: "daily", key: dailyKey(d.at, localDay(t, store.timeZone)), note: d.note, due: t });
  }
  const settings = getSettings(store);
  const every = cur.schedule.heartbeat?.everyMin;
  if (settings.heartbeat && every) {
    c.push({ by: "heartbeat", key: "heartbeat", due: Math.max(lastWokeOrSpoken(store), cur.at) + every * 60_000 });
  }
  return c.sort((a, b) => a.due! - b.due!)[0] ?? null;
}

/** <now> 的作息一行：只陈述。没写过作息、也没暂停、勿扰没挡信时不出现。held = 此刻勿扰挡着几封 */
export function scheduleLine(store: EventStore, opts: { held?: number } = {}): string | null {
  const cur = readSchedule(store);
  const settings = getSettings(store);
  const held = opts.held ?? 0;
  const b = budgetToday(store);
  if (!cur && !settings.paused && !held && !b.mail) return null;
  const parts: string[] = [];
  const next = nextWake(store);
  parts.push(next ? `下次 ${stamp(store, next.due!)}（${BY_NAME[next.by]}${next.note ? `：${next.note}` : ""}）` : "没有排着的");
  parts.push(`今天额度 ${b.used}/${settings.wakeBudget}${b.mail ? `（醒 ${b.woke} · 写信 ${b.mail}）` : ""}`);
  if (cur && !cur.schedule.wakeOn.mail) parts.push("来信不叫醒我");
  if (held) parts.push(`勿扰中，攒了 ${held} 封`);
  if (cur?.schedule.heartbeat && !settings.heartbeat) parts.push("心跳暂未开放，写了不生效");
  if (settings.paused) parts.push("暂停中：不叫醒");
  return `作息：${parts.join(" · ")}`;
}

// ── 唤醒账本（给 Joy 看） ──

export function wakeLedger(store: EventStore, days = 7) {
  const since = store.now() - days * 86_400_000;
  const entries = wakeLogs(store, since);
  const runs = (store.db.query(`SELECT detail FROM system_log WHERE kind = 'wake.run' AND at >= ? ORDER BY id`).all(since) as { detail: string }[]).map((r) => JSON.parse(r.detail));
  const runOf = new Map(runs.map((r) => [r.key as string, r]));
  const full = entries.map((e) => ({ ...e, ...(runOf.has(e.key) && e.decided === "woke" ? { run: runOf.get(e.key) } : {}) }));
  const byDay = new Map<string, { day: string; woke: number; delivered: number; skipped: number; by: Record<string, number>; costUsd: number; empty: number }>();
  for (const e of full) {
    const day = localDay(e.at, store.timeZone);
    const d = byDay.get(day) ?? { day, woke: 0, delivered: 0, skipped: 0, by: {}, costUsd: 0, empty: 0 };
    d[e.decided]++;
    if (e.decided === "woke") {
      d.by[e.by] = (d.by[e.by] ?? 0) + 1;
      const r = (e as { run?: { costUsd?: number; produced?: Record<string, number> } }).run;
      if (r) {
        d.costUsd += r.costUsd ?? 0;
        if (r.produced && Object.values(r.produced).every((v) => v === 0)) d.empty++;
      }
    }
    byDay.set(day, d);
  }
  return { days: [...byDay.values()], entries: full };
}
