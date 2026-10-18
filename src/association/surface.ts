/**
 * 浮现（m3.md，association.md）：不用它去找，此刻的情境把旧事、它写过的书架条目、"她该来没来"推到眼前。
 *
 * 每轮算一次，不调 LLM（向量是之前算好的；这一轮的线索要嵌入一次）。推什么只由数得出来的东西决定：
 *   激活度 = 线索匹配 + 基础强度 + 噪声；过阈值、按处境限条数；不应期内的不推。
 * 推出来的是它自己写的文字（情节、书架条目）或原话；预感只陈述事实。线索记在 surfaced 事件里，不给它看。
 */
import type { Database } from "bun:sqlite";
import type { EventStore } from "../store/events.ts";
import { displayArchiveNo } from "../store/events.ts";
import { localDay, wallClock } from "../core/time.ts";
import { cosine, fromBlob, syncVectors, vectorOf, type Embedder } from "../archive/vectors.ts";
import { readShelf, renderEntry, trackedByPerson, type ShelfEntry } from "../reading/shelf.ts";
import { pinnedRoots } from "../self/pinned.ts";
import { NOT_MEMORY_TOOL } from "../archive/recall.ts";
import { sessionOf } from "../archive/experience.ts";
import { harnessOf } from "../catalog/coldwrite.ts";
import { keywords } from "../core/words.ts";
import { envNow, envOf, envSimilarity, type Env } from "../perception/env.ts";
import { NOT_PLACE_SQL } from "../channel/inbox.ts";
export { keywords };

/** 各项权重与阈值：都在这一处，用考卷调 */
export const W = {
  /** 余弦低于 floor 算没匹配，floor + span 以上算满分（bge-m3：相关的约 0.65+，不相关的短句也有 0.4–0.5） */
  vecFloor: 0.55,
  vecSpan: 0.25,
  vec: 0.7,
  lexical: 0.8,
  /** 书架条目自己写的留意词出现在这一轮的话里 */
  watch: 0.8,
  felt: 0.1,
  consequence: 0.15,
  /** 书架条目：每次印证（封顶 4 次）、最近 14 天内有证据 */
  evidence: 0.04,
  evidenceRecent: 0.1,
  /** 书架条目的证据里有发生在此刻这个地方的（m3 线索"地方"） */
  place: 0.1,
  refractoryMs: 72 * 3_600_000,
  /** 预感：最近 28 天里这个时段来过的天数占比 */
  hunchShare: 0.5,
  hunchWindowDays: 28,
};

type Mode = "task" | "chat" | "fresh";
export const MODES: Record<Mode, { threshold: number; max: number; noise: number }> = {
  task: { threshold: 0.9, max: 1, noise: 0.03 },
  chat: { threshold: 0.6, max: 2, noise: 0.06 },
  fresh: { threshold: 0.5, max: 3, noise: 0.1 },
};

export interface Surfaced {
  source: "recall" | "expect" | "hunch";
  ref: string;
  text: string;
  score: number;
  parts: Record<string, number>;
}

export interface SurfaceResult {
  mode: Mode;
  idle?: boolean;
  cue: string;
  items: Surfaced[];
  /** 过了线但被条数上限挤掉的、没过线的前几名（dry 时给，调参用） */
  rest?: Surfaced[];
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const SLOTS = ["凌晨", "上午", "下午", "晚上"];
const slotOf = (at: number, tz: string) => Math.floor(wallClock(at, tz).hour / 6);
const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (at: number, tz: string) => {
  const w = wallClock(at, tz);
  return `${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)}`;
};
const ago = (ms: number) => (ms < HOUR ? `${Math.round(ms / 60_000)} 分钟` : ms < 2 * DAY ? `${Math.round(ms / HOUR)} 小时` : `${Math.round(ms / DAY)} 天`);

/**
 * 空档输入（借 ASCM `isIdleInput`）："嗯""好""在吗"、emoji、纯标点——不是新话题，是"我在听"。
 * 拿它的内容去匹配只有噪声；它只能撞上书架上它自己写的留意词（"她回单字"本身就是线索）。
 */
const FILLER = /[嗯哦噢喔啊呀吗呢吧哈嘛啦呗嘞哇]/gu;
const ACK = new Set(["好的", "可以", "收到", "知道", "知道了", "行的", "对的", "是的", "没事", "在的", "好吧", "随便"]);
export function isIdle(text: string): boolean {
  const core = text.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu, "").replace(/[\p{P}\p{S}\s]/gu, "");
  const rest = core.replace(FILLER, "");
  // 剩一个字（"在""好""行"）或只是应答词；"耳机"这种两个字的实词不算空档
  return Array.from(rest).length <= 1 || ACK.has(rest);
}

