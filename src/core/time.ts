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
