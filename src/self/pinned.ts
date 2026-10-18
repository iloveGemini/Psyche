/**
 * 常驻区（10-18 群里定，契约 m1.md §五⅛）：从现行书架挑条目钉上，每次醒来（新会话开头）在 <continuity> 里，
 * 不用 recall 就在眼前。不存自由文本：钉的是书架档号，条目照旧受冷写的证据闸约束。
 *
 * - 只跟 hotwrite 一起改（pin / unpin）：会话中途系统提示词不变，缓存不失效；下一段生效。
 * - 固定额度 PIN_BUDGET 字（按渲染出来的整张卡算），钉上去超了整批拒，逼它自己撤下或精简。
 * - 钉的是条目（root）：改写后跟到最新版；作废了自动不算。之后改写变长超了额度，不拒冷写，载入时截掉后面的并说明。
 * - 浮现（surface.ts）跳过钉着的：已经每轮都在了。
 */
import { displayArchiveNo, type EventStore } from "../store/events.ts";
import { localDay } from "../core/time.ts";
import { readShelf, renderEntry, rootOf, type ShelfEntry } from "../reading/shelf.ts";

export const PIN_BUDGET = 1200;

const refYear = (store: EventStore) => Number(localDay(store.now(), store.timeZone).slice(0, 4));

export class PinError extends Error {}

/** 钉着的条目 root，按钉上的先后 */
export function pinnedRoots(store: EventStore): string[] {
  const rows = store.db.query(`SELECT payload FROM events WHERE kind = 'pin.changed' AND fonds = '' ORDER BY id`).all() as { payload: string }[];
  let out: string[] = [];
  for (const r of rows) {
    const p = JSON.parse(r.payload) as { pin: string[]; unpin: string[] };
    out = out.filter((x) => !p.unpin.includes(x));
    for (const x of p.pin) if (!out.includes(x)) out.push(x);
  }
  return out;
}

export const cardOf = (e: ShelfEntry, year: number) => `[${displayArchiveNo(e.archiveNo, year)}] ${renderEntry(e)}`;

/** 现行的钉着的条目（作废的不算）和它们占的字数 */
export function pinnedEntries(store: EventStore, roots = pinnedRoots(store)): { entries: ShelfEntry[]; used: number } {
  const year = refYear(store);
  const shelf = new Map(readShelf(store.db).map((e) => [e.root, e]));
  const entries = roots.map((r) => shelf.get(r)).filter((e): e is ShelfEntry => !!e);
  return { entries, used: entries.reduce((n, e) => n + cardOf(e, year).length, 0) };
}

/** hotwrite 带的 pin / unpin → root；校验并按钉完的样子算额度。都没给 = null */
export function checkPins(store: EventStore, pin: unknown, unpin: unknown): { pin: string[]; unpin: string[] } | null {
  const list = (v: unknown, name: string): string[] => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !x.trim())) throw new PinError(`${name} 要是书架档号的数组`);
    return v as string[];
  };
  const shelf = readShelf(store.db, { includeRetired: true });
  const resolve = (no: string, name: string) => {
    const ev = store.byArchiveNo(no.trim().replace(/^\[|\]$/g, ""));
    const root = ev ? rootOf(store.db, ev.id) : null;
    const entry = root ? shelf.find((e) => e.root === root) : undefined;
    if (!entry) throw new PinError(`${name} 里的 ${no} 不是书架条目（常驻区只钉书架上的条目）`);
    if (entry.retired && name === "pin") throw new PinError(`${no} 已经作废了，不能钉`);
    return entry.root;
  };
  const p = list(pin, "pin").map((x) => resolve(x, "pin"));
  const u = list(unpin, "unpin").map((x) => resolve(x, "unpin"));
  if (!p.length && !u.length) return null;
  const now = pinnedRoots(store);
  const after = [...now.filter((r) => !u.includes(r)), ...p.filter((r) => !now.includes(r) && !u.includes(r))];
  const { used } = pinnedEntries(store, after);
  if (used > PIN_BUDGET) throw new PinError(`常驻区钉完是 ${used} / ${PIN_BUDGET} 字，超了：先撤下（unpin）旧条目，或用 coldwrite 把条目改写精简`);
  return { pin: p, unpin: u };
}

/** <continuity> 里那一块；超额（钉上后改写变长了）截掉后面的并说明 */
export function renderPinned(store: EventStore): string | null {
  const { entries } = pinnedEntries(store);
  if (!entries.length) return null;
  const year = refYear(store);
  const shown: string[] = [];
  const left: string[] = [];
  let n = 0;
  for (const e of entries) {
    const card = cardOf(e, year);
    if (n + card.length > PIN_BUDGET) left.push(displayArchiveNo(e.archiveNo, year));
    else {
      shown.push(card);
      n += card.length;
    }
  }
  return ["【常驻】（你钉上的书架条目）", ...shown, ...(left.length ? [`（超了 ${PIN_BUDGET} 字，没载入：${left.join("、")}）`] : [])].join("\n");
}

/** 给 hotwrite_segment 看的一行：钉着哪些、用了多少 */
export function pinStatus(store: EventStore): { used: number; budget: number; entries: string[] } {
  const year = refYear(store);
  const { entries, used } = pinnedEntries(store);
  return { used, budget: PIN_BUDGET, entries: entries.map((e) => displayArchiveNo(e.archiveNo, year)) };
}
