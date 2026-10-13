/**
 * ① 分场（catalog.md §二）：把未编目的经历切成一场一场。纯规则，不调模型。
 *
 * 规则：按发生时间排；相邻两条间隔 ≥ gapMinutes，或换了地方（处境里的 harness），就另起一场。
 * 产出梦事件 `scene`，用 `member` 关系挂上本场每一条事件。
 *
 * 重切：晚到的事件（发生时间落在已切好的场附近）会把受影响的旧场连同它们的成员一起重新切。
 * 切出来和某个旧场成员完全相同的，旧场保留；不同的写新场，用 `supersedes` 关系指向被取代的旧场。
 * 被取代的场不再算数（投影里删掉），它的叙述等下游产物也随之作废。
 *
 * 只切它自己的全宗；梦事件、处境本身不进场。
 * 什么时候跑：睡觉时（做梦），把截至此刻的全部未编目经历切完。
 */
import type { Database } from "bun:sqlite";
import type { EventStore, PsycheEvent } from "../store/events.ts";
import type { Projector } from "../store/projections.ts";
import { getCursor, setCursor } from "./cursor.ts";

export const SCENE_PRODUCER = "catalog/scenes@1 rules";

export interface SceneOptions {
  gapMinutes?: number;
}

interface ScenePayload {
  from: number;
  to: number;
  count: number;
  harness: string;
  reason: string;
}

const isMember = (e: PsycheEvent) => !e.fonds && (e.class === "experience" || e.class === "self");
const keyOf = (ids: string[]) => [...ids].sort().join(",");

export function runScenes(store: EventStore, opts: SceneOptions = {}): PsycheEvent[] {
  const gap = (opts.gapMinutes ?? 30) * 60_000;
  const after = getCursor(store.db, "scenes");
  const pending: PsycheEvent[] = [];
  for (let cursor = after; ; ) {
    const batch = store.list({ afterId: cursor || undefined, limit: 1000 });
    if (!batch.length) break;
    pending.push(...batch);
    cursor = batch.at(-1)!.id;
  }
  if (!pending.length) return [];
  const lastId = pending.at(-1)!.id;
  const fresh = pending.filter(isMember);
  if (!fresh.length) {
    setCursor(store.db, "scenes", lastId);
    return [];
  }

  const harnessOf = new Map<string, string>();
  const harness = (ev: PsycheEvent) => {
    if (!ev.situation) return "";
    if (!harnessOf.has(ev.situation)) harnessOf.set(ev.situation, String((store.get(ev.situation)?.payload as { harness?: string })?.harness ?? ""));
    return harnessOf.get(ev.situation)!;
  };

  // 受影响的旧场：还算数、且结束时间离最早的新事件不到一个间隔
  const minAt = Math.min(...fresh.map((e) => e.at));
  const affected = activeScenes(store).filter((s) => (s.payload as ScenePayload).to >= minAt - gap);
  const pool = new Map<string, PsycheEvent>();
  const kept = new Map<string, PsycheEvent>(); // 成员集合 → 旧场
  const sceneOfMember = new Map<string, string>();
  for (const s of affected) {
    const ids = store.linksFrom(s.id).filter((l) => l.rel === "member").map((l) => l.to);
    kept.set(keyOf(ids), s);
    for (const id of ids) {
      sceneOfMember.set(id, s.id);
      const ev = store.get(id);
      if (ev) pool.set(id, ev);
    }
  }
  for (const e of fresh) pool.set(e.id, e);

  const members = [...pool.values()].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  const groups: { events: PsycheEvent[]; reason: string }[] = [];
  for (const ev of members) {
    const cur = groups.at(-1);
    const prev = cur?.events.at(-1);
    if (!cur || !prev) groups.push({ events: [ev], reason: "start" });
    else if (harness(ev) !== harness(prev)) groups.push({ events: [ev], reason: "moved" });
    else if (ev.at - prev.at >= gap) groups.push({ events: [ev], reason: "gap" });
    else cur.events.push(ev);
  }

  const out = store.db.transaction(() => {
    const scenes: PsycheEvent[] = [];
    for (const g of groups) {
      const key = keyOf(g.events.map((e) => e.id));
      if (kept.has(key)) continue; // 和旧场一模一样，不动
      const replaced = [...new Set(g.events.map((e) => sceneOfMember.get(e.id)).filter((x): x is string => !!x))];
      scenes.push(
        store.append({
          kind: "scene",
          class: "dream",
          source: "dream",
          producer: SCENE_PRODUCER,
          at: g.events[0].at,
          // 同一批成员重跑不重复入库
          idem: `scene:${new Bun.CryptoHasher("sha256").update(key).digest("hex").slice(0, 16)}`,
          payload: { from: g.events[0].at, to: g.events.at(-1)!.at, count: g.events.length, harness: harness(g.events[0]), reason: g.reason } satisfies ScenePayload,
          links: [...g.events.map((e) => ({ to: e.id, rel: "member" })), ...replaced.map((id) => ({ to: id, rel: "supersedes" }))],
        }),
      );
    }
    setCursor(store.db, "scenes", lastId);
    return scenes;
  })();
  return out;
}

