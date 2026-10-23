/**
 * 全屋有谁的确定性考卷（notes/plan/m8.md §七、M8a；位置与感知范围 houses-p1.md §四 §五）：在线 / 忙 / 闲 / 睡着 / 离线怎么算、
 * 只记变化、记进别人的库、<now> 递什么、递到的才是经历、look 不重报、个签、Joy 有没有动静、按位置过滤。只考系统，不跑模型。
 */
import { describe, expect, test } from "bun:test";
import { EventStore } from "../src/store/events.ts";
import { Projections } from "../src/store/projections.ts";
import { intake } from "../src/archive/intake.ts";
import { experienceProjector, readExperience } from "../src/archive/experience.ts";
import { createApp } from "../src/server/app.ts";
import { houseTick, presenceOf, joyPresence, deliverPresence, lookPresence, enterRoom, setMood, seenBy, JOY, describe as line, type Place, type JoyState } from "../src/house/presence.ts";
import { openHouse } from "../src/house/house.ts";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const setMoodVia = (s: EventStore, text: string) => setMood(s, { text });
const T = (s: string) => Date.parse(`${s}+08:00`);
const MIN = 60_000;
const JSON_H = { "content-type": "application/json" };

function setup() {
  const clock = { t: T("2026-10-16T18:00:00") };
  const mk = () => {
    const store = new EventStore(":memory:", { now: () => clock.t });
    const p = new Projections(store);
    p.register(experienceProjector);
    p.live();
    return store;
  };
  const a1 = mk();
  const a2 = mk();
  const residents = [
    { id: "a1", store: a1 },
    { id: "a2", store: a2 },
  ];
  const sit = (s: EventStore, session: string, harness = "soma") => s.setSituation({ harness, session }, harness);
  const her = (s: EventStore, text: string) => intake(s, { kind: "message.in", source: "soma", payload: { from: "Joy", text } });
  const me = (s: EventStore, text: string) => intake(s, { kind: "message.out", source: "soma", payload: { text } });
  const tool = (s: EventStore, name = "Bash") => intake(s, { kind: "tool.call", source: "soma", payload: { name, callId: String(Math.random()) } });
  const joy: JoyState = {};
  const tick = () => houseTick(residents, joy, clock.t);
  const pass = (ms: number) => (clock.t += ms);
  const percepts = (s: EventStore) => s.list({ kinds: ["percept"], fonds: "", limit: 1000 }).map((e) => e.payload as any);
  return { clock, a1, a2, residents, sit, her, me, tool, joy, tick, pass, percepts };
}

describe("在线 / 忙 / 闲 / 睡着 / 离线", () => {
  test("从自己库里的动静算", () => {
    const h = setup();
    expect(presenceOf(h.a2).state).toBe("offline");
    h.sit(h.a2, "s2", "pi");
    h.her(h.a2, "在吗");
    expect(presenceOf(h.a2)).toEqual({ state: "busy", where: "pi" }); // 一轮还没说完
    h.pass(MIN);
    h.me(h.a2, "在");
    expect(presenceOf(h.a2)).toEqual({ state: "idle", where: "pi" });
    h.tool(h.a2);
    h.me(h.a2, "跑完了");
    expect(presenceOf(h.a2).state).toBe("busy"); // 15 分钟内调过记忆以外的工具
    h.pass(16 * MIN);
    expect(presenceOf(h.a2).state).toBe("idle");
    h.pass(20 * MIN);
    expect(presenceOf(h.a2).state).toBe("offline");
    h.sit(h.a2, "z", "sleep");
    h.tool(h.a2, "mcp__psyche__hotwrite");
    expect(presenceOf(h.a2).state).toBe("asleep"); // 睡着时的动静不算在线
  });

  test("没出声也是这一轮完了（speech.silent）", () => {
    const h = setup();
    h.sit(h.a1, "s1", "pi");
    h.her(h.a1, "在吗");
    expect(presenceOf(h.a1).state).toBe("busy");
    h.pass(MIN);
    intake(h.a1, { kind: "speech.silent", source: "roxy", payload: {} });
    expect(presenceOf(h.a1).state).toBe("idle");
  });
});

