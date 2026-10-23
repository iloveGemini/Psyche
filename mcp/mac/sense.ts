/**
 * 这台 Mac 上读得到的 Joy 那边（从 Roxy `lib/lifecycle/presence.ts`、`weather.ts` 搬来）：
 * 键鼠多久没动（ioreg HIDIdleTime）、屏幕锁没锁（IOConsoleLocked）、前台应用（lsappinfo，只有名字）、天气（Open-Meteo，免 key）。
 * 这几样都不弹系统授权；看屏幕要「屏幕录制」权限，在 screen.ts。
 *
 * 读数 → 报给 Psyche 的 percept（m8.md §6.3）：只报事实，不猜她在干嘛；
 * 值要「变了才算变」：键鼠秒数每圈都在变，所以压成三态，中间留一段不翻（防抖）；应用要连着两圈都是它才报。
 */
import { execFileSync } from "node:child_process";

export const SENSOR = "joy.mac";
/** 这么久之内动过 = 在用 */
export const ACTIVE_S = 120;
/** 这么久没动 = 走开了；两者之间不翻，接着上一态 */
export const IDLE_S = 10 * 60;

export type Desk = "active" | "idle" | "locked";
export interface Reading {
  locked?: boolean;
  idleSeconds?: number;
  app?: string;
}

export function readIdleSeconds(): number | undefined {
  try {
    const m = /"HIDIdleTime"\s*=\s*(\d+)/.exec(execFileSync("ioreg", ["-c", "IOHIDSystem"], { encoding: "utf8", timeout: 3000 }));
    return m ? Number(m[1]) / 1e9 : undefined;
  } catch {
    return undefined;
  }
}

export function readLocked(): boolean | undefined {
  try {
    const m = /"IOConsoleLocked"\s*=\s*(Yes|No|true|false)/.exec(execFileSync("ioreg", ["-n", "Root", "-d1"], { encoding: "utf8", timeout: 3000 }));
    return m ? /Yes|true/.test(m[1]) : undefined;
  } catch {
    return undefined;
  }
}

const APP_NAMES: Record<string, string> = {
  "com.microsoft.VSCode": "VS Code",
  "com.apple.Safari": "Safari",
  "com.google.Chrome": "Chrome",
  "com.tencent.xinWeChat": "微信",
  "com.electron.lark": "飞书",
  "com.bytedance.feishu": "飞书",
  "com.apple.Music": "音乐",
  "com.netease.163music": "网易云音乐",
  "com.apple.finder": "访达",
  "com.apple.Terminal": "终端",
  "com.googlecode.iterm2": "iTerm2",
};
const NOT_APPS = new Set(["com.apple.loginwindow", "com.apple.ScreenSaverEngine"]);

/** 前台应用的名字：只读名字和 bundle id，不读窗口标题、网址 */
export function readFrontmostApp(): string | undefined {
  try {
    const asn = execFileSync("lsappinfo", ["front"], { encoding: "utf8", timeout: 1500 }).trim();
    if (!asn) return undefined;
    const out = execFileSync("lsappinfo", ["info", "-only", "name", "-only", "bundleid", asn], { encoding: "utf8", timeout: 1500 });
    const bundle = /"CFBundleIdentifier"\s*=\s*"([^"]+)"/.exec(out)?.[1];
    const name = /"(?:LSDisplayName|CFBundleName)"\s*=\s*"([^"]+)"/.exec(out)?.[1];
    if ((bundle && NOT_APPS.has(bundle)) || name === "loginwindow" || name === "ScreenSaverEngine") return undefined;
    return (bundle && APP_NAMES[bundle]) || name;
  } catch {
    return undefined;
  }
}

/** 按 Joy 开放的读：关了的不读；锁屏时不读应用 */
export function readMac(open: { desk: boolean; app: boolean }): Reading {
  const r: Reading = {};
  if (open.desk) r.idleSeconds = readIdleSeconds();
  if (open.desk || open.app) r.locked = readLocked();
  if (open.app && !r.locked) {
    if (!open.desk) r.idleSeconds = readIdleSeconds(); // 应用只在她刚动过时报，要知道动没动
    r.app = readFrontmostApp();
  }
  if (!open.desk) delete r.locked;
  return r;
}

// ── 读数 → 要报的 ──

export interface Report {
  sensor: string;
  subject: string;
  value: unknown;
  text: string;
}

export interface FeedState {
  desk?: Desk;
  /** 已报的前台应用；候选（只见过一圈的） */
  app?: string;
  appSeen?: string;
}

