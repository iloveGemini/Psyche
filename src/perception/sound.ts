/**
 * 自己的声音（m8.md §三，M8b）：它为自己放歌、建歌单、听；和别人分一只耳机。
 *
 * - 播放器是虚的（§3.4）：放 = 一条 `played { tracks, startAt }`，此刻放到哪现算；只有有人分耳机时才真的出声。
 * - 听到的不另存 percept：从 played + 歌词 + 特征确定地算；递一次写 percept.noticed（sensor = sound），它的经历就是那几行。
 * - 歌单以 Psyche 为准（`playlist.changed`）；它的"喜欢"是它自己一个叫「喜欢的」的歌单。
 */
import type { EventStore, PsycheEvent } from "../store/events.ts";
import { ownSince } from "../self/self.ts";
import { clockOf } from "../core/time.ts";
import { parseLrc, type MusicSource, type Track } from "./netease.ts";
import { describeSection, featuresOf, type Features } from "./features.ts";
import { resolveSession } from "../catalog/hotwrite.ts";

export class SoundError extends Error {}
export const LIKED = "喜欢的";
const MAX_LYRIC_LINES = 8;

// ── 歌单 ──

export type PlaylistOp = "create" | "add" | "remove" | "delete";

export function readPlaylists(store: EventStore): Map<string, Track[]> {
  const lists = new Map<string, Track[]>();
  for (const ev of ownSince(store, "playlist.changed")) {
    const p = ev.payload as { name: string; op: PlaylistOp; track?: Track };
    if (p.op === "create") lists.set(p.name, lists.get(p.name) ?? []);
    else if (p.op === "delete") lists.delete(p.name);
    else if (p.op === "add") lists.set(p.name, [...(lists.get(p.name) ?? []).filter((t) => t.id !== p.track!.id), p.track!]);
    else if (p.op === "remove") lists.set(p.name, (lists.get(p.name) ?? []).filter((t) => t.id !== p.track!.id));
  }
  return lists;
}

/** POST /v1/playlist：{ op, name, query? | track? }；add 给 query 就搜第一首 */
export async function changePlaylist(store: EventStore, music: MusicSource, body: Record<string, unknown>) {
  const { op, name } = body;
  if (!["create", "add", "remove", "delete"].includes(op as string)) throw new SoundError("op 应为 create / add / remove / delete");
  if (typeof name !== "string" || !name.trim()) throw new SoundError("缺 name（歌单名）");
  const n = name.trim();
  const lists = readPlaylists(store);
  if (op === "create" && lists.has(n)) throw new SoundError(`已经有「${n}」了`);
  if ((op === "remove" || op === "delete") && !lists.has(n)) throw new SoundError(`没有「${n}」这个歌单`);
  let track: Track | undefined;
  if (op === "add" || op === "remove") {
    track = await pickTrack(music, body, op === "remove" ? lists.get(n) : undefined);
    if (op === "remove" && !lists.get(n)!.some((t) => t.id === track!.id)) throw new SoundError(`「${n}」里没有《${track.title}》`);
  }
  store.append({ kind: "playlist.changed", class: "self", source: "agent", payload: { name: n, op, ...(track ? { track } : {}) } });
  return { name: n, tracks: readPlaylists(store).get(n) ?? [] };
}

/** track（id / 已知曲目）优先，否则 query 搜第一首；in 给了就只在这个歌单里按名找 */
async function pickTrack(music: MusicSource, body: Record<string, unknown>, within?: Track[]): Promise<Track> {
  const q = typeof body.query === "string" ? body.query.trim() : "";
  const id = typeof body.trackId === "string" ? body.trackId.trim() : "";
  if (within) {
    const t = within.find((x) => x.id === id || (q && (x.title.includes(q) || `${x.title} ${x.artist}`.includes(q))));
    if (!t) throw new SoundError(`歌单里找不到「${q || id}」`);
    return t;
  }
  if (!q && !id) throw new SoundError("要给 query（搜什么）或 trackId");
  const hits = await music.search(q || id);
  const t = id ? hits.find((h) => h.id === id) : bestMatch(q, hits);
  if (!t) throw new SoundError(`没搜到「${q || id}」`);
  return t;
}

