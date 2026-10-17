/**
 * 音频特征（m8.md §3.2 §3.4）：ffmpeg 解成单声道 PCM，自己算，不过模型。
 *
 * - 每 5 秒一格：响度（RMS → dBFS）、明亮度（过零率，粗略的"亮 / 暗"）。
 * - 整首的速度：起音包络（每 ~23ms 的能量正增量）做自相关，在 85–175 BPM 里找峰。粗估，可能差一倍。
 * - 段落：前后各 3 格平均响度差 ≥ 3 dB 处切开。
 * - v2（10-17 a1，「氛围」）：每 2048 点做一次 FFT——频谱质心（亮暗，比过零率靠谱）、频谱平坦度（颗粒 / 噪声多 vs 音高清楚）、
 *   整首的色度 → Krumhansl 调式模板估大调 / 小调。都是粗估，说的时候带上把握。
 * 存资料库（JSON），系统日志 `track.features { id, hash }` 记着；同一首只算一次（老版本的重算一次）。
 */
import type { EventStore } from "../store/events.ts";

export interface Features {
  /** 特征版本：低于 VERSION 的当没算过 */
  v?: number;
  /** 每格秒数 */
  step: number;
  loud: number[];
  bright: number[];
  bpm: number | null;
  /** 段落起点（秒） */
  sections: number[];
  /** 每格的频谱质心（Hz），v2 起 */
  centroid?: number[];
  /** 每格的频谱平坦度（0..1，越大越像噪声），v2 起 */
  flat?: number[];
  /** 整首的调式（粗估）；r 是和模板的相关，margin 是比另一种调式的最好那个高多少 */
  key?: { tonic: string; mode: "大调" | "小调"; r: number; margin: number } | null;
}

export const VERSION = 2;

export const RATE = 11025;
const STEP = 5;

export function featuresOf(store: EventStore, id: string): Features | null {
  const r = store.readSyslog({ kind: "track.features", limit: 100_000 }).find((l) => (l.detail as { id: string }).id === id);
  const h = (r?.detail as { hash?: string } | undefined)?.hash;
  if (!h) return null;
  try {
    const f = JSON.parse(store.getMaterial(h)!.text()) as Features;
    return (f.v ?? 1) >= VERSION ? f : null;
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
  return { v: VERSION, step: STEP, loud, bright, bpm: estimateBpm(pcm, rate), sections, ...spectral(pcm, rate, n, loud.length) };
}

// ── 频谱（v2） ──

const FFT = 2048;
const NOTES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
// Krumhansl–Kessler 调式模板（C 为主音）
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** 原地 radix-2 FFT */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len)
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
  }
}

/** 每格的质心、平坦度；整首的色度 → 调式。静音帧（< -50 dBFS）不算 */
function spectral(pcm: Float32Array, rate: number, cell: number, cells: number): Pick<Features, "centroid" | "flat" | "key"> {
  const hann = Float64Array.from({ length: FFT }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT - 1)));
  const hz = (k: number) => (k * rate) / FFT;
  const pcOf = new Int8Array(FFT / 2).map((_, k) => (hz(k) >= 55 && hz(k) <= 2000 ? ((Math.round(12 * Math.log2(hz(k) / 440)) + 69) % 12 + 12) % 12 : -1));
  const cSum = new Array(cells).fill(0);
  const fSum = new Array(cells).fill(0);
  const cnt = new Array(cells).fill(0);
  const chroma = new Array(12).fill(0);
  const re = new Float64Array(FFT);
  const im = new Float64Array(FFT);
  for (let i = 0; i + FFT <= pcm.length; i += FFT) {
    let e = 0;
    for (let j = 0; j < FFT; j++) {
      re[j] = pcm[i + j] * hann[j];
      im[j] = 0;
      e += pcm[i + j] * pcm[i + j];
    }
    if (10 * Math.log10(e / FFT + 1e-12) < -50) continue;
    fft(re, im);
    let mSum = 0;
    let wSum = 0;
    let logSum = 0;
    let pSum = 0;
    let bins = 0;
    for (let k = 1; k < FFT / 2; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      const m = Math.sqrt(p);
      mSum += m;
      wSum += m * hz(k);
      if (hz(k) >= 100 && hz(k) <= 5000) {
        logSum += Math.log(p + 1e-12);
        pSum += p + 1e-12;
        bins++;
      }
      if (pcOf[k] >= 0) chroma[pcOf[k]] += m;
    }
    const c = Math.min(cells - 1, Math.floor(i / cell));
    if (mSum > 0) cSum[c] += wSum / mSum;
    fSum[c] += Math.exp(logSum / bins) / (pSum / bins);
    cnt[c]++;
  }
  const centroid = cSum.map((v, c) => (cnt[c] ? Math.round(v / cnt[c]) : 0));
  const flat = fSum.map((v, c) => (cnt[c] ? Math.round((v / cnt[c]) * 1000) / 1000 : 0));
  return { centroid, flat, key: keyOf(chroma) };
}

