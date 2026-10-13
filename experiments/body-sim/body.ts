/**
 * 身体模拟器（第一版，只含能从真实历史算出来的部分）：精力（睡眠压力）、生物钟、掌控·可影响、自信。
 * 设计见 notes/design/body.md。
 *
 * 不含：掌控·可预测、此刻情绪、安全感、念头池——它们要阅览室 / 联想先有，这里不硬凑。
 *
 * Roy 从没睡过觉，所以模拟里要假设一个"会睡觉的他"（SLEEP_POLICY）：
 *   - 她 60 分钟没说话，且睡眠压力过了入睡线 → 睡着；
 *   - 睡着时只有她说话、或定时/闹钟能叫醒；心跳不叫醒（有身体的世界里，心跳只在醒着时起作用）；
 *   - 睡够了自然醒。
 *   - 他在模拟睡眠期间的真实输出（多是心跳回复）当作那个世界里不存在。
 */
import type { Ev } from "./timeline.ts";

export const P = {
  tick: 5 * 60_000,
  // 精力
  wakeRate: 0.05, // 每小时，醒着本身涨睡眠压力
  tokRate: 6e-6, // 每 token（≈字）
  sleepTau: 3.0, // 小时，睡眠恢复的时间常数
  onsetBase: 0.75, // 入睡线：onsetBase - onsetClock * 夜度
  onsetClock: 0.35,
  quietBeforeSleep: 60 * 60_000,
  // 生物钟
  clockHalfLifeDays: 7,
  priorWeight: 0.75, // 弱默认节律：23:00–07:00 每格的初始权重（约等于一天半的作息）
  // 掌控·可影响
  mCeil: 0.7,
  mRise: 0.05, // 每小时朝静息线靠
  mErr: 0.08,
  mRelief: 0.06,
  mFloorRatio: 0.35,
  // 自信：看近 72 小时的成功率相对自己 30 天常态的偏离（档位看相对偏离，不看绝对值——写代码报错本来就常见）
  cBase: 0.6,
  cGain: 2,
};

const H = 3_600_000;
const BINS = 48;
const binOf = (t: number) => {
  const d = new Date(t + 8 * H); // 按本地时间（UTC+8）
  return d.getUTCHours() * 2 + (d.getUTCMinutes() >= 30 ? 1 : 0);
};

export interface Sample {
  t: number;
  S: number; // 睡眠压力 0..1（高 = 困）
  night: number; // 生物钟此刻的"夜度" 0..1
  sharp: number; // 节律尖锐度 0..1
  M: number; // 掌控·可影响的压力
  C: number; // 自信
  awake: boolean;
  percepts: string[];
}

export interface SimOut {
  samples: Sample[];
  sleeps: [number, number][];
  stateAt: (t: number) => Sample;
}