const DESK_TEXT: Record<Desk, string> = {
  active: "Joy 在用电脑（键鼠刚动过）",
  idle: `Joy 的电脑键鼠 ${IDLE_S / 60} 分钟以上没动`,
  locked: "Joy 的电脑锁屏了",
};

export function deskOf(r: Reading, prev?: Desk): Desk | undefined {
  if (r.locked) return "locked";
  if (r.idleSeconds === undefined) return prev;
  if (r.idleSeconds < ACTIVE_S) return "active";
  if (r.idleSeconds >= IDLE_S) return "idle";
  return prev === "locked" || prev === undefined ? "active" : prev; // 中间那段不翻；刚解锁算在用
}

/** 一圈：算出要报的（只报变了的），改 state */
export function step(state: FeedState, r: Reading, open: { desk: boolean } = { desk: true }): Report[] {
  const out: Report[] = [];
  const desk = open.desk ? deskOf(r, state.desk) : undefined;
  if (desk && desk !== state.desk) {
    state.desk = desk;
    out.push({ sensor: SENSOR, subject: "desk", value: desk, text: DESK_TEXT[desk] });
  }
  // 应用：没锁屏、键鼠刚动过才算她在用；连着两圈都是它才报（来回切的不报）
  const using = !r.locked && r.idleSeconds !== undefined && r.idleSeconds < ACTIVE_S ? r.app : undefined;
  if (using) {
    if (using === state.appSeen && using !== state.app) {
      state.app = using;
      out.push({ sensor: SENSOR, subject: "app", value: using, text: `Joy 前台在用 ${using}` });
    }
    state.appSeen = using;
  }
  return out;
}

// ── 天气 ──

export type WeatherKind = "clear" | "cloudy" | "fog" | "rain" | "snow" | "storm";

/** WMO 天气代码 → 种类和说法；毛毛雨和雨算一类（预报在两者间来回翻，Roxy 09-28） */
export function weatherKind(code: number): { kind: WeatherKind; words: string } {
  if (code === 0) return { kind: "clear", words: "晴" };
  if (code === 1) return { kind: "clear", words: "晴间多云" };
  if (code === 2) return { kind: "cloudy", words: "多云" };
  if (code === 3) return { kind: "cloudy", words: "阴" };
  if (code === 45 || code === 48) return { kind: "fog", words: "雾" };
  if (code >= 51 && code <= 57) return { kind: "rain", words: "毛毛雨" };
  if (code === 61 || code === 80) return { kind: "rain", words: "小雨" };
  if (code === 63 || code === 81) return { kind: "rain", words: "中雨" };
  if (code === 65 || code === 82 || code === 66 || code === 67) return { kind: "rain", words: "大雨" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { kind: "snow", words: "下雪" };
  if (code >= 95) return { kind: "storm", words: "雷阵雨" };
  return { kind: "cloudy", words: "多云" };
}

export interface WeatherState {
  /** 已报的种类 */
  kind?: WeatherKind;
  /** 见到新种类、还没稳住：是什么、从什么时候 */
  pending?: { kind: WeatherKind; since: number };
}

/** 新的种类要隔一个刷新周期还是它才算变了（Roxy settle）；第一次直接报。气温变不算变 */
export function weatherStep(state: WeatherState, w: { code: number; temperatureC: number }, place: string, now: number, holdMs: number): Report | undefined {
  const { kind, words } = weatherKind(w.code);
  const report = (): Report => {
    state.kind = kind;
    delete state.pending;
    return { sensor: "weather", subject: place, value: kind, text: `${place}：${words}，${Math.round(w.temperatureC)}°C` };
  };
  if (state.kind === undefined) return report();
  if (kind === state.kind) {
    delete state.pending;
    return undefined;
  }
  if (state.pending?.kind === kind) return now - state.pending.since >= holdMs ? report() : undefined;
  state.pending = { kind, since: now };
  return undefined;
}

export async function fetchWeather(lat: number, lon: number, fetchImpl: typeof fetch = fetch): Promise<{ code: number; temperatureC: number } | undefined> {
  try {
    const res = await fetchImpl(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return undefined;
    const c = ((await res.json()) as { current?: { temperature_2m?: number; weather_code?: number } }).current;
    return typeof c?.weather_code === "number" && typeof c.temperature_2m === "number" ? { code: c.weather_code, temperatureC: c.temperature_2m } : undefined;
  } catch {
    return undefined;
  }
}
