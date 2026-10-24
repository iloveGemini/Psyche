/**
 * 时间约定：库里一律存 epoch 毫秒（整数），只在需要"哪一天"时按时区换算。
 *
 * ASCM 吃过亏：同一列混了 ISO-UTC 和本地字面量，字符串比较静默出错，跨零点的日志整段丢失。
 * 这里不给字符串时间留位置。
 */

/** 某时刻在给定时区的自然日，`YYYY-MM-DD`。档号的日期按这个切（events.md §五：自然日零点切）。 */
export function localDay(at: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(at));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 周几，如「周三」 */
  weekday: string;
}

/** 某时刻在给定时区的墙上时间 */
export function wallClock(at: number, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const weekday = new Intl.DateTimeFormat("zh-CN", { timeZone, weekday: "short" }).format(new Date(at));
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second"), weekday };
}

/** 给定时区的墙上时间 → epoch 毫秒（日期溢出照 Date.UTC 进位，如 32 日 = 下月 1 日） */
export function fromWallClock(timeZone: string, year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetAt = (t: number) => {
    const w = wallClock(t, timeZone);
    return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(t / 1000) * 1000;
  };
  const t = guess - offsetAt(guess);
  const off2 = offsetAt(t);
  return guess - off2;
}

/**
 * 外部传进来的时间参数 → epoch 毫秒：
 * 纯数字 = 毫秒；`YYYY-MM-DD` = 本地那天零点（end 为真时取次日零点，便于当右开区间）；
 * 不带时区的 `YYYY-MM-DD[T ]HH:mm[:ss[.sss]]` 按本地墙上时间；带时区（Z / +08:00）的照原样。
 * 其余一律解析不了，返回 null——不交给 Date.parse 去按机器时区猜。
 */
export function parseTime(v: string, timeZone: string, end = false): number | null {
  const t = v.trim();
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/);
  if (m) {
    if (m[4] === undefined) return fromWallClock(timeZone, +m[1], +m[2], +m[3] + (end ? 1 : 0));
    return fromWallClock(timeZone, +m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0));
  }
  const ms = /(Z|[+-]\d{2}:?\d{2})$/i.test(t) ? Date.parse(t) : NaN;
  return Number.isNaN(ms) ? null : ms;
}

/** 递给它看的时刻：今天的只写 `HH:MM`，不是今天的带上日期 `MM-DD HH:MM`（跨天递的旧事不会看着像未来） */
export function clockOf(at: number, now: number, timeZone: string): string {
  const w = wallClock(at, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  const hm = `${pad(w.hour)}:${pad(w.minute)}`;
  return localDay(at, timeZone) === localDay(now, timeZone) ? hm : `${pad(w.month)}-${pad(w.day)} ${hm}`;
}

// ── 回想时只给大概（notes/plan/traces.md）：此刻准，回想糊；事件里的 at 不动 ──

/** 时段：按自然日零点切，不跨零点回拨（与档号日期对齐） */
const SLOTS: [number, string][] = [
  [5, "凌晨"],
  [8, "早上"],
  [11, "上午"],
  [13, "中午"],
  [17, "下午"],
  [19, "傍晚"],
  [23, "晚上"],
  [24, "深夜"],
];
const slotName = (hour: number) => SLOTS.find(([end]) => hour < end)![1];

/** 自然日相差几天（a 比 b 早为正） */
function daysBetween(a: number, b: number, timeZone: string): number {
  const d = (t: number) => Date.parse(`${localDay(t, timeZone)}T00:00:00Z`);
  return Math.round((d(b) - d(a)) / 86_400_000);
}

/** 回想时的时刻：今天上午 / 昨天深夜 / 前天下午 / 10-21（周三）晚上 / 10-13 */
export function vagueWhen(at: number, now: number, timeZone: string): string {
  const w = wallClock(at, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  const ago = Math.max(0, daysBetween(at, now, timeZone));
  const slot = slotName(w.hour);
  if (ago === 0) return `今天${slot}`;
  if (ago === 1) return `昨天${slot}`;
  if (ago === 2) return `前天${slot}`;
  if (ago <= 6) return `${pad(w.month)}-${pad(w.day)}（${w.weekday}）${slot}`;
  return w.year === wallClock(now, timeZone).year ? `${pad(w.month)}-${pad(w.day)}` : `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** 相邻两条之间的体感停顿；不到 10 分钟不说 */
export function gapHint(ms: number): string | null {
  const MIN = 60_000;
  if (ms < 10 * MIN) return null;
  if (ms < 30 * MIN) return "（过了一会儿）";
  if (ms < 60 * MIN) return "（过了半个多小时）";
  if (ms < 24 * 60 * MIN) return `（隔了约 ${Math.max(1, Math.round(ms / (60 * MIN)))} 小时）`;
  return `（隔了约 ${Math.max(1, Math.round(ms / (24 * 60 * MIN)))} 天）`;
}

/** 精确时刻 `MM-DD HH:mm`（留意过的、去查原件的才给） */
export function exactWhen(at: number, timeZone: string): string {
  const w = wallClock(at, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)}`;
}