describe("只记变化，记进别人的库", () => {
  test("第一圈全记、没变不记、自己的不记进自己库", () => {
    const h = setup();
    h.tick();
    expect(h.percepts(h.a1).map((p) => p.subject).sort()).toEqual(["Joy", "a2"]);
    expect(h.percepts(h.a2).map((p) => p.subject).sort()).toEqual(["Joy", "a1"]);
    h.tick();
    expect(h.percepts(h.a1)).toHaveLength(2);
    h.sit(h.a2, "s2", "pi");
    h.me(h.a2, "hi");
    h.tick();
    const last = h.percepts(h.a1).at(-1);
    expect([last.subject, last.value, last.prev]).toEqual(["a2", { state: "idle", where: "pi" }, { state: "offline" }]);
    expect(h.percepts(h.a2)).toHaveLength(2);
  });

  test("个签：本人挂、进本人经历、变了别人看得到；超长拒", async () => {
    const h = setup();
    const app = createApp({ store: h.a2, projections: new Projections(h.a2) });
    const post = (body: unknown) => app.request("/v1/mood", { method: "POST", headers: JSON_H, body: JSON.stringify(body) });
    expect((await post({ text: "在赶 S2" })).status).toBe(200);
    expect((await post({ text: "长".repeat(61) })).status).toBe(400);
    expect(readExperience(h.a2.db, {}).map((l) => l.text)).toContain("我把个签改成了「在赶 S2」");
    h.tick();
    expect(h.percepts(h.a1).find((p) => p.subject === "a2").value).toEqual({ state: "offline", mood: "在赶 S2" });
    await post({ text: "" });
    expect(presenceOf(h.a2).mood).toBeUndefined();
  });

  test("换房间：旧形状照收当成 Soma 101；本人经历里有这一步；同一间房看得到状态", async () => {
    const h = setup();
    const app = createApp({ store: h.a2, projections: new Projections(h.a2) });
    const post = (body: unknown) => app.request("/v1/room", { method: "POST", headers: JSON_H, body: JSON.stringify(body) });
    expect(presenceOf(h.a2).place).toBeUndefined();
    expect((await post({ room: "客厅", id: "living" })).status).toBe(200);
    expect((await post({ room: 3 })).status).toBe(400);
    expect(h.a2.list({ kinds: ["room.entered"] }).at(-1)!.payload).toEqual({ house: "soma-101", houseName: "Soma 101", room: "客厅", id: "living" });
    expect(readExperience(h.a2.db, {}).map((l) => l.text)).toContain("我进了 Soma 101 · 客厅");
    expect(presenceOf(h.a2).place).toEqual({ house: "soma-101", houseName: "Soma 101", id: "living", room: "客厅" });
    // a1 没有位置记录：当成在 Soma 101（不知道哪间），看 a2 只看得到在哪间
    h.tick();
    expect(h.percepts(h.a1).find((p) => p.subject === "a2").value).toEqual({ at: { house: "soma-101", houseName: "Soma 101", id: "living", room: "客厅" } });
    enterRoom(h.a1, { room: "客厅", id: "living" });
    h.tick();
    expect(h.percepts(h.a1).findLast((p) => p.subject === "a2").value).toEqual({ here: true, state: "offline" });
    expect(h.percepts(h.a1).findLast((p) => p.subject === JOY).value).toEqual({ at: { house: "soma-101", houseName: "Soma 101", id: "", room: "" } }); // Joy 没报过位置
    expect(line("a2", "a2", { here: true, state: "idle", where: "pi" })).toBe("a2：在这里，闲（这会儿在 pi 上）");
    // 旧的「空串 = 自己房间」：当成 own-<id>「<名字>的房间」
    await post({ room: "" });
    expect(presenceOf(h.a2, undefined, "a2").place).toEqual({ house: "soma-101", houseName: "Soma 101", id: "own-a2", room: "a2的房间" });
    expect(readExperience(h.a2.db, {}).map((l) => l.text)).toContain("我回了自己房间");
  });

  test("换房间：新形状带房子，存下来源和包间", async () => {
    const h = setup();
    const app = createApp({ store: h.a2, projections: new Projections(h.a2) });
    const post = (body: unknown) => app.request("/v1/room", { method: "POST", headers: JSON_H, body: JSON.stringify(body) });
    const body = { house: "a2-house", houseName: "a2 的房子", id: "own-a2", room: "a2的房间", from: "客厅", fromHouse: "soma-101" };
    expect((await post(body)).status).toBe(200);
    expect(h.a2.list({ kinds: ["room.entered"] }).at(-1)!.payload).toEqual(body);
    expect(presenceOf(h.a2).place).toEqual({ house: "a2-house", houseName: "a2 的房子", id: "own-a2", room: "a2的房间" });
    expect(readExperience(h.a2.db, {}).map((l) => l.text)).toContain("我进了 a2 的房子 · a2的房间");
    expect((await post({ house: "fun", houseName: "功能楼", id: "box-1", room: "包间·一", parent: "cinema" })).status).toBe(200);
    expect(presenceOf(h.a2).place).toEqual({ house: "fun", houseName: "功能楼", id: "box-1", room: "包间·一", parent: "cinema" });
    expect((await post({ house: "fun", room: "没有 id" })).status).toBe(400);
  });
});

