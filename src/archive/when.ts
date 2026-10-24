/**
 * 经历行递到它眼前时怎么带时刻（notes/plan/traces.md）：回想只给大概，留意过的给精确。
 * 单行：`[档号] 今天上午 正文`；时间流：时段变了起一行标题，相邻停顿插一行，行首不带时刻。
 */
import { exactWhen, gapHint, vagueWhen } from "../core/time.ts";

export interface WhenLine {
  archiveNo: string;
  at: number;
  text: string;
  kind?: string;
}

/** 它当场留意过的（notice、自己 look 的；递送写下的旧 percept.noticed 已不进经历，出现在行里的只会是 look 的）：带精确时刻 */
const attended = (l: WhenLine) => l.kind === "notice" || l.kind === "percept.noticed";
const body = (l: WhenLine, tz: string) => (attended(l) ? `〔${exactWhen(l.at, tz)}〕${l.text}` : l.text);

/** 单行（不按时间顺序的列表） */
export function whenLine(l: WhenLine, now: number, tz: string): string {
  return `[${l.archiveNo}] ${attended(l) ? "" : `${vagueWhen(l.at, now, tz)} `}${body(l, tz)}`;
}

/** 时间流（按时间顺序的一整段） */
export function whenFlow(lines: WhenLine[], now: number, tz: string): string[] {
  const out: string[] = [];
  let head: string | null = null;
  let prev: number | null = null;
  for (const l of lines) {
    const gap = prev === null ? null : gapHint(l.at - prev);
    if (gap) out.push(gap);
    const h = vagueWhen(l.at, now, tz);
    if (h !== head) out.push(`── ${(head = h)} ──`);
    out.push(`[${l.archiveNo}] ${body(l, tz)}`);
    prev = l.at;
  }
  return out;
}
