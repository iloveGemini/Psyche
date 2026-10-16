/**
 * 屋里有谁的确定性考卷（notes/plan/m8.md §七、M8a）：在线 / 忙 / 闲 / 睡着 / 离线怎么算、只记变化、记进别人的库、
 * <now> 递什么、递到的才是经历、look 不重报、个签、Joy 在不在家。只考系统，不跑模型。
 */
import { describe, expect, test } from "bun:test";
import { EventStore } from "../src/store/events.ts";
import { Projections } from "../src/store/projections.ts";
import { intake } from "../src/archive/intake.ts";
import { experienceProjector, readExperience } from "../src/archive/experience.ts";
import { createApp } from "../src/server/app.ts";
import { houseTick, presenceOf, joyPresence, deliverPresence, lookPresence, JOY } from "../src/house/presence.ts";
import { openHouse } from "../src/house/house.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  const joy: { lastSeen?: number; mood?: string } = {};
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
});

describe("Joy 在不在家", () => {
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

  test("屋子的口子：seen / mood / 全屋", async () => {
    const h = setup();
    const dir = mkdtempSync(join(tmpdir(), "house-"));
    const house = openHouse(dir, h.residents, () => h.clock.t);
    await house.handle(new Request("http://x/v1/house/joy/seen", { method: "POST" }));
    await house.handle(new Request("http://x/v1/house/joy/mood", { method: "POST", body: JSON.stringify({ text: "下班了" }) }));
    const all = await (await house.handle(new Request("http://x/v1/house"))).json();
    expect(all.joy).toEqual({ home: true, mood: "下班了" });
    expect(all.residents.map((r: any) => [r.id, r.state])).toEqual([["a1", "offline"], ["a2", "offline"]]);
    expect(h.percepts(h.a1).find((p) => p.subject === JOY).value).toEqual({ home: true, mood: "下班了" });
    expect(openHouse(dir, h.residents, () => h.clock.t).joy.mood).toBe("下班了"); // 重启不丢
  });
});

describe("递：<now> 与经历", () => {
  test("首轮给全貌；之后只报变化，压成一行；没变不报", () => {
    const h = setup();
    h.sit(h.a1, "s1");
    h.tick();
    const first = deliverPresence(h.a1, "s1")!;
    expect(first.split("\n")).toEqual(["屋里：", "- a2：离线", "- Joy：不在家（要找她就写信）"]);
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
    expect(text).toContain("这段时间屋里：");
    expect(text).toContain("- a2：离线（18:01 起变了 2 次）"); // 18:01 闲 → 18:32 离线
    expect(text).toMatch(/- Joy：不在家（要找她就写信）（18:21 起变了 2 次）/);
  });

  test("递到的才是经历：percept 不进经历，noticed 进；挂在会话上", () => {
    const h = setup();
    h.sit(h.a1, "s1");
    h.her(h.a1, "在吗");
    h.tick();
    deliverPresence(h.a1, "s1");
    const lines = readExperience(h.a1.db, {}).map((l) => l.text);
    expect(lines.filter((l) => l.includes("a2"))).toEqual(["屋里：\n- a2：离线\n- Joy：在家（Soma 里能直接说）"]);
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
    expect(readExperience(h.a1.db, {}).map((l) => l.text).at(-1)).toMatch(/^（我看了看）屋里：/);
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

  test("/v1/now 里带「屋里」", async () => {
    const h = setup();
    const app = createApp({ store: h.a1, projections: new Projections(h.a1) });
    h.sit(h.a1, "s1");
    h.tick();
    const { text } = await (await app.request("/v1/now?session=s1")).json();
    expect(text).toContain("屋里：\n- a2：离线");
  });
});