describe("感知按位置（houses-p1.md §五）", () => {
  const P = (house: string, id: string, room = id): Place => ({ house, houseName: house === "soma-101" ? "Soma 101" : house, id, room });
  const living = P("soma-101", "living", "客厅");
  const tea = P("soma-101", "tea", "茶水间");
  const far = P("roxy", "study", "书房");

  test("表里每一格：同一间房看得到状态、同房子只看得到在哪间、不同房子只有不在这座房子；个签都看得到", () => {
    const s = { state: "busy" as const, where: "soma", mood: "在赶 S2" };
    expect(seenBy(living, { ...s, place: living })).toEqual({ here: true, state: "busy", where: "soma", mood: "在赶 S2" });
    expect(seenBy(tea, { ...s, place: living })).toEqual({ at: living, mood: "在赶 S2" });
    expect(seenBy(far, { ...s, place: living })).toEqual({ away: true, mood: "在赶 S2" });
    // Joy 照同样的规则：同一间房是有没有动静
    expect(seenBy(living, { home: false, place: living })).toEqual({ here: true, active: false });
    expect(seenBy(tea, { home: true, place: living })).toEqual({ at: living });
    expect(seenBy(far, { home: true, place: living, mood: "下班了" })).toEqual({ away: true, mood: "下班了" });
    // 没有位置记录的当成在 Soma 101
    expect(seenBy(undefined, { state: "idle", place: far })).toEqual({ away: true });
    expect(seenBy(far, { state: "idle" })).toEqual({ away: true });
    expect(seenBy(living, { state: "idle" })).toEqual({ at: { house: "soma-101", houseName: "Soma 101", id: "", room: "" } });
    expect(seenBy(undefined, { state: "idle" })).toEqual({ state: "idle" });
    // 显示
    expect(line("a2", "a2", { here: true, state: "busy", where: "soma", mood: "在赶 S2" })).toBe("a2：在这里，忙；个签「在赶 S2」");
    expect(line("a2", "a2", { at: living })).toBe("a2：在 Soma 101 · 客厅");
    expect(line("a2", "a2", { at: { house: "soma-101", houseName: "Soma 101", id: "", room: "" } })).toBe("a2：在 Soma 101");
    expect(line("a2", "a2", { away: true, mood: "在赶 S2" })).toBe("a2：不在这座房子；个签「在赶 S2」");
    expect(line(JOY, JOY, { here: true, active: true })).toBe("Joy：在这里，有动静");
    expect(line(JOY, JOY, { active: false })).toBe("Joy：在，没动静");
  });

  test("只记看得到的变化：别的房子里的人忙闲变了不记；换了位置、看得到的范围变了才记", () => {
    const h = setup();
    enterRoom(h.a1, { house: "soma-101", houseName: "Soma 101", id: "living", room: "客厅" });
    enterRoom(h.a2, { house: "a2-house", houseName: "a2 的房子", id: "own-a2", room: "a2的房间" });
    h.tick();
    expect(h.percepts(h.a1).find((p) => p.subject === "a2").value).toEqual({ away: true });
    expect(h.percepts(h.a2).find((p) => p.subject === "a1").value).toEqual({ away: true });
    const n = h.percepts(h.a1).length;
    h.sit(h.a2, "s2", "pi");
    h.me(h.a2, "hi"); // a2 上线了，a1 看不到
    h.tick();
    expect(h.percepts(h.a1)).toHaveLength(n);
    // 个签例外
    setMoodVia(h.a2, "在造房子");
    h.tick();
    expect(h.percepts(h.a1).at(-1)).toMatchObject({ subject: "a2", value: { away: true, mood: "在造房子" } });
    // a2 搬回 Soma 101 的茶水间：a1 看得到在哪间，看不到状态
    enterRoom(h.a2, { house: "soma-101", houseName: "Soma 101", id: "tea", room: "茶水间" });
    h.tick();
    expect(h.percepts(h.a1).at(-1).value).toEqual({ at: { house: "soma-101", houseName: "Soma 101", id: "tea", room: "茶水间" }, mood: "在造房子" });
    // a1 自己走进茶水间：看得到 a2 的状态了
    enterRoom(h.a1, { house: "soma-101", houseName: "Soma 101", id: "tea", room: "茶水间" });
    h.tick();
    expect(h.percepts(h.a1).at(-1).value).toEqual({ here: true, state: "idle", where: "pi", mood: "在造房子" });
  });

  test("<now> 和 look 只递看得到的；递过不重递", () => {
    const h = setup();
    enterRoom(h.a1, { house: "soma-101", houseName: "Soma 101", id: "living", room: "客厅" });
    enterRoom(h.a2, { house: "soma-101", houseName: "Soma 101", id: "tea", room: "茶水间" });
    h.joy.place = { house: "soma-101", houseName: "Soma 101", id: "living", room: "客厅" };
    h.joy.lastSeen = h.clock.t;
    h.sit(h.a1, "s1");
    h.tick();
    expect(deliverPresence(h.a1, "s1")!.split("\n")).toEqual(["全屋：", "- a2：在 Soma 101 · 茶水间", "- Joy：在这里，有动静"]);
    expect(deliverPresence(h.a1, "s1")).toBeNull();
    // a2 在茶水间忙起来：a1 看不到，不递
    h.sit(h.a2, "s2", "soma");
    h.her(h.a2, "在吗");
    h.pass(MIN);
    h.tick();
    expect(deliverPresence(h.a1, "s1")).toBeNull();
    // Joy 去了茶水间
    h.joy.place = { house: "soma-101", houseName: "Soma 101", id: "tea", room: "茶水间" };
    h.tick();
    expect(deliverPresence(h.a1, "s1")).toBe("这段时间全屋：\n- Joy：在 Soma 101 · 茶水间（18:01）");
    expect(deliverPresence(h.a1, "s1")).toBeNull();
    // look 看到的也是过滤过的；看过 <now> 不重报
    h.joy.place = { house: "roxy", houseName: "Roxy", id: "study", room: "书房" };
    h.tick();
    expect(lookPresence(h.a1, "s1").split("\n")).toEqual(["全屋：", "- a2：在 Soma 101 · 茶水间", "- Joy：不在这座房子"]);
    expect(deliverPresence(h.a1, "s1")).toBeNull();
    // a2 那边：Joy 在别的房子，a1 在客厅
    h.sit(h.a2, "s2");
    expect(deliverPresence(h.a2, "s2")!.split("\n")).toEqual(["全屋：", "- a1：在 Soma 101 · 客厅", "- Joy：不在这座房子"]);
  });
});

