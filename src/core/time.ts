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
