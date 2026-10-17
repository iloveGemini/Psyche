/**
 * 屋里的东西（m8.md §6.2）：它自己的 home、公共的 commons 里，文件多了、改了、没了。
 *
 * - 屋子每圈（30 秒）扫一遍，和上次的快照比（路径 → 大小 + 修改时间），只记变化。快照存 <数据目录>/files.json，重启不丢。
 * - **谁动的**：只在说得准的时候说——某个住户在前后 2 分钟里用工具碰过这个路径（tool.call 的参数里有它），就是他；
 *   否则「不知道是谁」（10-16 a1：认不出就别替人认领）。Joy 在文件夹里直接改，系统看不见是她，也说不知道。
 * - 自己动的不报给自己（那是它自己做的事，经历里已有工具调用）。
 * - 谁看得到：home 只有主人看得到（别人的 home 看不到，soma2.md §四）；commons 屋里人人看得到。
 * - 只报路径和怎么变了，不抄内容——想看自己去读。
 * - 递：<now>「屋里的东西」，本会话上次递到之后的；递一次写 percept.noticed（sensor = files）。
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { EventStore, PsycheEvent } from "../store/events.ts";
import { clockOf } from "../core/time.ts";

export interface Place {
  /** 显示名：home / commons */
  label: string;
  dir: string;
  /** home 的主人；commons 没有主人 */
  owner?: string;
}

type Snap = Record<string, { size: number; mtime: number }>;
export type Change = "added" | "modified" | "removed";

const MAX_FILES = 2000;
const NEAR_MS = 2 * 60_000;

/** 扫一个目录：跳过点开头的（.git 之类）和 node_modules，最多 2000 个文件 */
export function scan(dir: string): Snap {
  const out: Snap = {};
  if (!existsSync(dir)) return out;
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (Object.keys(out).length >= MAX_FILES) return;
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        const st = statSync(p);
        out[relative(dir, p)] = { size: st.size, mtime: Math.floor(st.mtimeMs) };
      }
    }
  };
  walk(dir);
  return out;
}

export function diff(before: Snap, after: Snap): { path: string; change: Change }[] {
  const out: { path: string; change: Change }[] = [];
  for (const [p, v] of Object.entries(after)) {
    const b = before[p];
    if (!b) out.push({ path: p, change: "added" });
    else if (b.size !== v.size || b.mtime !== v.mtime) out.push({ path: p, change: "modified" });
  }
  for (const p of Object.keys(before)) if (!after[p]) out.push({ path: p, change: "removed" });
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** 谁在前后 2 分钟里用工具碰过这个绝对路径（参数里出现它）；不止一个、或没有，就是 undefined */
export function whoTouched(residents: { id: string; store: EventStore }[], abs: string, at: number, owner?: { id: string; rel: string }): string | undefined {
  const touched = (r: { id: string; store: EventStore }, needle: string) =>
    !!r.store.db
      .query(`SELECT 1 FROM events WHERE kind = 'tool.call' AND fonds = '' AND at BETWEEN ? AND ? AND instr(payload, ?) > 0 LIMIT 1`)
      .get(at - NEAR_MS, at + NEAR_MS, JSON.stringify(needle).slice(1, -1));
  // 主人在自己 home 里常用相对路径（cwd 就是 home）：也认相对路径
  const hits = residents.filter((r) => touched(r, abs) || (owner?.id === r.id && touched(r, owner.rel)));
  return hits.length === 1 ? hits[0].id : undefined;
}

/**
 * 屋子看一圈文件。places：每个住户的 home + commons。返回这圈记了几条。
 * 快照只在内存和 files.json 里，第一次见到一个地方只建快照、不报（不然一开机全是"新出现"）。
 */
export function filesTick(
  residents: { id: string; store: EventStore }[],
  places: Place[],
  state: { snaps: Record<string, Snap> },
  now: number,
): number {
  let written = 0;
  for (const place of places) {
    const after = scan(place.dir);
    const before = state.snaps[place.dir];
    state.snaps[place.dir] = after;
    if (!before) continue;
    for (const { path, change } of diff(before, after)) {
      const abs = join(place.dir, path);
      const by = whoTouched(residents, abs, now, place.owner ? { id: place.owner, rel: path } : undefined);
      const viewers = place.owner ? residents.filter((r) => r.id === place.owner) : residents;
      for (const v of viewers) {
        if (by === v.id) continue; // 自己动的不报给自己
        v.store.append({
          kind: "percept",
          class: "experience",
          source: "house",
          at: now,
          situation: null,
          payload: { sensor: "files", subject: `${place.label}/${path}`, value: change, ...(by ? { by } : {}) },
        });
        written++;
      }
    }
  }
  return written;
}

export function loadSnaps(file: string): { snaps: Record<string, Snap> } {
  try {
    return existsSync(file) ? { snaps: JSON.parse(readFileSync(file, "utf8")) } : { snaps: {} };
  } catch {
    return { snaps: {} };
  }
}
export const saveSnaps = (file: string, state: { snaps: Record<string, Snap> }) => writeFileSync(file, JSON.stringify(state.snaps));

// ── 递 ──

const CHANGE: Record<Change, string> = { added: "新出现", modified: "被改过", removed: "没了" };

/** <now> 的「屋里的东西」：本会话上次递到之后的变化，同一个文件压成一行（最后的样子 + 次数）；最多 10 行 */
export function deliverFiles(store: EventStore, session: string | undefined, names: (id: string) => string = (id) => id): string | null {
  const noticed = store.list({ kinds: ["percept.noticed"], fonds: "", limit: 100_000 }).filter((e) => (e.payload as { sensor?: string }).sensor === "files");
  // 本会话递过就从那次算；新会话接任何会话最后递到的那次（递过的不再翻）；从没递过：只报最近 6 小时的
  const last = noticed.filter((e) => (e.payload as { session?: string }).session === session).at(-1) ?? noticed.at(-1);
  const since = last?.id ?? "";
  const floor = last ? 0 : store.now() - 6 * 3_600_000;
  const fresh = store
    .list({ kinds: ["percept"], fonds: "", limit: 100_000 })
    .filter((e) => (e.payload as { sensor: string }).sensor === "files" && e.id > since && e.at >= floor);
  if (!fresh.length) return null;
  const by = new Map<string, PsycheEvent[]>();
  for (const e of fresh) {
    const k = (e.payload as { subject: string }).subject;
    by.set(k, [...(by.get(k) ?? []), e]);
  }
  const lines = [...by].slice(-10).map(([path, evs]) => {
    const last = evs.at(-1)!;
    const p = last.payload as { value: Change; by?: string };
    const whos = [...new Set(evs.map((e) => (e.payload as { by?: string }).by ?? "?"))];
    const who = whos.length === 1 && whos[0] !== "?" ? `${names(whos[0])}动的` : whos.every((x) => x === "?") ? "不知道是谁" : "不止一个人动过";
    return `- ${path}：${CHANGE[p.value]}${evs.length > 1 ? `（这段时间变了 ${evs.length} 次）` : ""}，${who}（${clockOf(last.at, store.now(), store.timeZone)}）`;
  });
  const more = by.size > 10 ? [`（还有 ${by.size - 10} 个文件也变了）`] : [];
  const text = ["屋里的东西：", ...lines, ...more].join("\n");
  const situation = (session ? store.situationOfSession(session, store.now()) : null) ?? undefined;
  store.append({ kind: "percept.noticed", class: "experience", source: "psyche", situation, payload: { sensor: "files", refs: fresh.map((e) => e.id), text, ...(session ? { session } : {}) } });
  return text;
}
