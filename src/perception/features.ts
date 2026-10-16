/**
 * 音频特征（m8.md §3.2 §3.4）：ffmpeg 解成单声道 PCM，自己算，不过模型。
 *
 * - 每 5 秒一格：响度（RMS → dBFS）、明亮度（过零率，粗略的"亮 / 暗"）。
 * - 整首的速度：起音包络（每 ~23ms 的能量正增量）做自相关，在 60–180 BPM 里找峰。粗估，可能差一倍。
 * - 段落：前后各 3 格平均响度差 ≥ 3 dB 处切开。
 * 存资料库（JSON），系统日志 `track.features { id, hash }` 记着；同一首只算一次。
 */
import type { EventStore } from "../store/events.ts";

export interface Features {
  /** 每格秒数 */
  step: number;
  loud: number[];
  bright: number[];
  bpm: number | null;
  /** 段落起点（秒） */
  sections: number[];
}

export const RATE = 11025;
const STEP = 5;

export function featuresOf(store: EventStore, id: string): Features | null {
  const r = store.readSyslog({ kind: "track.features", limit: 100_000 }).find((l) => (l.detail as { id: string }).id === id);
  const h = (r?.detail as { hash?: string } | undefined)?.hash;
  if (!h) return null;
  try {
    return JSON.parse(store.getMaterial(h)!.text()) as Features;
  } catch {
    return null;
  }
}

/** PCM（-1..1）→ 特征。纯函数，考卷直接喂合成信号 */
export function analyzePcm(pcm: Float32Array, rate = RATE): Features {
  const n = Math.floor((STEP * rate));
  const loud: number[] = [];
  const bright: number[] = [];
  for (let i = 0; i + n / 2 < pcm.length; i += n) {
    const end = Math.min(pcm.length, i + n);
    let sum = 0;
    let zc = 0;
    for (let j = i; j < end; j++) {
      sum += pcm[j] * pcm[j];
      if (j > i && pcm[j] >= 0 !== pcm[j - 1] >= 0) zc++;
    }
    const rms = Math.sqrt(sum / (end - i));
    loud.push(Math.round(20 * Math.log10(Math.max(rms, 1e-6))));
    bright.push(Math.round((zc / (end - i)) * rate)); // 每秒过零次数
  }
  // 段落：前后各 3 格的平均响度差 |d| ≥ 3 dB、且是附近最大的那一格处切（真歌的主歌 / 副歌是渐变的，相邻格比太钝）；段落至少 15 秒
  const sections = [0];
  const d = loud.map((_, k) => (k === 0 ? 0 : meanOf(loud, k, k + 3) - meanOf(loud, k - 3, k)));
  for (let k = 1; k < loud.length; k++) {
    const peak = Math.abs(d[k]) >= 3 && Math.abs(d[k]) >= Math.abs(d[k - 1] ?? 0) && Math.abs(d[k]) >= Math.abs(d[k + 1] ?? 0);
    if (peak && k * STEP - sections.at(-1)! >= 15) sections.push(k * STEP);
  }
  return { step: STEP, loud, bright, bpm: estimateBpm(pcm, rate), sections };
}

function meanOf(xs: number[], a: number, b: number): number {
  const part = xs.slice(Math.max(0, a), Math.min(b, xs.length));
  return part.length ? part.reduce((x, y) => x + y, 0) / part.length : 0;
}

function estimateBpm(pcm: Float32Array, rate: number): number | null {
  const hop = 256;
  const env: number[] = [];
  let prev = 0;
  for (let i = 0; i + hop <= pcm.length; i += hop) {
    let e = 0;
    for (let j = i; j < i + hop; j++) e += pcm[j] * pcm[j];
    env.push(Math.max(0, e - prev));
    prev = e;
  }
  if (env.length < 200) return null;
  const fps = rate / hop;
  const mean = env.reduce((a, b) => a + b, 0) / env.length;
  const x = env.map((v) => v - mean);
  let best = 0;
  let bestLag = 0;
  for (let bpm = 60; bpm <= 180; bpm++) {
    const lag = Math.round((60 / bpm) * fps);
    let c = 0;
    for (let i = lag; i < x.length; i++) c += x[i] * x[i - lag];
    if (c > best) {
      best = c;
      bestLag = lag;
    }
  }
  return bestLag ? Math.round((60 * fps) / bestLag) : null;
}

/** 此刻这一段的样子，说成一行：响度相对整首、亮暗、速度；刚进新段落就说 */
export function describeSection(f: Features, pos: number): string {
  const k = Math.min(f.loud.length - 1, Math.floor(pos / f.step));
  if (k < 0) return "还没算出来";
  const sorted = [...f.loud].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.floor(p * (sorted.length - 1))];
  const l = f.loud[k];
  const level = l <= q(0.25) ? "整首里偏安静" : l >= q(0.75) ? "整首里偏响" : "整首里中等";
  const bs = [...f.bright].sort((a, b) => a - b);
  const b = f.bright[k];
  const tone = b <= bs[Math.floor(0.25 * (bs.length - 1))] ? "偏暗、偏闷" : b >= bs[Math.floor(0.75 * (bs.length - 1))] ? "偏亮、偏尖" : "";
  const sec = [...f.sections].reverse().find((s) => s <= pos) ?? 0;
  const turned = sec > 0 && pos - sec < f.step * 2 ? `刚在 ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")} ${meanOf(f.loud, sec / f.step, sec / f.step + 3) > meanOf(f.loud, sec / f.step - 3, sec / f.step) ? "变响" : "收下来"}；` : "";
  return `${turned}${level}（${l} dB）${tone ? `，${tone}` : ""}${f.bpm ? `；整首约 ${f.bpm} BPM（粗估）` : ""}`;
}

/** 后台算一首：ffmpeg 拉网易云地址解码 → 特征 → 存。同一首同时只算一次 */
const running = new Set<string>();
export async function analyzeTrack(store: EventStore, id: string, url: string | undefined): Promise<void> {
  if (!url || running.has(id) || featuresOf(store, id)) return;
  running.add(id);
  try {
    const proc = Bun.spawn(["ffmpeg", "-v", "error", "-i", url, "-ac", "1", "-ar", String(RATE), "-f", "f32le", "-"], { stdout: "pipe", stderr: "ignore" });
    const buf = await new Response(proc.stdout).arrayBuffer();
    if ((await proc.exited) !== 0 || buf.byteLength < RATE * 4) {
      store.syslog("track.features", { id, error: "解码失败" });
      return;
    }
    const f = analyzePcm(new Float32Array(buf));
    store.syslog("track.features", { id, hash: store.putMaterial(JSON.stringify(f), "application/json") });
  } finally {
    running.delete(id);
  }
}
