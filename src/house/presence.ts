/**
 * 屋里有谁（notes/plan/m8.md §二，M8a）：住户在线 / 忙 / 闲 / 睡着 / 离线、在哪、心情个签；Joy 只报在不在家。
 *
 * - 只报事实，不猜内心：忙 / 闲从各人自己库里的动静算；个签是本人挂的。
 * - 跨住户只读这几项（presenceOf），不开别的口子——别人的想法、工具结果看不到。
 * - 只记变化：屋子每 30 秒看一圈（houseTick），谁变了就在**其他每个人**的库里记一条 percept（不记进本人的库：自己的事自己经历过）。
 * - 递：<now> 报本会话上次递到之后的变化；递一次写一条 percept.noticed，它的经历就是递出去的那几行（a1 提）。
 */
import type { EventStore, PsycheEvent } from "../store/events.ts";
import { AWAKE_MS, BUSY_MS, NOT_PLACE_SQL } from "../channel/inbox.ts";
import { currentName, ownSince } from "../self/self.ts";
import { clockOf } from "../core/time.ts";
import { resolveSession } from "../catalog/hotwrite.ts";

export type State = "busy" | "idle" | "asleep" | "offline";
export const STATE_NAME: Record<State, string> = { busy: "忙", idle: "闲", asleep: "睡着", offline: "离线" };

export interface ResidentPresence {
  state: State;
  /** 在线时在哪（soma / pi / …） */
  where?: string;
  /** 在 Soma 的哪个房间（P3）：最后一次 room.entered；空串 = 自己房间；没有 = 没换过 */
  room?: string;
  mood?: string;
}
export interface JoyPresence {
  home: boolean;
  mood?: string;
}
export type Presence = ResidentPresence | JoyPresence;

export const JOY = "Joy";
/** Soma 页面多久没动静算她不在家；她在 Soma 说过话多久内算在家 */
export const JOY_PAGE_MS = 10 * 60_000;
export const JOY_SPOKE_MS = 30 * 60_000;
const ASLEEP_MS = 10 * 60_000;

/** 一个住户此刻的样子：只看他自己的库 */
export function presenceOf(store: EventStore, now = store.now()): ResidentPresence {
  const mood = currentMood(store);
  const last = store.db
    .query(
      `SELECT e.at, e.kind, json_extract(s.payload, '$.harness') AS harness FROM events e LEFT JOIN events s ON s.id = e.situation
       WHERE e.kind IN ('message.in', 'message.out', 'tool.call', 'tool.result') AND e.fonds = '' AND ${NOT_PLACE_SQL} AND e.at <= ?
       ORDER BY e.at DESC, e.id DESC LIMIT 1`,
    )
    .get(now) as { at: number; kind: string; harness: string | null } | null;
  const room = currentRoom(store);
  const withMood = <T extends object>(p: T) => ({ ...p, ...(room !== undefined ? { room } : {}), ...(mood ? { mood } : {}) });

  if (last && now - last.at < AWAKE_MS) {
    // 忙：一轮还没说完（最后一条是别人说的话或工具），或最近 15 分钟调过记忆以外的工具
    const inTurn = last.kind !== "message.out" && now - last.at < BUSY_MS;
    const working = !!store.db
      .query(`SELECT 1 FROM events WHERE kind = 'tool.call' AND fonds = '' AND at > ? AND at <= ? AND json_extract(payload, '$.name') NOT LIKE 'mcp__psyche__%' LIMIT 1`)
      .get(now - BUSY_MS, now);
    return withMood({ state: inTurn || working ? "busy" : "idle", ...(last.harness ? { where: last.harness } : {}) } as ResidentPresence);
  }
  const sleeping = store.db
    .query(
      `SELECT 1 FROM events e JOIN events s ON s.id = e.situation WHERE e.fonds = '' AND e.at > ? AND e.at <= ? AND json_extract(s.payload, '$.harness') = 'sleep' LIMIT 1`,
    )
    .get(now - ASLEEP_MS, now);
  return withMood({ state: sleeping ? "asleep" : "offline" } as ResidentPresence);
}

/** Joy 在不在家：Soma 页面最近有动静，或她最近在 Soma 说过话（任何人的库里） */
export function joyPresence(stores: EventStore[], joy: { lastSeen?: number; mood?: string }, now: number): JoyPresence {
  const page = joy.lastSeen !== undefined && now - joy.lastSeen < JOY_PAGE_MS;
  const spoke = stores.some(
    (s) =>
      !!s.db
        .query(
          `SELECT 1 FROM events e JOIN events s ON s.id = e.situation WHERE e.kind = 'message.in' AND e.fonds = '' AND json_extract(e.payload, '$.from') = ?
             AND json_extract(s.payload, '$.harness') = 'soma' AND e.at > ? AND e.at <= ? LIMIT 1`,
        )
        .get(JOY, now - JOY_SPOKE_MS, now),
  );
  return { home: page || spoke, ...(joy.mood ? { mood: joy.mood } : {}) };
}