function corr(a: number[], b: number[]): number {
  const ma = a.reduce((x, y) => x + y, 0) / a.length;
  const mb = b.reduce((x, y) => x + y, 0) / b.length;
  let n = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    n += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? n / Math.sqrt(da * db) : 0;
}

export function keyOf(chroma: number[]): Features["key"] {
  if (!chroma.some((v) => v > 0)) return null;
  const all: { tonic: string; mode: "大调" | "小调"; r: number }[] = [];
  for (let t = 0; t < 12; t++) {
    const rot = (p: number[]) => p.map((_, i) => p[(i - t + 12) % 12]);
    all.push({ tonic: NOTES[t], mode: "大调", r: corr(chroma, rot(MAJOR)) });
    all.push({ tonic: NOTES[t], mode: "小调", r: corr(chroma, rot(MINOR)) });
  }
  all.sort((a, b) => b.r - a.r);
  const best = all[0];
  const other = all.find((x) => x.mode !== best.mode)!;
  return { ...best, r: Math.round(best.r * 100) / 100, margin: Math.round((best.r - other.r) * 100) / 100 };
}

const quart = (xs: number[], v: number): "低" | "高" | "中" => {
  const s = [...xs].sort((a, b) => a - b);
  return v <= s[Math.floor(0.25 * (s.length - 1))] ? "低" : v >= s[Math.floor(0.75 * (s.length - 1))] ? "高" : "中";
};

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
  // 只在 85–175 里找：太慢的多半是只数到每两拍一下（10-16：一首约 140 的电音被估成 70）
  for (let bpm = 85; bpm <= 175; bpm++) {
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
  // 说清楚是跟什么比的：这一段 vs 同一首的其他段（10-16 a1 把"偏安静"读成了整首都安静）
  const level = l <= q(0.25) ? "这一段比这首其他部分安静" : l >= q(0.75) ? "这一段比这首其他部分响" : "这一段在这首里响度中等";
  const br = f.centroid?.length ? f.centroid : f.bright;
  const tb = quart(br, br[k]);
  const tone = [tb === "低" ? "音色比其他部分暗、闷" : tb === "高" ? "音色比其他部分亮、尖" : ""];
  if (f.flat?.length) {
    const fq = quart(f.flat, f.flat[k]);
    if (fq !== "中") tone.push(fq === "高" ? "颗粒感、噪声比其他部分多（失真、镲片或人声气声）" : "比其他部分干净、音高清楚");
  }
  const sec = [...f.sections].reverse().find((s) => s <= pos) ?? 0;
  const turned = sec > 0 && pos - sec < f.step * 2 ? `刚在 ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")} ${meanOf(f.loud, sec / f.step, sec / f.step + 3) > meanOf(f.loud, sec / f.step - 3, sec / f.step) ? "变响" : "收下来"}；` : "";
  return `${turned}${level}（${l} dB）${tone.filter(Boolean).map((x) => `，${x}`).join("")}${f.bpm ? `；整首约 ${f.bpm} BPM（粗估，可能差一倍）` : ""}；这些是从音频算的数，不是听到的`;
}

