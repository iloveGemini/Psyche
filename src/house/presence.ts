/**
 * 全屋有谁（notes/plan/m8.md §二，M8a；位置与感知范围见 houses-p1.md §四 §五）：住户在线 / 忙 / 闲 / 睡着 / 离线、在哪间房、心情个签；
 * Joy 在哪间房、有没有动静。
 *
 * - 只报事实，不猜内心：忙 / 闲从各人自己库里的动静算；个签是本人挂的。
 * - 跨住户只读这几项（presenceOf），不开别的口子——别人的想法、工具结果看不到。
 * - 感知按位置（houses.md §四点五）：看一圈时就按看的人和被看的人的位置算出「他能感知到的那一面」（seenBy），记进看的人库里的
 *   就是这一面。所以「只记变化」比的是他能感知到的变化：别的房子里的人忙了闲了，他库里不记；他自己换了房间，看到的范围变了才记。
 * - 只记变化：全屋每 30 秒看一圈（houseTick），谁变了就在**其他每个人**的库里记一条 percept（不记进本人的库：自己的事自己经历过）。
 * - 递：<now> 报本会话上次递到之后的变化；递一次写一条 percept.noticed，它的经历就是递出去的那几行（a1 提）。
 */
import type { EventStore, PsycheEvent } from "../store/events.ts";
import { AWAKE_MS, BUSY_MS, NOT_PLACE_SQL } from "../channel/inbox.ts";
import { currentName, ownSince } from "../self/self.ts";
import { clockOf } from "../core/time.ts";
import { resolveSession } from "../catalog/hotwrite.ts";
import { delivers, records } from "../perception/senses.ts";

export type State = "busy" | "idle" | "asleep" | "offline";
export const STATE_NAME: Record<State, string> = { busy: "忙", idle: "闲", asleep: "睡着", offline: "离线" };

/** 一个人此刻在哪：哪座房子的哪间房（houses-p1.md §四）；包间再带 parent / parentName（houses-p3.md §六） */
export interface Place {
  house: string;
  houseName: string;
  /** 房间 id；空串 = 只知道在这座房子、不知道哪间（没有位置记录的） */
  id: string;
  room: string;
  parent?: string;
  parentName?: string;
}
/** 没有位置记录的（历史）当成在 Soma 101（houses-p1.md §五） */
export const DEFAULT_HOUSE = { house: "soma-101", houseName: "Soma 101" };

export interface ResidentPresence {
  state: State;
  /** 在线时在哪（soma / pi / …）：他那条线的处境 */
  where?: string;
  /** 在哪间房：最后一次 room.entered；没有 = 没有位置记录 */
  place?: Place;
  mood?: string;
}
export interface JoyPresence {
  /** 有没有动静：Soma 页面最近动过，或她最近在 Soma 说过话（她关了页面也还在最后那间房，houses.md §十一.12） */
  home: boolean;
  place?: Place;
  mood?: string;
}
export type Presence = ResidentPresence | JoyPresence;

/**
 * 看的人眼里被看的人的样子（houses.md §四点五，10-23 复盘全透明）：记进看的人库里的 percept.value 就是这个。
 * - 同一间房（或同包间）：带 here + 状态（住户忙 / 闲 / 睡着 / 离线；Joy 有没有动静）+ 个签
 * - 不同房间或不同房子：带 at（在哪间）+ 状态 + 个签（不再因跨房间/跨房子抹掉状态或报「不在这座房子」；不想看谁由 P4 senses 管）
 */
export type Seen =
  | { here?: true; at?: Place; state: State; where?: string; mood?: string }
  | { here?: true; at?: Place; active: boolean; mood?: string }
  | { at: Place; mood?: string }
  | { away: true; mood?: string };
/** 库里 percept 的值：Seen，或改位置之前记下的老样子（住户的 room 是字符串、Joy 只有 home） */
export type Perceived = Seen | (Omit<ResidentPresence, "place"> & { room?: string }) | { home: boolean; mood?: string };

export const JOY = "Joy";
/** Soma 页面多久没动静算她不在家；她在 Soma 说过话多久内算在家 */
export const JOY_PAGE_MS = 10 * 60_000;
export const JOY_SPOKE_MS = 30 * 60_000;
const ASLEEP_MS = 10 * 60_000;