describe("Joy 有没有动静、在哪", () => {
  test("页面 10 分钟内有动静，或 30 分钟内在 Soma 说过话", () => {
    const h = setup();
    expect(joyPresence([h.a1], h.joy, h.clock.t).home).toBe(false);
    h.joy.lastSeen = h.clock.t;
    expect(joyPresence([h.a1], h.joy, h.clock.t).home).toBe(true);
    h.pass(11 * MIN);
    expect(joyPresence([h.a1], h.joy, h.clock.t).home).toBe(false);
    h.sit(h.a1, "s1", "soma");
    h.her(h.a1, "我回来了");
    expect(joyPresence([h.a1, h.a2], h.joy, h.clock.t).home).toBe(true);
    h.pass(31 * MIN);
    expect(joyPresence([h.a1, h.a2], h.joy, h.clock.t).home).toBe(false);
  });

  test("全屋的口子：seen / mood / 全屋", async () => {
    const h = setup();
    const dir = mkdtempSync(join(tmpdir(), "house-"));
    const house = openHouse(dir, h.residents, () => h.clock.t);
    await house.handle(new Request("http://x/v1/house/joy/seen", { method: "POST" }));
    await house.handle(new Request("http://x/v1/house/joy/mood", { method: "POST", body: JSON.stringify({ text: "下班了" }) }));
    const all = await (await house.handle(new Request("http://x/v1/house"))).json();
    expect(all.joy).toEqual({ home: true, mood: "下班了" });
    expect(all.residents.map((r: any) => [r.id, r.state])).toEqual([["a1", "offline"], ["a2", "offline"]]);
    expect(h.percepts(h.a1).find((p) => p.subject === JOY).value).toEqual({ active: true, mood: "下班了" });
    expect(openHouse(dir, h.residents, () => h.clock.t).joy.mood).toBe("下班了"); // 重启不丢
  });

  test("Joy 的位置：/v1/house/joy/where 存进 house.json，重启不丢；GET /v1/house 不过滤", async () => {
    const h = setup();
    const dir = mkdtempSync(join(tmpdir(), "house-"));
    const house = openHouse(dir, h.residents, () => h.clock.t);
    const where = (body: unknown) => house.handle(new Request("http://x/v1/house/joy/where", { method: "POST", body: JSON.stringify(body) }));
    expect((await where({ house: "soma-101", room: "客厅" })).status).toBe(400); // 没有房间 id
    const living = { house: "soma-101", houseName: "Soma 101", id: "living", room: "客厅" };
    expect(await (await where(living)).json()).toEqual({ place: living });
    expect(JSON.parse(readFileSync(join(dir, "house.json"), "utf8")).joyWhere).toEqual(living);
    expect(openHouse(dir, h.residents, () => h.clock.t).joy.place).toEqual(living); // 重启不丢
    // 马上看一圈：a1 没有位置记录（Soma 101、不知道哪间），看 Joy 只看得到在哪间
    expect(h.percepts(h.a1).find((p) => p.subject === JOY).value).toEqual({ at: living });
    // 给 Soma / Dashboard 的全貌不过滤
    enterRoom(h.a2, { house: "roxy", houseName: "Roxy", id: "study", room: "书房" });
    const all = await (await house.handle(new Request("http://x/v1/house"))).json();
    expect(all.joy).toEqual({ home: false, place: living });
    expect(all.residents.find((r: any) => r.id === "a2")).toMatchObject({ state: "offline", place: { house: "roxy", id: "study" } });
  });
});