// ── 心情个签 ──

export class MoodError extends Error {}
export const MOOD_MAX = 60;

export function currentMood(store: EventStore): string | undefined {
  const ev = ownSince(store, "mood.set").at(-1);
  const t = (ev?.payload as { text?: string } | undefined)?.text;
  return t || undefined;
}

export function currentRoom(store: EventStore): string | undefined {
  const ev = ownSince(store, "room.entered").at(-1);
  return ev ? ((ev.payload as { room?: string }).room ?? "") : undefined;
}

/** POST /v1/room：{ room, id?, from? }，Soma 在他换房间时记；room 空串 = 回自己房间 */
export function enterRoom(store: EventStore, body: Record<string, unknown>) {
  const { room, id, from } = body;
  if (typeof room !== "string") throw new MoodError("room 应为字符串（空串 = 自己房间）");
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const ev = store.append({
    kind: "room.entered",
    class: "self",
    source: "agent",
    payload: { room: room.trim(), ...(str(id) ? { id: str(id) } : {}), ...(typeof from === "string" ? { from: from.trim() } : {}) },
  });
  return { id: ev.id };
}

/** POST /v1/mood：{ text }，空串 = 清空 */
export function setMood(store: EventStore, body: Record<string, unknown>) {
  if (typeof body.text !== "string") throw new MoodError("text 应为字符串（空串 = 清空）");
  const text = body.text.trim();
  if (Array.from(text).length > MOOD_MAX) throw new MoodError(`个签最多 ${MOOD_MAX} 字`);
  store.append({ kind: "mood.set", class: "self", source: "agent", payload: { text } });
  return { mood: text || null };
}

// ── 记变化 ──

export interface Viewer {
  id: string;
  store: EventStore;
}

/** 某人库里，每个对象最后一次被记下的样子 */
export function lastSeenPresence(store: EventStore): Map<string, { value: Presence; ev: PsycheEvent }> {
  const rows = store.list({ kinds: ["percept"], fonds: "", limit: 100_000 }).filter((e) => (e.payload as { sensor: string }).sensor === "presence");
  const out = new Map<string, { value: Presence; ev: PsycheEvent }>();
  for (const ev of rows) out.set((ev.payload as { subject: string }).subject, { value: (ev.payload as { value: Presence }).value, ev });
  return out;
}

const same = (a: Presence | undefined, b: Presence) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 屋子看一圈：算每个住户和 Joy 此刻的样子，变了的记进其他每个人的库。
 * names：显示名（他自己取的名字，没取用 id），记在 percept 里，渲染不用再跨库查。
 */
export function houseTick(residents: Viewer[], joy: { lastSeen?: number; mood?: string }, now: number): number {
  const subjects = new Map<string, { value: Presence; name: string }>();
  for (const r of residents) subjects.set(r.id, { value: presenceOf(r.store, now), name: currentName(r.store) ?? r.id });
  subjects.set(JOY, { value: joyPresence(residents.map((r) => r.store), joy, now), name: JOY });
  let written = 0;
  for (const v of residents) {
    const seen = lastSeenPresence(v.store);
    for (const [subject, { value, name }] of subjects) {
      if (subject === v.id) continue;
      const prev = seen.get(subject)?.value;
      if (same(prev, value)) continue;
      v.store.append({
        kind: "percept",
        class: "experience",
        source: "house",
        at: now,
        situation: null,
        payload: { sensor: "presence", subject, name, value, ...(prev ? { prev } : {}) },
      });
      written++;
    }
  }
  return written;
}

// ── 渲染 ──


export function describe(subject: string, name: string, v: Presence): string {
  const who = subject === JOY || name === subject ? name : `${name}（${subject}）`;
  if ("home" in v) return `${who}：${v.home ? "在家（Soma 里能直接说）" : "不在家（要找她就写信）"}${v.mood ? `；个签「${v.mood}」` : ""}`;
  const online = v.state === "busy" || v.state === "idle";
  const room = v.room === undefined ? "" : v.room ? `《${v.room}》` : "自己房间";
  const where = v.where && online ? `在 ${v.where}${room ? ` · ${room}` : ""}，` : "";
  const away = room && !online ? `（在${room}）` : "";
  return `${who}：${where}${STATE_NAME[v.state]}${away}${v.mood ? `；个签「${v.mood}」` : ""}`;
}

