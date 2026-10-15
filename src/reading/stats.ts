/**
 * 统计（reading-room.md §一「统计」书架，m2.md §九）：互动节奏，代码算，不经 LLM，读时算、不存。
 *
 * 只给数，不下结论：这段时间 vs 基线，各项两个数 + 变化幅度。反常不反常、能不能解释，是它冷写时的事。
 * 第一批（10-14 Joy 定，想到再补）：来几次、几点来、一次聊多久多少轮、她每条多长、她回我隔多久、两次之间沉默多久、谁先开口。
 *
 * 口径：
 *   一次对话 = 一串 message.in / message.out，相邻两条间隔不超过 GAP；对方 = 这串里说话最多的 from。
 *   来 = 对方开口的一次对话；谁先开口看对话第一条是谁的。
 *   她回我 = 我说完到她下一条之间（中间我又说了就从我最后一条算），超过 1 天不算回复。
 */
import type { Database } from "bun:sqlite";

export const GAP = 30 * 60_000;
const DAY = 86_400_000;
export const BASELINE_DAYS = 28;

interface Msg {
  at: number;
  dir: "in" | "out";
  from: string | null;
  len: number;
}

interface Conv {
  who: string;
  start: number;
  end: number;
  turns: number;
  firstIsHer: boolean;
}

export interface StatRow {
  key: string;
  name: string;
  unit: string;
  period: number | null;
  baseline: number | null;
  /** period / baseline - 1；任一边没有数就是 null */
  change: number | null;
}

export interface PersonStats {
  who: string;
  rows: StatRow[];
  /** 到达时段分布（占比）：凌晨 0–6、上午 6–12、下午 12–18、晚上 18–24 */
  hours: { period: number[] | null; baseline: number[] | null };
  /** 此刻距她上一条多久（分钟） */
  silenceNow: number | null;
}

export interface Stats {
  period: { from: number; to: number };
  /** days：基线实际覆盖的天数（库刚开始用时不足 BASELINE_DAYS） */
  baseline: { from: number; to: number; days: number };
  people: PersonStats[];
}

const chars = (s: unknown) => (typeof s === "string" ? Array.from(s).length : 0);

function loadMessages(db: Database, from: number, to: number): Msg[] {
  const rows = db
    .query(
      `SELECT at, kind, json_extract(payload, '$.from') AS f, json_extract(payload, '$.text') AS t FROM events
       WHERE fonds = '' AND kind IN ('message.in', 'message.out') AND at >= ? AND at < ? ORDER BY at, id`,
    )
    .all(from, to) as { at: number; kind: string; f: string | null; t: string | null }[];
  return rows.map((r) => ({ at: r.at, dir: r.kind === "message.in" ? "in" : "out", from: r.kind === "message.in" ? r.f : null, len: chars(r.t) }));
}

function conversations(msgs: Msg[]): Conv[] {
  const out: Conv[] = [];
  let cur: Msg[] = [];
  const flush = () => {
    if (!cur.length) return;
    const tally = new Map<string, number>();
    for (const m of cur) if (m.dir === "in" && m.from) tally.set(m.from, (tally.get(m.from) ?? 0) + 1);
    const who = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (who)
      out.push({ who, start: cur[0].at, end: cur.at(-1)!.at, turns: tally.get(who)!, firstIsHer: cur[0].dir === "in" && cur[0].from === who });
    cur = [];
  };
  for (const m of msgs) {
    if (cur.length && m.at - cur.at(-1)!.at > GAP) flush();
    cur.push(m);
  }
  flush();
  return out;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const bucket = (at: number, tz: string) => {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date(at)));
  return Math.floor(h / 6);
};

/** 一个窗口里关于 who 的各项原始值 */
function measure(msgs: Msg[], convs: Conv[], who: string, days: number, tz: string) {
  const mine = convs.filter((c) => c.who === who);
  const arrivals = mine.filter((c) => c.firstIsHer);
  const hers = msgs.filter((m) => m.dir === "in" && m.from === who);
  // 她回我：我最后一条 → 她下一条
  const replies: number[] = [];
  let lastOut: number | null = null;
  for (const m of msgs) {
    if (m.dir === "out") lastOut = m.at;
    else if (m.from === who && lastOut !== null) {
      if (m.at - lastOut <= DAY) replies.push(m.at - lastOut);
      lastOut = null;
    }
  }
  const gaps = mine.slice(1).map((c, i) => c.start - mine[i].end);
  const hours = [0, 0, 0, 0];
  for (const c of arrivals) hours[bucket(c.start, tz)]++;
  return {
    values: {
      arrivals: days > 0 ? arrivals.length / days : null,
      convMinutes: median(mine.map((c) => (c.end - c.start) / 60_000)),
      turns: median(mine.map((c) => c.turns)),
      msgLen: median(hers.map((m) => m.len)),
      replyMinutes: median(replies.map((r) => r / 60_000)),
      silenceHours: median(gaps.map((g) => g / 3_600_000)),
      herFirst: mine.length ? arrivals.length / mine.length : null,
    } as Record<string, number | null>,
    hours: arrivals.length ? hours.map((n) => n / arrivals.length) : null,
    count: mine.length,
  };
}