/** 一个住户此刻的样子：只看他自己的库 */
export function presenceOf(store: EventStore, now = store.now(), self?: string): ResidentPresence {
  const mood = currentMood(store);
  const last = store.db
    .query(
      `SELECT e.at, e.kind, json_extract(s.payload, '$.harness') AS harness FROM events e LEFT JOIN events s ON s.id = e.situation
       WHERE e.kind IN ('message.in', 'message.out', 'speech.silent', 'tool.call', 'tool.result') AND e.fonds = '' AND ${NOT_PLACE_SQL} AND e.at <= ?
       ORDER BY e.at DESC, e.id DESC LIMIT 1`,
    )
    .get(now) as { at: number; kind: string; harness: string | null } | null;
  const place = currentPlace(store, self);
  const withMood = <T extends object>(p: T) => ({ ...p, ...(place ? { place } : {}), ...(mood ? { mood } : {}) });

  if (last && now - last.at < AWAKE_MS) {
    // 忙：一轮还没说完（最后一条是别人说的话或工具），或最近 15 分钟调过记忆以外的工具
    const inTurn = last.kind !== "message.out" && last.kind !== "speech.silent" && now - last.at < BUSY_MS;
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

export interface JoyState {
  lastSeen?: number;
  mood?: string;
  /** 她在哪间房（POST /v1/house/joy/where，存 house.json） */
  place?: Place;
}

/** Joy 此刻：在哪间房（最后报的），有没有动静（Soma 页面最近有动静，或她最近在 Soma 说过话，任何人的库里） */
export function joyPresence(stores: EventStore[], joy: JoyState, now: number): JoyPresence {
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
  return { home: page || spoke, ...(joy.place ? { place: joy.place } : {}), ...(joy.mood ? { mood: joy.mood } : {}) };
}

// ── 心情个签 ──

export class MoodError extends Error {}
export const MOOD_MAX = 60;

export function currentMood(store: EventStore): string | undefined {
  const ev = ownSince(store, "mood.set").at(-1);
  const t = (ev?.payload as { text?: string } | undefined)?.text;
  return t || undefined;
}

/**
 * 他此刻在哪：最后一次 room.entered。没有 = 没有位置记录。
 * 老记录（没有 house）当成在 Soma 101；老的「room 空串 = 自己房间」照「<名字>的房间」（id own-<他的 id>）算（houses-p1.md §二）。
 */
export function currentPlace(store: EventStore, self?: string): Place | undefined {
  const ev = ownSince(store, "room.entered").at(-1);
  if (!ev) return undefined;
  const p = ev.payload as { house?: string; houseName?: string; id?: string; room?: string; parent?: string; parentName?: string };
  const house = p.house || DEFAULT_HOUSE.house;
  const houseName = p.houseName || (house === DEFAULT_HOUSE.house ? DEFAULT_HOUSE.houseName : house);
  const room = p.room ?? "";
  if (!room && !p.id) {
    const who = self ?? "self";
    return { house, houseName, id: `own-${who}`, room: `${currentName(store) ?? who}的房间` };
  }
  return {
    house,
    houseName,
    id: p.id || room,
    room: room || p.id!,
    ...(p.parent ? { parent: p.parent } : {}),
    ...(p.parentName ? { parentName: p.parentName } : {}),
  };
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** 报来的位置：{ house, houseName, id, room, parent?, parentName? }；Joy 的 /v1/house/joy/where 也用它 */
export function parsePlace(body: Record<string, unknown>): Place {
  const house = str(body.house);
  const id = str(body.id);
  if (!house) throw new MoodError("house 应为非空字符串（房子 id）");
  if (!id) throw new MoodError("id 应为非空字符串（房间 id）");
  if (body.room !== undefined && typeof body.room !== "string") throw new MoodError("room 应为字符串（房间名）");
  return {
    house,
    houseName: str(body.houseName) ?? house,
    id,
    room: str(body.room) ?? id,
    ...(str(body.parent) ? { parent: str(body.parent) } : {}),
    ...(str(body.parentName) ? { parentName: str(body.parentName) } : {}),
  };
}

/**
 * POST /v1/room：Soma 在他换位置时记（houses-p1.md §四、houses-p3.md §六）。
 * 新形状 { house, houseName, id, room, from, fromHouse, parent?, parentName? }；旧形状 { room, id?, from? }（没有 house）照收，当成 soma-101。
 */
export function enterRoom(store: EventStore, body: Record<string, unknown>) {
  const { room, from, fromHouse } = body;
  if (typeof room !== "string") throw new MoodError("room 应为字符串（房间名）");
  let payload: Record<string, unknown>;
  if (body.house === undefined) {
    payload = { ...DEFAULT_HOUSE, room: room.trim(), ...(str(body.id) ? { id: str(body.id) } : {}) };
  } else {
    const p = parsePlace(body);
    payload = {
      house: p.house,
      houseName: p.houseName,
      id: p.id,
      room: p.room,
      ...(p.parent ? { parent: p.parent } : {}),
      ...(p.parentName ? { parentName: p.parentName } : {}),
    };
  }
  if (typeof from === "string") payload.from = from.trim();
  if (str(fromHouse)) payload.fromHouse = str(fromHouse);
  const ev = store.append({ kind: "room.entered", class: "self", source: "agent", payload });
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

/** 看的人在 viewer，被看的人此刻是 subject：全屋全透明（houses.md §四点五、houses-p1.md §五），同一间房标 here，不同房间/房子带 at，状态与个签都保留 */
export function seenBy(viewer: Place | undefined, subject: Presence): Seen {
  const s = subject.place;
  const sameRoom = !!(s && viewer && s.house === viewer.house && s.id && s.id === viewer.id);
  const loc = sameRoom ? { here: true as const } : s ? { at: s } : {};
  const mood = subject.mood ? { mood: subject.mood } : {};
  if ("home" in subject) return { ...loc, active: subject.home, ...mood };
  return { ...loc, state: subject.state, ...(subject.where ? { where: subject.where } : {}), ...mood };
}

/** 在不在跟前（环境指纹用）：同一间房里在线 / 有动静；老记录照老口径（在线、在家） */
export function around(v: Perceived): boolean {
  if ("away" in v || "at" in v) return false;
  if ("active" in v) return v.active;
  if ("home" in v) return v.home;
  return v.state === "busy" || v.state === "idle";
}

/** 某人库里，每个对象最后一次被记下的样子 */
export function lastSeenPresence(store: EventStore): Map<string, { value: Perceived; ev: PsycheEvent }> {
  const rows = store.list({ kinds: ["percept"], fonds: "", limit: 100_000 }).filter((e) => (e.payload as { sensor: string }).sensor === "presence");
  const out = new Map<string, { value: Perceived; ev: PsycheEvent }>();
  for (const ev of rows) out.set((ev.payload as { subject: string }).subject, { value: (ev.payload as { value: Perceived }).value, ev });
  return out;
}

const same = (a: Perceived | undefined, b: Perceived) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 全屋看一圈：算每个住户和 Joy 此刻的样子，按看的人是否在同房间标 here 或 at，变了的记进他的库。
 * names：显示名（他自己取的名字，没取用 id），记在 percept 里，渲染不用再跨库查。
 */
export function houseTick(residents: Viewer[], joy: JoyState, now: number): number {
  const subjects = new Map<string, { value: Presence; name: string }>();
  for (const r of residents) subjects.set(r.id, { value: presenceOf(r.store, now, r.id), name: currentName(r.store) ?? r.id });
  subjects.set(JOY, { value: joyPresence(residents.map((r) => r.store), joy, now), name: JOY });
  let written = 0;
  for (const v of residents) {
    const seen = lastSeenPresence(v.store);
    const at = subjects.get(v.id)?.value.place;
    for (const [subject, { value: full, name }] of subjects) {
      if (subject === v.id) continue;
      if (!records(v.store, "presence", subject)) continue; // 他设了不看这个人（m8.md §6.4）
      const value = seenBy(at, full);
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


/** 「Soma 101 · 客厅」；包间带 parentName 时显示「Soma 101 · 游戏室 · 包间《…》」；不知道哪间就只说房子 */
export const placeName = (p: Place) => {
  if (!p.room) return p.houseName;
  if (p.parentName) return `${p.houseName} · ${p.parentName} · ${p.room.startsWith("包间") ? p.room : `包间《${p.room}》`}`;
  return `${p.houseName} · ${p.room}`;
};

export function describe(subject: string, name: string, v: Perceived): string {
  const who = subject === JOY || name === subject ? name : `${name}（${subject}）`;
  const mood = v.mood ? `；个签「${v.mood}」` : "";
  if ("away" in v) return `${who}：不在这座房子${mood}`;
  if ("active" in v) {
    const where = v.here ? "在这里" : "at" in v && v.at ? `在 ${placeName(v.at)}` : "在";
    return `${who}：${where}，${v.active ? "有动静" : "没动静"}${mood}`;
  }
  if ("at" in v && !("state" in v)) return `${who}：在 ${placeName(v.at)}${mood}`;
  // 改位置之前记下的老样子
  if ("home" in v) return `${who}：${v.home ? "在家（Soma 里能直接说）" : "不在家（要找她就写信）"}${mood}`;
  const online = v.state === "busy" || v.state === "idle";
  const onOther = v.where && online && v.where !== "soma" ? `（这会儿在 ${v.where} 上）` : "";
  if ("here" in v && v.here) return `${who}：在这里，${STATE_NAME[v.state]}${onOther}${mood}`;
  if ("at" in v && v.at) return `${who}：在 ${placeName(v.at)}，${STATE_NAME[v.state]}${onOther}${mood}`;
  const r = "room" in v ? v.room : undefined;
  const room = r === undefined ? "" : r ? `《${r}》` : "自己房间";
  const where = v.where && online ? `在 ${v.where}${room ? ` · ${room}` : ""}，` : "";
  const away = room && !online ? `（在${room}）` : "";
  return `${who}：${where}${STATE_NAME[v.state]}${away}${mood}`;
}

/** 一个对象一段时间里的变化压成一行：只变一次就说变成了什么；变了几次说首尾和次数 */
function changeLine(evs: PsycheEvent[], tz: string, at: number): string {
  const last = evs.at(-1)!.payload as { subject: string; name: string; value: Perceived };
  const now = describe(last.subject, last.name, last.value);
  return evs.length === 1 ? `${now}（${clockOf(evs[0].at, at, tz)}）` : `${now}（${clockOf(evs[0].at, at, tz)} 起变了 ${evs.length} 次）`;
}

/** 递过的全屋那几行（声音的另算，sound.ts） */
const presenceNoticed = (store: EventStore) =>
  store.list({ kinds: ["percept.noticed"], fonds: "", limit: 100_000 }).filter((e) => ((e.payload as { sensor?: string }).sensor ?? "presence") === "presence");
const noticedIn = (store: EventStore, session: string | undefined) => presenceNoticed(store).filter((e) => (e.payload as { session?: string }).session === session);

/**
 * <now> 的「这段时间全屋」：本会话上次递到之后的变化。本会话还没递过 = 首轮：给全貌 + 上一会话以来的次数。
 * 递了就写 percept.noticed（它的经历就是这几行）；没东西可报返回 null、不写。
 */
export function deliverPresence(store: EventStore, session: string | undefined): string | null {
  const tz = store.timeZone;
  const mine = noticedIn(store, session);
  // 只递他设了「看」的人（m8.md §6.4）
  const shown = (subject: string) => delivers(store, "presence", subject);
  const all = store
    .list({ kinds: ["percept"], fonds: "", limit: 100_000 })
    .filter((e) => (e.payload as { sensor: string }).sensor === "presence" && shown((e.payload as { subject: string }).subject));
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
    text = ["这段时间全屋：", ...[...by.values()].map((evs) => `- ${changeLine(evs, tz, store.now())}`)].join("\n");
    refs = fresh.map((e) => e.id);
  } else {
    const current = new Map([...lastSeenPresence(store)].filter(([k]) => shown(k)));
    if (!current.size) return null;
    // 上一次递到（任何会话）之后变过几次
    const anyNoticed = presenceNoticed(store).at(-1);
    const since = anyNoticed?.id;
    const nameOf = (k: string) => (current.get(k)?.ev.payload as { name?: string } | undefined)?.name ?? k;
    const counts = since === undefined ? [] : [...countBy(all.filter((e) => e.id > since))].map(([k, n]) => `${nameOf(k)} 变过 ${n} 次`);
    text = [
      "全屋：",
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

/** look：此刻全屋的全貌（每个对象最后记下的、他能感知到的那一面）。记一条 looked 的 percept.noticed，不另记 percept，不动 <now> 的变化判定 */
export function lookPresence(store: EventStore, session: string | undefined): string {
  // MCP 不知道会话：算在它此刻所在的会话上，<now> 才不会把刚看过的再报一遍
  if (!session)
    try {
      session = resolveSession(store, undefined);
    } catch {
      // 还没有会话
    }
  // 不看的人 look 也不给（只记着的照给）
  const current = new Map([...lastSeenPresence(store)].filter(([k]) => records(store, "presence", k)));
  const text = current.size
    ? ["全屋：", ...[...current.entries()].map(([k, { value, ev }]) => `- ${describe(k, (ev.payload as { name: string }).name, value)}`)].join("\n")
    : "全屋还没看到别人。";
  store.append({ kind: "percept.noticed", class: "experience", source: "psyche", situation: sitOf(store, session), payload: { sensor: "presence", refs: [...current.values()].map((c) => c.ev.id), text, looked: true, ...(session ? { session } : {}) } });
  return text;
}
