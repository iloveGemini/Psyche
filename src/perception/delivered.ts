/**
 * 递到哪了（m8.md §五，10-24 Joy 定）：递到不等于留意。
 *
 * - <now> 递出去的感知只在那一段的上下文里，一次性的；要记住得它自己 notice / look。
 * - 递一次记系统日志 `percept.delivered`（同来信的 mail.noticed）：不进事件流、不占档号、不进经历，只当游标。
 *   `upTo` 是递时库里最后一条事件的 id：之后入库的变化才算新的（和以前按递送事件的 id 比一样）。
 * - 游标也认事件里的 `percept.noticed`：look 的（它的经历，看过的不重报），和 10-24 之前递送写下的旧条。
 */
import type { EventStore } from "../store/events.ts";

export type Sensor = "presence" | "files" | "sound" | "body" | "outside";

export interface Delivery {
  /** 游标：之后入库的事件 id 比它大 */
  id: string;
  at: number;
  session?: string;
  text: string;
  refs: string[];
  levels?: unknown;
  looked?: boolean;
}

/** 这一路递过的，按游标先后 */
export function deliveries(store: EventStore, sensor: Sensor): Delivery[] {
  const out: Delivery[] = [];
  for (const e of store.list({ kinds: ["percept.noticed"], fonds: "", limit: 100_000 })) {
    const p = e.payload as { sensor?: string; session?: string; text: string; refs: string[]; levels?: unknown; looked?: boolean };
    if ((p.sensor ?? "presence") !== sensor) continue;
    out.push({ id: e.id, at: e.at, text: p.text, refs: p.refs, ...(p.session ? { session: p.session } : {}), ...(p.levels ? { levels: p.levels } : {}), ...(p.looked ? { looked: true } : {}) });
  }
  const rows = store.db
    .query(`SELECT at, detail FROM system_log WHERE kind = 'percept.delivered' AND json_extract(detail, '$.sensor') = ? ORDER BY id`)
    .all(sensor) as { at: number; detail: string }[];
  for (const r of rows) {
    const d = JSON.parse(r.detail) as { upTo: string; session?: string; text: string; refs: string[]; levels?: unknown };
    out.push({ id: d.upTo, at: r.at, text: d.text, refs: d.refs, ...(d.session ? { session: d.session } : {}), ...(d.levels ? { levels: d.levels } : {}) });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.at - b.at));
}

/** 本会话最后递到的；本会话没递过就接任何会话最后递到的（anyway = false 时只看本会话） */
export function lastDelivery(store: EventStore, sensor: Sensor, session: string | undefined, anyway = true): Delivery | undefined {
  const all = deliveries(store, sensor);
  return all.filter((d) => d.session === session).at(-1) ?? (anyway ? all.at(-1) : undefined);
}

/** 递了一次：记系统日志，不进经历 */
export function recordDelivery(store: EventStore, sensor: Sensor, session: string | undefined, d: { text: string; refs: string[]; levels?: unknown }): void {
  const upTo = (store.db.query(`SELECT MAX(id) AS id FROM events WHERE fonds = ''`).get() as { id: string | null }).id ?? "";
  store.syslog("percept.delivered", { sensor, upTo, refs: d.refs, text: d.text, ...(d.levels ? { levels: d.levels } : {}), ...(session ? { session } : {}) });
}