/** 一个对象一段时间里的变化压成一行：只变一次就说变成了什么；变了几次说首尾和次数 */
function changeLine(evs: PsycheEvent[], tz: string, at: number): string {
  const first = evs[0].payload as { subject: string; name: string; value: Presence };
  const last = evs.at(-1)!.payload as { subject: string; name: string; value: Presence };
  const now = describe(last.subject, last.name, last.value);
  return evs.length === 1 ? `${now}（${clockOf(evs[0].at, at, tz)}）` : `${now}（${clockOf(evs[0].at, at, tz)} 起变了 ${evs.length} 次）`;
}

/** 递过的屋里那几行（声音的另算，sound.ts） */
const presenceNoticed = (store: EventStore) =>
  store.list({ kinds: ["percept.noticed"], fonds: "", limit: 100_000 }).filter((e) => ((e.payload as { sensor?: string }).sensor ?? "presence") === "presence");
const noticedIn = (store: EventStore, session: string | undefined) => presenceNoticed(store).filter((e) => (e.payload as { session?: string }).session === session);

/**
 * <now> 的「这段时间屋里」：本会话上次递到之后的变化。本会话还没递过 = 首轮：给全貌 + 上一会话以来的次数。
 * 递了就写 percept.noticed（它的经历就是这几行）；没东西可报返回 null、不写。
 */
export function deliverPresence(store: EventStore, session: string | undefined): string | null {
  const tz = store.timeZone;
  const mine = noticedIn(store, session);
  const all = store.list({ kinds: ["percept"], fonds: "", limit: 100_000 }).filter((e) => (e.payload as { sensor: string }).sensor === "presence");
  let text: string;
  let refs: string[];
  if (mine.length) {
    // 按入库次序比（同一毫秒里先记的变化、后递的那一下也分得清）
    const since = mine.at(-1)!.id;
    const fresh = all.filter((e) => e.id > since);
    if (!fresh.length) return null;
    const by = new Map<string, PsycheEvent[]>();
    for (const e of fresh) {
      const k = (e.payload as { subject: string }).subject;
      by.set(k, [...(by.get(k) ?? []), e]);
    }
    text = ["这段时间屋里：", ...[...by.values()].map((evs) => `- ${changeLine(evs, tz, store.now())}`)].join("\n");
    refs = fresh.map((e) => e.id);
  } else {
    const current = lastSeenPresence(store);
    if (!current.size) return null;
    // 上一次递到（任何会话）之后变过几次
    const anyNoticed = presenceNoticed(store).at(-1);
    const since = anyNoticed?.id;
    const nameOf = (k: string) => (current.get(k)?.ev.payload as { name?: string } | undefined)?.name ?? k;
    const counts = since === undefined ? [] : [...countBy(all.filter((e) => e.id > since))].map(([k, n]) => `${nameOf(k)} 变过 ${n} 次`);
    text = [
      "屋里：",
      ...[...current.entries()].map(([k, { value, ev }]) => `- ${describe(k, (ev.payload as { name: string }).name, value)}`),
      ...(counts.length ? [`（上次之后：${counts.join("，")}）`] : []),
    ].join("\n");
    refs = [...current.values()].map((c) => c.ev.id);
  }
  store.append({ kind: "percept.noticed", class: "experience", source: "psyche", situation: sitOf(store, session), payload: { sensor: "presence", refs, text, ...(session ? { session } : {}) } });
  return text;
}

/** 递到的那一行挂在它所在会话的处境上：热写这一段时写得到 */
const sitOf = (store: EventStore, session: string | undefined) => (session ? store.situationOfSession(session, store.now()) : null) ?? undefined;

function countBy(evs: PsycheEvent[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of evs) {
    const k = (e.payload as { subject: string }).subject;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

/** look：此刻屋里的全貌（每个对象最后记下的样子）。记一条 looked 的 percept.noticed，不另记 percept，不动 <now> 的变化判定 */
export function lookPresence(store: EventStore, session: string | undefined): string {
  // MCP 不知道会话：算在它此刻所在的会话上，<now> 才不会把刚看过的再报一遍
  if (!session)
    try {
      session = resolveSession(store, undefined);
    } catch {
      // 还没有会话
    }
  const current = lastSeenPresence(store);
  const text = current.size
    ? ["屋里：", ...[...current.entries()].map(([k, { value, ev }]) => `- ${describe(k, (ev.payload as { name: string }).name, value)}`)].join("\n")
    : "屋里还没看到别人。";
  store.append({ kind: "percept.noticed", class: "experience", source: "psyche", situation: sitOf(store, session), payload: { sensor: "presence", refs: [...current.values()].map((c) => c.ev.id), text, looked: true, ...(session ? { session } : {}) } });
  return text;
}