/** 还算数的场：没被后来的场 supersedes 的 */
function activeScenes(store: EventStore): PsycheEvent[] {
  const all = store.list({ kinds: ["scene"], classes: ["dream"] });
  const gone = new Set(all.flatMap((s) => store.linksFrom(s.id).filter((l) => l.rel === "supersedes").map((l) => l.to)));
  return all.filter((s) => !gone.has(s.id));
}

/** 场次投影：还算数的场，和每条事件当前在哪一场（后写的 scene 覆盖先写的，被取代的场删掉） */
export const scenesProjector: Projector = {
  name: "scenes",
  version: 2,
  kinds: ["scene"],
  setup(db: Database) {
    db.run(`CREATE TABLE IF NOT EXISTS p_scenes (id TEXT PRIMARY KEY, archive_no TEXT NOT NULL, from_at INTEGER NOT NULL, to_at INTEGER NOT NULL, count INTEGER NOT NULL, harness TEXT, reason TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS p_scene_members (event_id TEXT PRIMARY KEY, scene_id TEXT NOT NULL)`);
  },
  reset(db: Database) {
    db.run(`DELETE FROM p_scenes`);
    db.run(`DELETE FROM p_scene_members`);
  },
  apply(db: Database, ev) {
    const p = ev.payload as ScenePayload;
    const replaced = db.query(`SELECT to_id FROM links WHERE from_id = ? AND rel = 'supersedes'`).all(ev.id) as { to_id: string }[];
    for (const r of replaced) db.run(`DELETE FROM p_scenes WHERE id = ?`, [r.to_id]);
    db.run(`INSERT INTO p_scenes (id, archive_no, from_at, to_at, count, harness, reason) VALUES (?, ?, ?, ?, ?, ?, ?)`, [ev.id, ev.archiveNo, p.from, p.to, p.count, p.harness, p.reason]);
    const members = db.query(`SELECT to_id FROM links WHERE from_id = ? AND rel = 'member'`).all(ev.id) as { to_id: string }[];
    const upsert = db.query(`INSERT INTO p_scene_members (event_id, scene_id) VALUES (?, ?) ON CONFLICT (event_id) DO UPDATE SET scene_id = excluded.scene_id`);
    for (const m of members) upsert.run(m.to_id, ev.id);
  },
};

export function sceneOf(db: Database, eventId: string): { id: string; archiveNo: string } | null {
  const r = db.query(`SELECT s.id, s.archive_no FROM p_scene_members m JOIN p_scenes s ON s.id = m.scene_id WHERE m.event_id = ?`).get(eventId) as { id: string; archive_no: string } | null;
  return r ? { id: r.id, archiveNo: r.archive_no } : null;
}
