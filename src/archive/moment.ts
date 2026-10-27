/**
 * `<moment>` 的状态闸（m1.md §四，10-27 Joy 定）：moment 留在历史里不剥，所以状态没变就不重报。
 *
 * - 每项先归成粗值 sig：措辞、数字在档内的波动不算变（Roxy 天气「小雨 → 毛毛雨」的坑），只有 sig 变了才出。
 * - 游标是系统日志 `moment.state { session, sigs }`：本会话上次递过的每项 sig；`moment.reset` 之后（上下文被压缩）当没递过。
 * - sig 变空（这项没了）：有 `none` 的报一句「没有了」，没有的不出。
 */
import type { EventStore } from "../store/events.ts";

export interface StateItem {
  /** 哪一项，如 where、mail、presence:Joy */
  key: string;
  /** 粗值；空串 = 这项此刻没有 */
  sig: string;
  /** 变了时出的那行（sig 空时可省） */
  text?: string | null;
  /** 不是首轮时改用这行（如带上变的时刻） */
  later?: string;
  /** sig 从有变空时出的那行 */
  none?: string;
}

/** 本会话上次递过的 sig；没递过或压缩后返回空 */
export function lastSigs(store: EventStore, session: string | undefined): Record<string, string> {
  if (!session) return {};
  const row = store.db
    .query(
      `SELECT kind, detail FROM system_log WHERE kind IN ('moment.state', 'moment.reset') AND json_extract(detail, '$.session') = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(session) as { kind: string; detail: string } | null;
  if (!row || row.kind === "moment.reset") return {};
  return (JSON.parse(row.detail) as { sigs: Record<string, string> }).sigs;
}

/** 过闸：返回这一轮要出的行（按 items 的次序，带 key），并记下新的 sig。没会话就全出、不记 */
export function gate(store: EventStore, session: string | undefined, items: StateItem[]): { key: string; line: string; first: boolean }[] {
  const was = lastSigs(store, session);
  const first = !Object.keys(was).length;
  const out: { key: string; line: string; first: boolean }[] = [];
  const sigs: Record<string, string> = { ...was };
  let changed = false;
  for (const it of items) {
    const before = was[it.key] ?? "";
    if (it.sig === before && it.key in was) continue;
    if (!(it.key in was) && !it.sig) {
      sigs[it.key] = "";
      changed = true;
      continue;
    }
    sigs[it.key] = it.sig;
    changed = true;
    if (it.sig) {
      const line = !first && it.later ? it.later : it.text;
      if (line) out.push({ key: it.key, line, first });
    } else if (before && it.none) out.push({ key: it.key, line: it.none, first });
  }
  if (session && (changed || first)) store.syslog("moment.state", { session, sigs });
  return out;
}

/** 这一段的上下文被压缩掉了：下一轮全报 */
export function resetMoment(store: EventStore, session: string): void {
  store.syslog("moment.reset", { session });
}

/** 落在第几档（bands 从小到大） */
export const bandOf = (x: number, bands: number[]) => bands.filter((b) => x >= b).length;