/** 搜索结果里挑：歌名对得上的优先（网易云的第一首常是翻唱、或只是专辑名对上，10-16 a1 撞到） */
export function bestMatch(q: string, hits: Track[]): Track | undefined {
  const norm = (x: string) => x.toLowerCase().replace(/[\s()（）\[\]【】.,，。'"-]/g, "");
  const nq = norm(q);
  const score = (t: Track) => {
    const title = norm(t.title);
    if (title === nq) return 4;
    if (nq.includes(title) && nq.includes(norm(t.artist).split("/")[0])) return 3; // 「晴天 周杰伦」
    if (nq.startsWith(title) || title.startsWith(nq)) return 2;
    if (title.includes(nq) || nq.includes(title)) return 1;
    return 0;
  };
  return [...hits].sort((a, b) => score(b) - score(a))[0];
}

/** 放的那首和搜的对不对得上（不全对得上就告诉它，别让它放了才发现） */
export function matches(q: string, t: Track): boolean {
  return bestMatch(q, [t]) !== undefined && (q.toLowerCase().replace(/\s/g, "").includes(t.title.toLowerCase().replace(/\s/g, "")) || t.title.toLowerCase().includes(q.toLowerCase().trim()));
}

// ── 播放器（虚的，现算） ──

export interface Playing {
  track: Track;
  index: number;
  of: number;
  /** 这首放到第几秒 */
  pos: number;
  /** 这首从什么时刻开始放 */
  startedAt: number;
}

/** 某人此刻在放什么：最后一条 played / stopped 定；放完了返回 null */
export function nowPlaying(store: EventStore, at = store.now()): (Playing & { ev: PsycheEvent }) | null {
  const ev = store.list({ kinds: ["played", "stopped"], fonds: "", limit: 100_000 }).filter((e) => e.at <= at).at(-1);
  if (!ev || ev.kind !== "played") return null;
  return positionIn(ev, at);
}

export function positionIn(ev: PsycheEvent, at: number): (Playing & { ev: PsycheEvent }) | null {
  const { tracks, startAt } = ev.payload as { tracks: Track[]; startAt: number };
  let t = (at - startAt) / 1000;
  let begin = startAt;
  for (let i = 0; i < tracks.length; i++) {
    if (t < tracks[i].duration) return { track: tracks[i], index: i, of: tracks.length, pos: Math.max(0, t), startedAt: begin, ev };
    t -= tracks[i].duration;
    begin += tracks[i].duration * 1000;
  }
  return null;
}

/** POST /v1/play：{ query? | trackId? | playlist? , shuffle? } */
export async function play(store: EventStore, music: MusicSource, body: Record<string, unknown>) {
  let tracks: Track[];
  let from: string | undefined;
  if (typeof body.playlist === "string" && body.playlist.trim()) {
    const name = body.playlist.trim();
    const list = readPlaylists(store).get(name);
    if (!list) throw new SoundError(`没有「${name}」这个歌单`);
    if (!list.length) throw new SoundError(`「${name}」是空的`);
    tracks = body.shuffle === true ? shuffled(list) : list;
    from = name;
  } else tracks = [await pickTrack(music, body)];
  const ev = store.append({ kind: "played", class: "self", source: "agent", payload: { tracks, startAt: store.now(), ...(from ? { playlist: from } : {}) } });
  const q = typeof body.query === "string" ? body.query.trim() : "";
  return { playing: tracks[0], of: tracks.length, ev, ...(q && !from && !matches(q, tracks[0]) ? { mismatch: true } : {}) };
}

export function stop(store: EventStore) {
  if (!nowPlaying(store)) throw new SoundError("现在没在放");
  store.append({ kind: "stopped", class: "self", source: "agent", payload: {} });
  return { ok: true };
}

function shuffled<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── 歌词缓存（资料库 + 系统日志记哈希） ──

export function cachedLyric(store: EventStore, id: string): string | null | undefined {
  const r = store.readSyslog({ kind: "track.lyric", limit: 100_000 }).find((l) => (l.detail as { id: string }).id === id);
  if (!r) return undefined;
  const h = (r.detail as { hash?: string }).hash;
  return h ? (store.getMaterial(h)?.text() ?? null) : null;
}

export async function ensureLyric(store: EventStore, music: MusicSource, id: string): Promise<string | null> {
  const c = cachedLyric(store, id);
  if (c !== undefined) return c;
  const lrc = await music.lyric(id).catch(() => undefined);
  store.syslog("track.lyric", { id, ...(lrc ? { hash: store.putMaterial(lrc) } : {}) });
  return lrc ?? null;
}

// ── 一起听 ──

/** 我此刻跟着谁的播放器听（自己的就是 undefined） */
export function listeningTo(store: EventStore): string | undefined {
  const ev = store.list({ kinds: ["listen.joined", "listen.left"], fonds: "", limit: 100_000 }).at(-1);
  return ev?.kind === "listen.joined" ? (ev.payload as { host: string }).host : undefined;
}

/** 谁戴着我的耳机：别人来戴 / 摘是我经历到的（ear.joined / ear.left，屋子写进我的库） */
export function listenersOf(store: EventStore): string[] {
  const on = new Map<string, boolean>();
  for (const e of store.list({ kinds: ["ear.joined", "ear.left"], fonds: "", limit: 100_000 })) on.set((e.payload as { who: string }).who, e.kind === "ear.joined");
  return [...on].filter(([, v]) => v).map(([k]) => k);
}

// ── 递 ──

const pad = (n: number) => String(n).padStart(2, "0");
const mmss = (s: number) => `${Math.floor(s / 60)}:${pad(Math.floor(s % 60))}`;
const hhmm = (at: number, tz: string, now: number) => clockOf(at, now, tz);
const name = (t: Track) => `《${t.title}》${t.artist}`;

export interface SoundDeps {
  music: MusicSource;
  /** 跨住户读别人的播放器（一起听）；没有就只听自己的 */
  storeOf?: (id: string) => EventStore | undefined;
  /** 后台算特征（不等它）；考卷里同步给 */
  analyze?: (track: Track) => void;
}

/**
 * <now> 的「这段时间听到的」：本会话上次递到之后——放完了哪几首、现在这首放到哪、唱过的几行、这一段的特征、谁戴上 / 摘下了耳机。
 * 没在放、也没变化 → null，不写。
 */
export async function deliverSound(store: EventStore, deps: SoundDeps, session: string | undefined, opts: { looked?: boolean } = {}): Promise<string | null> {
  const now = store.now();
  const tz = store.timeZone;
  // 递到哪了：本会话递过就从那次算；新会话（含睡着、收尾那段）接任何会话最后递到的那次——递过的不再翻；
  // 从没递过：只看最近 6 小时（同屋里的东西）
  const noticed = store.list({ kinds: ["percept.noticed"], fonds: "", limit: 100_000 }).filter((e) => (e.payload as { sensor?: string }).sensor === "sound");
  const last = noticed.filter((e) => (e.payload as { session?: string }).session === session).at(-1) ?? noticed.at(-1);
  const since = last?.at;
  const sinceId = last?.id;
  const floor = last ? 0 : now - 6 * 3_600_000;

  const host = listeningTo(store);
  const src = host ? deps.storeOf?.(host) : store;
  const lines: string[] = [];

  // 耳机：别人戴上 / 摘下我的（只报变化）；我跟着谁听
  const ear = store
    .list({ kinds: ["ear.joined", "ear.left"], fonds: "", limit: 100_000 })
    // 按入库次序比：同一毫秒里先递、后摘的也分得清
    .filter((e) => (sinceId === undefined || e.id > sinceId) && e.at >= floor);
  for (const e of ear) lines.push(`${(e.payload as { who: string }).who} ${e.kind === "ear.joined" ? "戴上了你的一只耳机" : "摘下了耳机"}（${hhmm(e.at, tz, now)}）`);
  if (host) lines.push(src ? `你戴着 ${host} 的一只耳机` : `你戴着 ${host} 的一只耳机，但这会儿听不到他那边`);

  if (src) {
    // 上次递到之后放完的
    const plays = src.list({ kinds: ["played", "stopped"], fonds: "", limit: 100_000 });
    const cur = nowPlaying(src, now);
    if (since !== undefined) {
      const done: Track[] = [];
      for (const ev of plays.filter((e) => e.kind === "played")) {
        const { tracks, startAt } = ev.payload as { tracks: Track[]; startAt: number };
        const stopAt = plays.find((e) => e.at > ev.at)?.at ?? now;
        let begin = startAt;
        for (const t of tracks) {
          const end = begin + t.duration * 1000;
          if (end > since && end <= Math.min(stopAt, now)) done.push(t);
          begin = end;
        }
      }
      const stopped = plays.find((e) => e.kind === "stopped" && e.at > since);
      if (done.length) lines.push(`放完了：${done.map(name).join("、")}`);
      if (stopped && !cur) lines.push(`停了（${hhmm(stopped.at, tz, now)}）`);
    }
    if (cur) {
      const pl = (cur.ev.payload as { playlist?: string }).playlist;
      lines.push(`正在放：${name(cur.track)}，${mmss(cur.pos)} / ${mmss(cur.track.duration)}${cur.of > 1 ? `（${pl ? `「${pl}」` : ""}第 ${cur.index + 1} 首，共 ${cur.of} 首）` : ""}`);
      const lrc = parseLrc((await ensureLyric(store, deps.music, cur.track.id)) ?? undefined);
      // 唱过的：这首里，上次递到（或这首开始）之后到此刻
      const fromPos = since !== undefined && since > cur.startedAt ? (since - cur.startedAt) / 1000 : opts.looked ? Math.max(0, cur.pos - 20) : 0;
      const sung = lrc.filter((l) => l.time > fromPos && l.time <= cur.pos).map((l) => l.text);
      if (sung.length) lines.push(`刚唱过：${sung.length > MAX_LYRIC_LINES ? `……${sung.slice(-MAX_LYRIC_LINES).join(" / ")}` : sung.join(" / ")}`);
      else if (!lrc.length) lines.push("（没有歌词，或是纯音乐）");
      const f = featuresOf(store, cur.track.id);
      if (f) lines.push(`这一段：${describeSection(f, cur.pos)}`);
      else deps.analyze?.(cur.track);
    }
  }

  // 在放着就每轮都报（声音一直在）；没在放、也没变化就不报
  if (!lines.length) return null;
  const text = [opts.looked ? "听：" : "这段时间听到的：", ...lines.map((l) => `- ${l}`)].join("\n");
  const situation = (session ? store.situationOfSession(session, now) : null) ?? undefined;
  store.append({ kind: "percept.noticed", class: "experience", source: "psyche", situation, payload: { sensor: "sound", refs: [], text, ...(opts.looked ? { looked: true } : {}), ...(session ? { session } : {}) } });
  return text;
}

/** look 听一下：此刻在放的、最近 20 秒唱过的；算在它此刻所在的会话上 */
export async function listenNow(store: EventStore, deps: SoundDeps, session?: string): Promise<string> {
  if (!session)
    try {
      session = resolveSession(store, undefined);
    } catch {
      // 还没有会话
    }
  return (await deliverSound(store, deps, session, { looked: true })) ?? "什么也没在放。";
}

/** 跟着某人的播放器听 / 摘下（自己的动作）；对方库里记 ear.*，由调用方（app）写 */
export function listenWith(store: EventStore, host: string | null) {
  const cur = listeningTo(store);
  if (host === null) {
    if (!cur) throw new SoundError("你没戴着谁的耳机");
    store.append({ kind: "listen.left", class: "self", source: "agent", payload: { host: cur } });
    return { left: cur };
  }
  if (cur === host) throw new SoundError(`已经戴着 ${host} 的了`);
  if (cur) store.append({ kind: "listen.left", class: "self", source: "agent", payload: { host: cur } });
  store.append({ kind: "listen.joined", class: "self", source: "agent", payload: { host } });
  return { joined: host, ...(cur ? { left: cur } : {}) };
}

export type { Features };