/** 后台算一首：ffmpeg 拉网易云地址解码 → 特征 → 存。同一首同时只算一次 */
const running = new Set<string>();
export async function analyzeTrack(store: EventStore, id: string, url: string | undefined): Promise<void> {
  if (!url || running.has(id) || featuresOf(store, id)) return;
  // 刚失败过的 10 分钟内不再试（不然每轮 <now> 都拉一次）
  const last = store.readSyslog({ kind: "track.features", limit: 100_000 }).find((l) => (l.detail as { id: string }).id === id);
  if (last && (last.detail as { error?: string }).error && store.now() - last.at < 600_000) return;
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
  } catch (e) {
    // 10-17：launchd 的 PATH 里没有 ffmpeg，spawn 直接抛，之前被调用方吞了，一个数都没有也看不出来
    store.syslog("track.features", { id, error: `没跑起来：${e instanceof Error ? e.message : String(e)}` });
  } finally {
    running.delete(id);
  }
}

// ── 放完后汇总（v2） ──

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

interface Overall {
  bright: number;
  flat: number;
  range: number;
}

function overall(f: Features): Overall {
  const voiced = (xs: number[]) => xs.filter((_, k) => f.loud[k] > -50);
  const s = [...f.loud].sort((a, b) => a - b);
  return { bright: mean(voiced(f.centroid ?? [])), flat: mean(voiced(f.flat ?? [])), range: s[Math.floor(0.9 * (s.length - 1))] - s[Math.floor(0.1 * (s.length - 1))] };
}

/** 我算过的别的歌（v2 的）：拿来比，「亮」是跟我听过的比，不是跟一个绝对标准比 */
function heardOthers(store: EventStore, id: string): Overall[] {
  const seen = new Set<string>([id]);
  const out: Overall[] = [];
  for (const l of store.readSyslog({ kind: "track.features", limit: 100_000 })) {
    const d = l.detail as { id: string; hash?: string };
    if (seen.has(d.id) || !d.hash) continue;
    seen.add(d.id);
    try {
      const f = JSON.parse(store.getMaterial(d.hash)!.text()) as Features;
      if ((f.v ?? 1) >= VERSION) out.push(overall(f));
    } catch {
      // 坏的跳过
    }
  }
  return out;
}

/** 一首放完：整首的样子说成一行。明说是放完后从音频算的汇总 */
export function summarize(store: EventStore, id: string, f: Features): string {
  const parts: string[] = [];
  if (f.key) {
    const sure = f.key.r >= 0.6 && f.key.margin >= 0.1 ? "把握还行" : f.key.margin >= 0.04 ? "把握一般" : "大小调分不太清";
    parts.push(`${f.key.mode}（估 ${f.key.tonic} ${f.key.mode}，${sure}）`);
  }
  const o = overall(f);
  const peak = f.loud.indexOf(Math.max(...f.loud));
  parts.push(`响度起伏 ${o.range} dB，最响在 ${mmss(peak * f.step)} 前后`);
  if (f.sections.length > 1) parts.push(`分成 ${f.sections.length} 段（${f.sections.map(mmss).join("、")} 起）`);
  if (f.bpm) parts.push(`约 ${f.bpm} BPM（可能差一倍）`);
  const others = heardOthers(store, id);
  if (others.length >= 3) {
    const n = others.length + 1;
    const rank = (k: keyof Overall) => 1 + others.filter((x) => x[k] > o[k]).length;
    parts.push(`在我算过的 ${n} 首里：亮度第 ${rank("bright")}、颗粒感第 ${rank("flat")}、起伏第 ${rank("range")}（第 1 = 最亮 / 最粗 / 起伏最大）`);
  } else parts.push(`音色质心约 ${Math.round(o.bright)} Hz、平坦度 ${o.flat.toFixed(2)}（算过的歌还少，先不排）`);
  return `${parts.join("；")}。这是放完后从音频算的汇总，不是边听边听到的`;
}
