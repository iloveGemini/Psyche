/**
 * 环境指纹（m8.md §四，M8c）：一段时间里它所处的环境——放着哪些歌、全屋有谁在。
 *
 * - 被动：不用它写。情节发生的那段时间（所引原件的首尾）的指纹，事后从 played / 一起听 / 在场的 percept 算得出来，
 *   所以不另存；过去的不会再变，算过一次就缓存。
 * - 联想拿此刻的指纹和旧情节的比（surface.ts 的 env 一项）：同一首歌 > 同一个歌手；同一拨人在。
 */
import type { EventStore, PsycheEvent } from "../store/events.ts";
import type { Track } from "./netease.ts";
import { around, type Perceived } from "../house/presence.ts";

export interface Env {
  /** 这段时间听到的歌（自己放的，或戴着谁的耳机听的） */
  tracks: { id: string; title: string; artist: string }[];
  /** 这段时间在跟前的人：同一间房里的住户在线（忙 / 闲）、Joy 有动静 */
  people: string[];
}

/** 某首歌在 [from, to] 里被我听到的每一段（自己放的；跟着谁听的算谁的） */
export function hearings(store: EventStore, trackId: string, from: number, to: number, storeOf?: (id: string) => EventStore | undefined): { from: number; to: number; began: number }[] {
  const out: { from: number; to: number; began: number }[] = [];
  const spans: { host: string | null; from: number; to: number }[] = [];
  let cur: { host: string | null; at: number } = { host: null, at: 0 };
  for (const e of store.list({ kinds: ["listen.joined", "listen.left"], fonds: "", limit: 100_000 })) {
    spans.push({ host: cur.host, from: cur.at, to: e.at });
    cur = { host: e.kind === "listen.joined" ? (e.payload as { host: string }).host : null, at: e.at };
  }
  spans.push({ host: cur.host, from: cur.at, to: Number.MAX_SAFE_INTEGER });
  for (const s of spans) {
    const src = s.host ? storeOf?.(s.host) : store;
    if (!src) continue;
    const plays = src.list({ kinds: ["played", "stopped"], fonds: "", limit: 100_000 });
    plays.forEach((ev, i) => {
      if (ev.kind !== "played") return;
      const stopAt = plays[i + 1]?.at ?? Number.MAX_SAFE_INTEGER;
      let begin = (ev.payload as { startAt: number }).startAt;
      for (const t of (ev.payload as { tracks: Track[] }).tracks) {
        const end = Math.min(begin + t.duration * 1000, stopAt);
        const a = Math.max(begin, s.from, from);
        const b = Math.min(end, s.to, to);
        if (t.id === trackId && a < b) out.push({ from: a, to: b, began: begin });
        begin += t.duration * 1000;
      }
    });
  }
  return out.sort((x, y) => x.from - y.from);
}

/** [from, to] 里听到的歌：按 played / stopped 和一起听的区间算（跟着谁听就算谁的播放器） */
function tracksBetween(store: EventStore, from: number, to: number, storeOf?: (id: string) => EventStore | undefined): Env["tracks"] {
  const out = new Map<string, { title: string; artist: string }>();
  // 我在哪些时段跟着谁听
  const spans: { host: string | null; from: number; to: number }[] = [];
  let cur: { host: string | null; at: number } = { host: null, at: 0 };
  for (const e of store.list({ kinds: ["listen.joined", "listen.left"], fonds: "", limit: 100_000 })) {
    spans.push({ host: cur.host, from: cur.at, to: e.at });
    cur = { host: e.kind === "listen.joined" ? (e.payload as { host: string }).host : null, at: e.at };
  }
  spans.push({ host: cur.host, from: cur.at, to: Number.MAX_SAFE_INTEGER });

  for (const s of spans) {
    const a = Math.max(from, s.from);
    const b = Math.min(to, s.to);
    if (a > b) continue;
    const src = s.host ? storeOf?.(s.host) : store;
    if (!src) continue;
    const plays = src.list({ kinds: ["played", "stopped"], fonds: "", limit: 100_000 });
    plays.forEach((ev, i) => {
      if (ev.kind !== "played") return;
      const end = Math.min(plays[i + 1]?.at ?? Number.MAX_SAFE_INTEGER, b);
      let begin = (ev.payload as { startAt: number }).startAt;
      for (const t of (ev.payload as { tracks: Track[] }).tracks) {
        const tEnd = begin + t.duration * 1000;
        if (begin <= end && tEnd > a) out.set(t.id, { title: t.title, artist: t.artist });
        begin = tEnd;
      }
    });
  }
  return [...out].map(([id, t]) => ({ id, ...t }));
}

/** [from, to] 里在跟前的人：到 to 为止每人最后记下的样子，或这段时间里出现过在跟前 */
function peopleBetween(store: EventStore, from: number, to: number): string[] {
  const rows = store.list({ kinds: ["percept"], fonds: "", limit: 100_000 }).filter((e) => (e.payload as { sensor: string }).sensor === "presence" && e.at <= to);
  const last = new Map<string, Perceived>();
  const seen = new Set<string>();
  // 在跟前：同一间房里在线 / 有动静（houses.md §三「环境指纹按房子 + 房间算」：记下的就是按位置过滤过的那一面）
  const here = around;
  for (const e of rows) {
    const p = e.payload as { subject: string; value: Perceived };
    if (e.at >= from && here(p.value)) seen.add(p.subject);
    last.set(p.subject, p.value);
  }
  for (const [k, v] of last) if (here(v)) seen.add(k);
  return [...seen].sort();
}

