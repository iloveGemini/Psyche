/**
 * 网易云（m8.md §3.1 §3.4）：照搬 Roxy `packages/desktop/lib/music/provider.ts` 的读法。
 *
 * 全屋共用 Joy 的会员账号：cookie 从 PSYCHE_NCM_COOKIE（文件路径，Roxy 的 cookies.json 格式）读。
 * 只用到：搜歌、歌曲详情（时长）、播放地址、歌词；镜像歌单（建 / 加 / 删）要 PSYCHE_NCM_MIRROR=1 才开。
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";

export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  /** 秒 */
  duration: number;
}

/** 放歌要的几样；考卷换成假的 */
export interface MusicSource {
  search(q: string): Promise<Track[]>;
  url(id: string): Promise<string | undefined>;
  lyric(id: string): Promise<string | undefined>;
}

interface Song {
  id: number | string;
  name: string;
  ar?: { name: string }[];
  artists?: { name: string }[];
  al?: { name: string };
  album?: { name: string };
  dt?: number;
  duration?: number;
}
type Body<T> = Promise<{ body?: { code: number } & T }>;
interface Ncm {
  cloudsearch(q: Record<string, unknown>): Body<{ result?: { songs?: Song[] } }>;
  song_url_v1(q: Record<string, unknown>): Body<{ data?: { url?: string }[] }>;
  song_url(q: Record<string, unknown>): Body<{ data?: { url?: string }[] }>;
  lyric_new(q: Record<string, unknown>): Body<{ lrc?: { lyric?: string } }>;
}

const require = createRequire(import.meta.url);
let client: Ncm | null = null;
const ncm = () => (client ??= require("@neteasecloudmusicapienhanced/api") as Ncm);

function readCookie(file = process.env.PSYCHE_NCM_COOKIE): string {
  if (!file || !existsSync(file)) return "";
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { cookie?: string } | string;
    return typeof raw === "string" ? raw : (raw.cookie ?? "");
  } catch {
    return "";
  }
}

export function toTrack(s: Song): Track {
  const artists = s.ar ?? s.artists ?? [];
  return {
    id: String(s.id),
    title: s.name,
    artist: artists.map((a) => a.name).join("/") || "未知歌手",
    ...(s.al?.name || s.album?.name ? { album: s.al?.name ?? s.album?.name } : {}),
    duration: Math.round((s.dt ?? s.duration ?? 0) / 1000),
  };
}

export const netease: MusicSource = {
  async search(q) {
    const res = await ncm().cloudsearch({ keywords: q.trim(), type: 1, limit: 10, cookie: readCookie() });
    return (res.body?.result?.songs ?? []).map(toTrack).filter((t) => t.duration > 0);
  },
  async url(id) {
    const cookie = readCookie();
    const a = await ncm().song_url_v1({ id, level: "exhigh", cookie }).catch(() => undefined);
    const raw = a?.body?.data?.[0]?.url || (await ncm().song_url({ id, br: 320000, cookie }).catch(() => undefined))?.body?.data?.[0]?.url;
    return raw ? raw.replace(/^http:\/\//i, "https://") : undefined;
  },
  async lyric(id) {
    const res = await ncm().lyric_new({ id, cookie: readCookie() }).catch(() => undefined);
    return res?.body?.lrc?.lyric || undefined;
  },
};

/** LRC → [秒, 行]（同 Roxy lyrics.ts） */
export function parseLrc(lrc?: string): { time: number; text: string }[] {
  if (!lrc) return [];
  const out: { time: number; text: string }[] = [];
  const re = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;
  for (const line of lrc.split("\n")) {
    const times: number[] = [];
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) times.push(Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3].padEnd(3, "0").slice(0, 3)) / 1000 : 0));
    const text = line.replace(re, "").trim();
    // 作词 / 作曲那几行不是唱出来的
    if (text && !/^(作词|作曲|编曲|制作人|词|曲)\s*[:：]/.test(text)) for (const t of times) out.push({ time: t, text });
  }
  return out.sort((a, b) => a.time - b.time);
}