/** 汉字两两一组 + 拉丁词 */
export function grams(s: string): string[] {
  const out = new Set<string>();
  for (const run of s.match(/[\p{Script=Han}]+/gu) ?? []) {
    const cs = Array.from(run);
    if (cs.length === 1) out.add(cs[0]);
    for (let i = 0; i + 1 < cs.length; i++) out.add(cs[i] + cs[i + 1]);
  }
  for (const w of s.match(/[A-Za-z0-9_]{2,}/g) ?? []) out.add(w.toLowerCase());
  return [...out];
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Ctx {
  db: Database;
  store: EventStore;
  now: number;
  session: string | null;
}

/** 处境：最近 10 分钟本会话工具调用 ≥3 → 有任务；这一轮前 2 小时没有她的话、或刚醒 → 刚回来；否则在聊 */
function modeOf(c: Ctx): { mode: Mode; turnStart: string | null; herNow: { text: string; from: string } | null } {
  const sessionRows = (sql: string, ...args: (string | number)[]) =>
    c.session
      ? (c.db
          .query(`SELECT e.id, e.kind, e.at, e.payload FROM events e JOIN events s ON s.id = e.situation
                  WHERE e.fonds = '' AND json_extract(s.payload, '$.session') = ? AND ${sql} ORDER BY e.id DESC`)
          .all(c.session, ...args) as { id: string; kind: string; at: number; payload: string }[])
      : [];
  const tools = sessionRows(`e.kind = 'tool.call' AND e.at >= ?`, c.now - 10 * 60_000).length;
  const last = sessionRows(`e.kind IN ('message.in', 'message.out', 'woke')`)[0];
  const herNow = last?.kind === "message.in" ? (JSON.parse(last.payload) as { text: string; from: string }) : null;
  const before = last
    ? (c.db.query(`SELECT MAX(at) AS at FROM events WHERE fonds = '' AND kind = 'message.in' AND id < ?`).get(last.id) as { at: number | null }).at
    : null;
  const fresh = !last || last.kind === "woke" || before === null || last.at - before >= 2 * HOUR;
  return { mode: tools >= 3 ? "task" : fresh ? "fresh" : "chat", turnStart: herNow ? last.id : null, herNow };
}

/** 线索的话：她这一轮的话 + 本会话前几行；刚回来没有她的话 → 上次和她对话的最后几行 */
/**
 * 上次和她对话的最后几行：另一个会话里最近的那段（有情节给情节）。睡着时的会话（补写 / 整理 / 梗概）
 * 不是和谁的对话，不算；睡着时写的情节挂在原来那段会话上，照样算。
 */
function lastTimeTail(c: Ctx) {
  const asleep = `SELECT json_extract(s.payload, '$.session') FROM events s WHERE s.class = 'situation' AND s.fonds = '' AND NOT (${NOT_PLACE_SQL}) AND json_extract(s.payload, '$.session') IS NOT NULL`;
  return (
    c.db
      .query(
        `SELECT p.event_id, p.archive_no, p.at, p.text, p.session FROM p_experience p WHERE p.kind IN ('message.in', 'message.out', 'episode') AND p.covered = 0
           AND p.at <= ? AND p.session = (SELECT q.session FROM p_experience q WHERE q.kind IN ('message.in', 'message.out', 'episode') AND q.at <= ?
                                          AND q.session IS NOT ? AND q.session NOT IN (${asleep}) ORDER BY q.at DESC, q.event_id DESC LIMIT 1)
         ORDER BY p.at DESC, p.event_id DESC LIMIT 4`,
      )
      .all(c.now, c.now, c.session) as { event_id: string; archive_no: string; at: number; text: string; session: string | null }[]
  ).reverse();
}

function cueText(c: Ctx, herNow: { text: string } | null, turnStart: string | null, fresh: boolean): { text: string; now: string; fromLastTime: { event_id: string; archive_no: string; at: number; text: string; session: string | null }[] } {
  if (herNow && turnStart) {
    const prev = c.session
      ? (c.db
          .query(`SELECT text FROM p_experience WHERE session = ? AND covered = 0 AND class <> 'situation' AND event_id < ? ORDER BY event_id DESC LIMIT 3`)
          .all(c.session, turnStart) as { text: string }[])
      : [];
    // 隔了很久她回来：她这一轮的话是线索，上次怎么散的照样先想起来
    return { text: [herNow.text, ...prev.map((r) => r.text)].join("\n"), now: herNow.text, fromLastTime: fresh ? lastTimeTail(c) : [] };
  }
  const tail = lastTimeTail(c);
  const text = tail.map((r) => r.text).join("\n");
  return { text, now: text, fromLastTime: tail };
}

function refractory(c: Ctx): Set<string> {
  const rows = c.db
    .query(`SELECT json_extract(payload, '$.ref') AS ref FROM events WHERE kind = 'surfaced' AND fonds = '' AND at >= ?`)
    .all(c.now - W.refractoryMs) as { ref: string }[];
  return new Set(rows.map((r) => r.ref));
}

/**
 * 回忆的候选：只取它写的情节（借 ASCM：浮现只给情节，不给原话）。原话一行一行没有前因后果，
 * "嗯 我想加个按周看的"单独浮上来只是噪声；还没写成情节的段，原话仍然 recall 得到。
 */

function recallCandidates(c: Ctx, cue: string, qvec: Float32Array | null, model: string | null, block: Set<string>) {
  const rows = c.db
    .query(
      `SELECT p.event_id, p.archive_no, p.at, p.kind, p.text, p.session FROM p_experience p
       WHERE p.covered = 0 AND p.kind IN ('episode', 'notice') AND p.at <= ?`,
    )
    .all(c.now) as { event_id: string; archive_no: string; at: number; kind: string; text: string; session: string | null }[];
  const all = rows.filter((r) => !block.has(r.event_id));

  // 字面：命中的实词有多稀罕（IDF 之和 / 最大可能的 IDF，封顶 1）。不按命中占比算：
  // 她话里没人提过的词（"换了""新的"）本来就撞不上什么，不该拉低撞上的那个（"耳机"）
  const gs = keywords(cue);
  // keywords 把英文转了小写，被搜的也转
  const low = new Map(all.map((r) => [r.event_id, r.text.toLowerCase()]));
  const df = new Map(gs.map((g) => [g, all.filter((r) => low.get(r.event_id)!.includes(g)).length]));
  const idf = (g: string) => Math.log((all.length + 1) / ((df.get(g) ?? 0) + 1));
  const total = Math.log(all.length + 1) || 1;
  const vec = (id: string) => (qvec && model ? vectorOf(c.db, id, model) : null);
  return all.map((r) => {
    const lex = Math.min(1, gs.filter((g) => low.get(r.event_id)!.includes(g)).reduce((s, g) => s + idf(g), 0) / total);
    const v = vec(r.event_id);
    const cos = v && qvec ? cosine(qvec, v) : 0;
    return { row: r, lex, cos };
  });
}

function baseOfEvent(c: Ctx, id: string): { felt: number; consequence: number } {
  const ev = c.store.get(id);
  const felt = ev?.kind === "episode" && (ev.payload as { felt?: string }).felt ? W.felt : 0;
  const cited = c.db.query(`SELECT 1 FROM links l JOIN events e ON e.id = l.from_id WHERE l.to_id = ? AND l.rel IN ('evidence', 'revises') LIMIT 1`).get(id);
  return { felt, consequence: cited ? W.consequence : 0 };
}

function hunches(c: Ctx): Surfaced[] {
  const tz = c.store.timeZone;
  const slot = slotOf(c.now, tz);
  const slotStart = c.now - (wallClock(c.now, tz).hour - slot * 6) * HOUR - wallClock(c.now, tz).minute * 60_000;
  const from = c.now - W.hunchWindowDays * DAY;
  const rows = c.db
    .query(`SELECT at, json_extract(payload, '$.from') AS who FROM events WHERE fonds = '' AND kind = 'message.in' AND at >= ? AND at <= ? ORDER BY at`)
    .all(from, c.now) as { at: number; who: string }[];
  const out: Surfaced[] = [];
  // 只对它 track 了到达的人报（attention.md §四）："她该来没来"不由系统默认替它惦记
  const tracked = trackedByPerson(c.db);
  for (const who of new Set(rows.map((r) => r.who))) {
    if (!tracked.get(who)?.has("arrivals")) continue;
    const mine = rows.filter((r) => r.who === who);
    const days = new Set(mine.map((r) => localDay(r.at, tz)));
    const inSlot = new Set(mine.filter((r) => slotOf(r.at, tz) === slot).map((r) => localDay(r.at, tz)));
    const share = inSlot.size / Math.max(1, days.size);
    const last = mine.at(-1)!.at;
    if (share < W.hunchShare || last >= slotStart || days.size < 7) continue;
    out.push({
      source: "hunch",
      ref: `hunch:${who}:${localDay(c.now, tz)}:${slot}`,
      text: `${who}：最近 ${days.size} 天里有 ${inSlot.size} 天${SLOTS[slot]}来过；今天${SLOTS[slot]}还没来；上一条在 ${ago(c.now - last)}前（${stamp(last, tz)}）`,
      score: 1,
      parts: { share },
    });
  }
  return out;
}

/** 条目的证据发生在哪些地方：经所在会话的处境查（情节按它记的会话） */
function evidencePlaces(c: Ctx, root: string): Set<string> {
  const ids = c.db.query(`SELECT event_id FROM p_shelf_ev WHERE root = ? AND stance IN ('for', 'against')`).all(root) as { event_id: string }[];
  const out = new Set<string>();
  for (const { event_id } of ids) {
    const ev = c.store.get(event_id);
    const h = ev ? harnessOf(c.store, sessionOf(c.db, ev)) : null;
    if (h) out.add(h);
  }
  return out;
}

function shelfScore(e: ShelfEntry, cue: string, qvec: Float32Array | null, v: Float32Array | null, now: number) {
  const watch = e.watch?.some((w) => cue.includes(w)) ? W.watch : 0;
  const ks = keywords(cue);
  const hay = [e.text, e.when, e.then, e.quote].filter(Boolean).join(" ").toLowerCase();
  const lex = ks.length ? ks.filter((k) => hay.includes(k)).length / ks.length : 0;
  const cos = qvec && v ? cosine(qvec, v) : 0;
  const ev = Math.min(e.for, 4) * W.evidence + (e.lastEvidenceAt && now - e.lastEvidenceAt < 14 * DAY ? W.evidenceRecent : 0);
  return { watch, lex: lex * W.lexical, vec: Math.max(0, Math.min(1, (cos - W.vecFloor) / W.vecSpan)) * W.vec, evidence: ev };
}

export async function surface(
  store: EventStore,
  embedder: Embedder | undefined,
  opts: { session?: string; dry?: boolean; seed?: number; storeOf?: (id: string) => EventStore | undefined } = {},
): Promise<SurfaceResult> {
  const c: Ctx = { db: store.db, store, now: store.now(), session: opts.session ?? ((store.situation?.payload as { session?: string } | undefined)?.session ?? null) };
  const { mode, turnStart, herNow } = modeOf(c);
  const m = MODES[mode];
  const { text: cue, now: cueNow, fromLastTime } = cueText(c, herNow, turnStart, mode === "fresh");
  const idle = !!herNow && isIdle(herNow.text);
  const rand = mulberry32(opts.seed ?? Math.floor(c.now / 60_000));
  const noise = () => (rand() * 2 - 1) * m.noise;
  const block = refractory(c);

  let qvec: Float32Array | null = null;
  if (embedder && cue.trim() && !idle) {
    try {
      await syncVectors(store.db, embedder);
      // 她这一轮的话够长就只嵌它（前几行会把意思冲淡）；太短（"嗯 在吗"）才带上前文
      [qvec] = await embedder.embed([Array.from(cueNow).length >= 6 ? cueNow : cue]);
    } catch (e) {
      console.error(`浮现的向量失败，只用字面：${e instanceof Error ? e.message : e}`);
    }
  }
  const model = qvec ? embedder!.model : null;
  const here = (store.situation?.payload as { harness?: string } | undefined)?.harness ?? null;
  const year = Number(localDay(c.now, store.timeZone).slice(0, 4));

  // 刚回来：上次怎么散的（另一个会话里和她的最后几行）先想起来，不和别的比分
  const lastTime: Surfaced[] = [];
  const tail = fromLastTime.filter((r) => r.session !== c.session);
  if (tail.length && !block.has(tail.at(-1)!.event_id))
    lastTime.push({
      source: "recall",
      ref: tail.at(-1)!.event_id,
      text: tail.map((r) => `[${displayArchiveNo(r.archive_no, year)}] ${stamp(r.at, store.timeZone)} ${r.text}`).join("\n"),
      score: 1,
      parts: { lastTime: 1 },
    });
  const skip = new Set(tail.map((r) => r.event_id));

  const scored: Surfaced[] = [];
  // 此刻的环境（m8.md §4.1）：放着什么、谁在。没在放歌就不比（屋里天天是那几个人，单靠人不浮现）
  const envHere: Env = envNow(store, opts.storeOf);
  const byEnv = envHere.tracks.length > 0;
  if (cue.trim() || byEnv) {
    for (const { row, lex, cos } of idle && !byEnv ? [] : recallCandidates(c, cueNow, qvec, model, block)) {
      if (skip.has(row.event_id)) continue;
      const cueScore = idle ? 0 : lex * W.lexical + Math.max(0, Math.min(1, (cos - W.vecFloor) / W.vecSpan)) * W.vec;
      const ev = byEnv ? store.get(row.event_id) : null;
      const env = ev ? envSimilarity(envHere, envOf(store, ev, opts.storeOf)) : { song: 0, artist: 0, people: 0 };
      if (cueScore + env.song + env.artist <= 0) continue;
      // 只靠环境撞上的，刚发生的不算"想起"（这首歌还在放，刚写的情节自然也带着它）
      if (cueScore <= 0 && c.now - row.at < 30 * 60_000) continue;
      const b = baseOfEvent(c, row.event_id);
      const parts = {
        lex: idle ? 0 : lex * W.lexical,
        vec: idle ? 0 : cueScore - lex * W.lexical,
        ...(env.song ? { song: env.song } : {}),
        ...(env.artist ? { artist: env.artist } : {}),
        ...(env.people ? { people: env.people } : {}),
        ...b,
        noise: noise(),
      };
      scored.push({
        source: "recall",
        ref: row.event_id,
        text: `[${displayArchiveNo(row.archive_no, year)}] ${stamp(row.at, store.timeZone)} ${row.text}`,
        score: Object.values(parts).reduce((s, x) => s + x, 0),
        parts,
      });
    }
    // 钉在常驻区的已经每轮都在了，名额留给别的（self/pinned.ts）
    const pinned = new Set(pinnedRoots(store));
    for (const e of cue.trim() ? readShelf(store.db) : []) {
      if (block.has(e.root) || pinned.has(e.root)) continue;
      const p: Record<string, number> = shelfScore(e, cueNow, qvec, model ? vectorOf(store.db, e.current, model) : null, c.now);
      if (here && evidencePlaces(c, e.root).has(here)) p.place = W.place;
      if (idle) p.lex = 0; // 空档只认它写的留意词
      if (p.watch + p.lex + p.vec <= 0) continue;
      const parts = { ...p, noise: noise() };
      scored.push({
        source: "expect",
        ref: e.root,
        text: `[${displayArchiveNo(e.archiveNo, year)}]${renderEntry(e)}`,
        score: Object.values(parts).reduce((s, x) => s + x, 0),
        parts,
      });
    }
  }
  const hs = hunches(c).filter((h) => !block.has(h.ref));
  scored.sort((a, b) => b.score - a.score);
  const passed = scored.filter((s) => s.score >= m.threshold);
  const fixed = [...hs, ...lastTime];
  const items = [...fixed, ...passed].slice(0, Math.max(m.max, fixed.length));
  const result: SurfaceResult = { mode, idle, cue, items };
  if (opts.dry) result.rest = scored.filter((s) => !items.includes(s)).slice(0, 8);
  else
    store.db.transaction(() => {
      for (const it of items)
        store.append({ kind: "surfaced", class: "experience", source: "psyche", payload: { ref: it.ref, source: it.source, score: Math.round(it.score * 1000) / 1000, cue: cue.slice(0, 300) } });
    })();
  return result;
}

/** `<now>` 里的那一块：有才出 */
export function renderSurfaced(r: SurfaceResult): string | null {
  return r.items.length ? ["想起：", ...r.items.map((i) => i.text)].join("\n") : null;
}