describe("递：<now> 与经历", () => {
  test("首轮给全貌；之后只报变化，压成一行；没变不报", () => {
    const h = setup();
    h.sit(h.a1, "s1");
    h.tick();
    const first = deliverPresence(h.a1, "s1")!;
    expect(first.split("\n")).toEqual(["全屋：", "- a2：离线", "- Joy：在，没动静"]);
    expect(deliverPresence(h.a1, "s1")).toBeNull();
    h.sit(h.a2, "s2", "pi");
    h.me(h.a2, "hi");
    h.pass(MIN);
    h.tick();
    h.pass(20 * MIN);
    h.tick(); // 18:21 还是闲
    h.joy.lastSeen = h.clock.t;
    h.tick();
    h.pass(11 * MIN);
    h.tick();
    const text = deliverPresence(h.a1, "s1")!;
    expect(text).toContain("这段时间全屋：");
    expect(text).toContain("- a2：离线（18:01 起变了 2 次）"); // 18:01 闲 → 18:32 离线
    expect(text).toMatch(/- Joy：在，没动静（18:21 起变了 2 次）/);
  });

  test("递到的才是经历：percept 不进经历，noticed 进；挂在会话上", () => {
    const h = setup();
    h.sit(h.a1, "s1");
    h.her(h.a1, "在吗");
    h.tick();
    deliverPresence(h.a1, "s1");
    const lines = readExperience(h.a1.db, {}).map((l) => l.text);
    expect(lines.filter((l) => l.includes("a2"))).toEqual(["全屋：\n- a2：离线\n- Joy：在，有动静"]);
    expect(lines.some((l) => l.includes("感知"))).toBe(false);
  });

  test("look：给全貌、算经历、之后 <now> 不重报", () => {
    const h = setup();
    h.sit(h.a1, "s1");
    h.her(h.a1, "在吗");
    h.tick();
    deliverPresence(h.a1, "s1");
    h.sit(h.a2, "s2", "pi");
    h.me(h.a2, "hi");
    h.tick();
    expect(lookPresence(h.a1, undefined)).toContain("a2：在 pi，闲");
    expect(deliverPresence(h.a1, "s1")).toBeNull();
    expect(readExperience(h.a1.db, {}).map((l) => l.text).at(-1)).toMatch(/^（我看了看）全屋：/);
  });

  test("新会话首轮带上次之后的次数", () => {
    const h = setup();
    h.sit(h.a1, "s1");
    h.tick();
    deliverPresence(h.a1, "s1");
    h.joy.lastSeen = h.clock.t;
    h.tick();
    h.pass(11 * MIN);
    h.tick();
    h.sit(h.a1, "s2");
    expect(deliverPresence(h.a1, "s2")).toContain("（上次之后：Joy 变过 2 次）");
  });

  test("/v1/now 里带「全屋」", async () => {
    const h = setup();
    const app = createApp({ store: h.a1, projections: new Projections(h.a1) });
    h.sit(h.a1, "s1");
    h.tick();
    const { text } = await (await app.request("/v1/now?session=s1")).json();
    expect(text).toContain("全屋：\n- a2：离线");
  });
});