export function envBetween(store: EventStore, from: number, to: number, storeOf?: (id: string) => EventStore | undefined): Env {
  return { tracks: tracksBetween(store, from, to, storeOf), people: peopleBetween(store, from, to) };
}

/** 此刻（最近 5 分钟）的指纹 */
export function envNow(store: EventStore, storeOf?: (id: string) => EventStore | undefined): Env {
  const now = store.now();
  return envBetween(store, now - 5 * 60_000, now, storeOf);
}

/** 一条情节 / 观察发生那段时间的指纹：情节按所引原件的首尾，观察按它自己记下的 */
const cache = new WeakMap<EventStore, Map<string, Env>>();
export function envOf(store: EventStore, ev: PsycheEvent, storeOf?: (id: string) => EventStore | undefined): Env {
  if (ev.kind === "notice") return (ev.payload as { env?: Env }).env ?? { tracks: [], people: [] };
  let m = cache.get(store);
  if (!m) cache.set(store, (m = new Map()));
  const hit = m.get(ev.id);
  if (hit) return hit;
  const cited = store.linksFrom(ev.id).filter((l) => l.rel === "cites").map((l) => store.get(l.to)?.at).filter((x): x is number => x !== undefined);
  const from = cited.length ? Math.min(...cited) : ev.at;
  const to = cited.length ? Math.max(...cited) : ev.at;
  const env = envBetween(store, from, to, storeOf);
  // 还在发生的不缓存（这段可能还在放）
  if (to < store.now() - 10 * 60_000) m.set(ev.id, env);
  return env;
}

export const W_ENV = { song: 0.6, artist: 0.3, people: 0.15 };

/** 此刻和那时像不像：同一首歌 > 同一个歌手；同一拨人在（Jaccard）。都没有就 0 */
export function envSimilarity(now: Env, then: Env): { song: number; artist: number; people: number } {
  const ids = new Set(now.tracks.map((t) => t.id));
  const artists = new Set(now.tracks.flatMap((t) => t.artist.split("/")));
  const song = then.tracks.some((t) => ids.has(t.id)) ? W_ENV.song : 0;
  const artist = !song && then.tracks.some((t) => t.artist.split("/").some((a) => artists.has(a))) ? W_ENV.artist : 0;
  const a = new Set(now.people);
  const b = new Set(then.people);
  const inter = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  // 只有人对得上不够浮现（全屋天天是那几个人）；它是加分，不单独成立
  const people = (song || artist) && union ? (inter / union) * W_ENV.people : 0;
  return { song, artist, people };
}

// ── notice：主动注意到（m8.md §4.2） ──

export class NoticeError extends Error {}

/**
 * POST /v1/notice：{ text, about?, cites? }。系统顺手记下此刻的环境（指纹进 payload，此刻的播放和在场记录挂成证据）；
 * 它可再挂自己的经历 / 情节当证据。观察不是规律：冷写时和后来的事摆在一起，攒够了它自己升格。
 */
export function writeNotice(store: EventStore, body: Record<string, unknown>, storeOf?: (id: string) => EventStore | undefined) {
  const { text, about, cites } = body;
  if (typeof text !== "string" || !text.trim()) throw new NoticeError("text 是空的");
  if (about !== undefined && (typeof about !== "string" || !about.trim())) throw new NoticeError("about 应为字符串（self / 住户 id / Joy）");
  if (cites !== undefined && !Array.isArray(cites)) throw new NoticeError("cites 应为档号数组");
  const links: { to: string; rel: string }[] = [];
  for (const c of (cites as unknown[] | undefined) ?? []) {
    const ev = typeof c === "string" ? store.byArchiveNo(c.trim().replace(/^\[|\]$/g, "")) : null;
    if (!ev) throw new NoticeError(`引的 ${String(c)} 查不到`);
    if (ev.fonds) throw new NoticeError(`引的 ${c} 不是你的`);
    links.push({ to: ev.id, rel: "evidence" });
  }
  const now = store.now();
  const env = envNow(store, storeOf);
  // 此刻的环境挂成证据：我库里最近一条播放、每人最后一条在场
  const lastPlay = store.list({ kinds: ["played", "stopped"], fonds: "", limit: 100_000 }).at(-1);
  if (lastPlay?.kind === "played") links.push({ to: lastPlay.id, rel: "evidence" });
  const latest = new Map<string, string>();
  for (const e of store.list({ kinds: ["percept"], fonds: "", limit: 100_000 })) if (e.at <= now) latest.set((e.payload as { subject?: string }).subject ?? e.id, e.id);
  for (const id of latest.values()) links.push({ to: id, rel: "evidence" });
  const ev = store.append({ kind: "notice", class: "self", source: "agent", payload: { text: text.trim(), ...(about ? { about: (about as string).trim() } : {}), env }, links });
  return { id: ev.id, archiveNo: ev.archiveNo, env };
}