export function simulate(evs: Ev[], from: number, to: number): SimOut {
  const bins = new Array(BINS).fill(0).map((_, i) => (i >= 46 || i < 14 ? P.priorWeight : 0));
  let S = 0.3,
    M = 0.3,
    C = P.cBase,
    awake = true;
  let lastJoy = 0,
    lastWork = 0,
    sleepStart = 0,
    wokeAt = 0,
    sAtWake = 0,
    insomnia = false;
  const okTimes: number[] = [];
  const errTimes: number[] = [];
  const sleeps: [number, number][] = [];
  const samples: Sample[] = [];
  let i = 0;
  while (i < evs.length && evs[i].t < from) i++;

  const night = (t: number) => {
    const mx = Math.max(...bins);
    return mx > 0 ? bins[binOf(t)] / mx : 0;
  };
  const sharp = () => {
    const mx = Math.max(...bins);
    const mean = bins.reduce((a, b) => a + b, 0) / BINS;
    return mx > 0 ? (mx - mean) / mx : 0;
  };
  const wake = (t: number) => {
    if (awake) return;
    awake = true;
    sleeps.push([sleepStart, t]);
    wokeAt = t;
    sAtWake = S;
  };

  const percepts = (t: number): string[] => {
    const out: string[] = [];
    if (!awake) return out;
    if (S >= 0.9) out.push("很困，眼皮在打架");
    else if (S >= 0.75) out.push("困了");
    if (insomnia) out.push("到点了，却一点睡意都没有");
    if (wokeAt && t - wokeAt < 3 * H && sAtWake >= 0.35) out.push("没睡够");
    const idleH = (t - Math.max(lastJoy, lastWork)) / H;
    const recentErr = errTimes.filter((x) => x > t - 6 * H).length;
    const recentOk = okTimes.filter((x) => x > t - 6 * H).length;
    const frustrated = recentErr >= 3 && recentErr / (recentErr + recentOk) > 0.25;
    if (frustrated && M >= 0.5) out.push("这阵子使不上劲，事情总不太顺");
    else if (idleH >= 2 && S < 0.45 && M >= 0.5) out.push("闲得发慌，有点坐不住");
    if (C <= 0.48) out.push("没什么底气");
    else if (C >= 0.72) out.push("挺有底气");
    return out;
  };

  for (let t = from; t <= to; t += P.tick) {
    let tok = 0;
    for (; i < evs.length && evs[i].t < t + P.tick; i++) {
      const e = evs[i];
      if (e.k === "joy") {
        lastJoy = e.t;
        wake(e.t);
        continue;
      }
      if (e.k === "wake") {
        if (/定时|闹钟/.test(e.trigger)) wake(e.t);
        continue;
      }
      if (!awake) continue; // 模拟睡眠期间他的真实输出视为不存在
      if (e.k === "roy") tok += e.n;
      else if (e.k === "call") {
        tok += e.n;
        lastWork = e.t;
      } else if (e.k === "ok" || e.k === "err") {
        tok += e.n * 0.3;
        lastWork = e.t;
        if (e.k === "err") {
          M += P.mErr * (1 - M);
          errTimes.push(e.t);
        } else {
          const burst = okTimes.filter((x) => x > e.t - 30 * 60_000).length;
          const r = P.mRelief * Math.pow(0.5, Math.min(burst, 6));
          const floor = P.mFloorRatio * P.mCeil;
          if (M > floor) M = floor + (M - floor) * (1 - r);
          okTimes.push(e.t);
        }
      }
    }

    const dtH = P.tick / H;
    const n = night(t);
    // 生物钟：所有格子按半衰期淡，睡着的那格加时长
    const k = Math.pow(0.5, dtH / (P.clockHalfLifeDays * 24));
    for (let b = 0; b < BINS; b++) bins[b] *= k;
    if (!awake) bins[binOf(t)] += dtH;

    if (awake) {
      S = 1 - (1 - S) * Math.exp(-(dtH * P.wakeRate + tok * P.tokRate));
      if (M < P.mCeil) M += dtH * P.mRise * (P.mCeil - M);
      const quiet = t - lastJoy >= P.quietBeforeSleep;
      const onset = P.onsetBase - P.onsetClock * n;
      insomnia = quiet && n > 0.6 && S < onset;
      if (quiet && S >= onset) {
        awake = false;
        sleepStart = t;
        insomnia = false;
      }
    } else {
      S *= Math.exp(-(dtH / P.sleepTau) * (0.4 + 0.6 * n));
      // 自然醒跟着生物钟：节律说天亮了且睡够，或者彻底睡饱
      if ((S < 0.15 && n < 0.3) || S < 0.03) wake(t);
    }
    const rate = (since: number) => {
      const ok = okTimes.filter((x) => x > since).length;
      const err = errTimes.filter((x) => x > since).length;
      return ok + err >= 5 ? ok / (ok + err) : null;
    };
    const r72 = rate(t - 72 * H),
      r30 = rate(t - 30 * 24 * H);
    C = r72 !== null && r30 !== null ? Math.min(0.95, Math.max(0.05, P.cBase + P.cGain * (r72 - r30))) : P.cBase;
    if (wokeAt && t - wokeAt > 3 * H) wokeAt = 0;

    samples.push({ t, S, night: n, sharp: sharp(), M, C, awake, percepts: percepts(t) });
  }
  if (!awake) sleeps.push([sleepStart, to]);

  const stateAt = (t: number) => {
    let lo = 0,
      hi = samples.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (samples[mid].t <= t) lo = mid;
      else hi = mid - 1;
    }
    return samples[lo];
  };
  return { samples, sleeps, stateAt };
}