const ROWS: { key: string; name: string; unit: string }[] = [
  { key: "arrivals", name: "她来找我", unit: "次/天" },
  { key: "convMinutes", name: "一次对话多长（中位）", unit: "分钟" },
  { key: "turns", name: "一次对话她说几条（中位）", unit: "条" },
  { key: "msgLen", name: "她每条多长（中位）", unit: "字" },
  { key: "replyMinutes", name: "她回我隔多久（中位）", unit: "分钟" },
  { key: "silenceHours", name: "两次对话之间隔多久（中位）", unit: "小时" },
  { key: "herFirst", name: "她先开口的占比", unit: "" },
];

/** 它能 track 的指标（attention.md §四）：上面各项 + 几点来 */
export const TRACK_KEYS = [...ROWS.map((r) => r.key), "hours"];

/**
 * 只留它 track 了的（冷写材料用）：按人、按项；某人一项都没 track 就整个不出。silenceNow 跟着 arrivals 走。
 * 一个都没有 → null（没有表，而不是空表）。
 */
export function pickTracked(s: Stats, tracked: Map<string, Set<string>>): Stats | null {
  const people = s.people.flatMap((p) => {
    const keys = tracked.get(p.who);
    if (!keys?.size) return [];
    return [{
      ...p,
      rows: p.rows.filter((r) => keys.has(r.key)),
      hours: keys.has("hours") ? p.hours : { period: null, baseline: null },
      silenceNow: keys.has("arrivals") ? p.silenceNow : null,
    }];
  });
  return people.length ? { ...s, people } : null;
}

/** [from, to) 这段 vs 之前 BASELINE_DAYS 天；now 用来算"此刻沉默了多久" */
export function computeStats(db: Database, opts: { from: number; to: number; now?: number; timeZone?: string; baselineDays?: number }): Stats {
  const tz = opts.timeZone ?? "Asia/Shanghai";
  const bFrom = opts.from - (opts.baselineDays ?? BASELINE_DAYS) * DAY;
  const pMsgs = loadMessages(db, opts.from, opts.to);
  const bMsgs = loadMessages(db, bFrom, opts.from);
  const pConvs = conversations(pMsgs);
  const bConvs = conversations(bMsgs);
  // 基线只从有消息那天算起：库刚开始用时，空白的日子不算"她没来"
  const bStart = bMsgs[0]?.at ?? opts.from;
  const pDays = Math.max(1, (opts.to - opts.from) / DAY);
  const bDays = (opts.from - bStart) / DAY;
  const people = [...new Set(pConvs.map((c) => c.who))].map((who): PersonStats => {
    const p = measure(pMsgs, pConvs, who, pDays, tz);
    const b = bConvs.some((c) => c.who === who) ? measure(bMsgs, bConvs, who, bDays, tz) : null;
    const last = db
      .query(`SELECT MAX(at) AS at FROM events WHERE fonds = '' AND kind = 'message.in' AND json_extract(payload, '$.from') = ? AND at < ?`)
      .get(who, opts.now ?? opts.to) as { at: number | null };
    return {
      who,
      rows: ROWS.map((r) => {
        const pv = p.values[r.key] ?? null;
        const bv = b?.values[r.key] ?? null;
        return { ...r, period: pv, baseline: bv, change: pv !== null && bv ? pv / bv - 1 : null };
      }),
      hours: { period: p.hours, baseline: b?.hours ?? null },
      silenceNow: last.at === null ? null : ((opts.now ?? opts.to) - last.at) / 60_000,
    };
  });
  return { period: { from: opts.from, to: opts.to }, baseline: { from: bFrom, to: opts.from, days: bDays }, people };
}

const fmt = (v: number | null, unit: string) => (v === null ? "—" : unit === "" ? `${Math.round(v * 100)}%` : `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10}${unit}`);
const SLOTS = ["凌晨", "上午", "下午", "晚上"];
const dist = (h: number[] | null) => (h ? h.map((x, i) => `${SLOTS[i]} ${Math.round(x * 100)}%`).join(" · ") : "—");

/** 给它看的表：这段 / 基线 / 变化。不写"反常" */
export function renderStats(s: Stats): string[] {
  const lines: string[] = [];
  for (const p of s.people) {
    lines.push(`和 ${p.who}：这段（${fmt((s.period.to - s.period.from) / DAY, "天")}）/ 之前（${fmt(s.baseline.days, "天")}）/ 变化`);
    for (const r of p.rows)
      lines.push(`  ${r.name}：${fmt(r.period, r.unit)} / ${fmt(r.baseline, r.unit)} / ${r.change === null ? "—" : `${r.change >= 0 ? "+" : ""}${Math.round(r.change * 100)}%`}`);
    if (p.hours.period || p.hours.baseline) lines.push(`  她几点来：${dist(p.hours.period)} / ${dist(p.hours.baseline)}`);
    if (p.silenceNow !== null) lines.push(`  到这段结束时，她上一条是 ${fmt(p.silenceNow / 60, "小时")}前`);
  }
  return lines;
}
