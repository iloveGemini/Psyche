/**
 * 感知设置的确定性考卷（m8.md §6.4，P4）：三档（看 / 只记着 / 不看）、按人细到一个、全量替换、写错直接拒；
 * 全屋有谁、外头来的、全屋的东西、内感受按设置记 / 递。只考系统，不跑模型。
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "../src/store/events.ts";
import { Projections } from "../src/store/projections.ts";
import { intake } from "../src/archive/intake.ts";
import { experienceProjector, readExperience } from "../src/archive/experience.ts";
import { createApp } from "../src/server/app.ts";
import { houseTick, deliverPresence, lookPresence, type JoyState } from "../src/house/presence.ts";
import { filesTick } from "../src/house/files.ts";
import { deliverOutside, recordPercept } from "../src/perception/outside.ts";
import { levelOf, readSenses, setSenses } from "../src/perception/senses.ts";

const T = (s: string) => Date.parse(`${s}+08:00`);
const MIN = 60_000;
const JSON_H = { "content-type": "application/json" };

function setup() {
  const clock = { t: T("2026-10-23T20:00:00") };
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
  const joy: JoyState = {};
  const wake = (s: EventStore, text: string) => {
    s.setSituation({ harness: "soma", session: "s" }, "soma");
    intake(s, { kind: "message.in", source: "soma", payload: { from: "Joy", text } });
  };
  const tick = () => houseTick(residents, joy, clock.t);
  const percepts = (s: EventStore, sensor: string) =>
    s
      .list({ kinds: ["percept"], fonds: "", limit: 1000 })
      .map((e) => e.payload as any)
      .filter((p) => p.sensor === sensor);
  return { clock, a1, a2, residents, joy, wake, tick, percepts };
}

describe("设置", () => {
  test("缺省都是看；按人的盖过整路；全量替换，没写的回到看", () => {
    const h = setup();
    expect(levelOf(h.a2, "presence", "a1")).toBe("看");
    setSenses(h.a2, { senses: { presence: "只记着", "presence:Joy": "看", weather: "不看" }, why: "别人的动静我不想每轮看" });
    expect(levelOf(h.a2, "presence", "a1")).toBe("只记着");
    expect(levelOf(h.a2, "presence", "Joy")).toBe("看");
    expect(levelOf(h.a2, "weather", "weather")).toBe("不看");
    setSenses(h.a2, { senses: { files: "不看" }, why: "换一种" });
    expect(levelOf(h.a2, "presence", "a1")).toBe("看");
    expect(readSenses(h.a2)).toMatchObject({ senses: { files: "不看" }, why: "换一种" });
    // 进它的经历
    expect(readExperience(h.a2.db, {}).map((l) => l.text)).toContain("我改了留意的感知：换一种");
  });

  test("写错直接拒，不悄悄生效", () => {
    const h = setup();
    for (const body of [
      { senses: { presence: "看" } }, // 没写 why
      { senses: { presence: "偶尔看" }, why: "x" },
      { senses: { Presence: "看" }, why: "x" },
      { senses: { "files:commons/a.md": "不看" }, why: "x" }, // files 不分人
      { senses: { "body:ctx": "不看" }, why: "x" },
      { senses: { "presence:": "不看" }, why: "x" },
      { senses: [], why: "x" },
    ])
      expect(() => setSenses(h.a2, body as never)).toThrow();
    expect(readSenses(h.a2).senses).toEqual({});
  });

  test("HTTP：POST 设、GET 看（带报来过的外头几路），写错 400；不走上报", async () => {
    const h = setup();
    recordPercept(h.residents, { sensor: "weather", value: 1, text: "下雨" }, h.clock.t);
    const app = createApp({ store: h.a2, projections: new Projections(h.a2) });
    const post = (body: unknown) => app.request("/v1/senses", { method: "POST", headers: JSON_H, body: JSON.stringify(body) });
    expect((await post({ senses: { presence: "不看" } })).status).toBe(400);
    expect((await post({ senses: { presence: "不看" }, why: "清静" })).status).toBe(200);
    expect(await (await app.request("/v1/senses")).json()).toMatchObject({ senses: { presence: "不看" }, why: "清静", outside: ["weather"] });
    expect(() => intake(h.a2, { kind: "senses.changed", source: "soma", payload: { senses: {}, why: "x" } })).toThrow();
  });
});

describe("全屋有谁", () => {
  test("不看某人：不记、不递、look 也不给；别人照常", () => {
    const h = setup();
    setSenses(h.a2, { senses: { "presence:a1": "不看" }, why: "x" });
    h.joy.lastSeen = h.clock.t;
    h.wake(h.a1, "早");
    h.tick();
    expect(h.percepts(h.a2, "presence").map((p) => p.subject)).toEqual(["Joy"]);
    expect(deliverPresence(h.a2, "s2")).not.toContain("a1");
    expect(lookPresence(h.a2, "s2")).not.toContain("a1");
  });

  test("只记着：照样记、look 看得到，<now> 不递；改回看之后递", () => {
    const h = setup();
    setSenses(h.a2, { senses: { presence: "只记着" }, why: "x" });
    h.wake(h.a1, "早");
    h.tick();
    expect(h.percepts(h.a2, "presence").map((p) => p.subject)).toContain("a1");
    expect(deliverPresence(h.a2, "s2")).toBeNull();
    expect(lookPresence(h.a2, "s2")).toContain("a1");
    setSenses(h.a2, { senses: {}, why: "还是看吧" });
    expect(deliverPresence(h.a2, "s3")).toContain("a1");
  });

  test("不看改回看：下一圈看到的样子当一次变化记下", () => {
    const h = setup();
    setSenses(h.a2, { senses: { "presence:a1": "不看" }, why: "x" });
    h.wake(h.a1, "早");
    h.tick();
    expect(h.percepts(h.a2, "presence").filter((p) => p.subject === "a1")).toHaveLength(0);
    setSenses(h.a2, { senses: {}, why: "y" });
    h.clock.t += MIN;
    h.tick();
    expect(h.percepts(h.a2, "presence").filter((p) => p.subject === "a1")).toHaveLength(1);
  });
});

describe("外头来的", () => {
  test("不看：那人不记（报 muted）；按样设的盖过整路；只记着：记了不递", () => {
    const h = setup();
    setSenses(h.a1, { senses: { weather: "不看" }, why: "x" });
    setSenses(h.a2, { senses: { phone: "只记着", "phone:battery": "看" }, why: "x" });
    expect(recordPercept(h.residents, { sensor: "weather", value: 1, text: "下雨" }, h.clock.t)).toEqual({ written: ["a2"], unchanged: [], muted: ["a1"] });
    recordPercept(h.residents, { sensor: "phone", subject: "app", value: "微信", text: "Joy 手机上开着微信", to: ["a2"] }, h.clock.t);
    recordPercept(h.residents, { sensor: "phone", subject: "battery", value: 20, text: "Joy 手机电量 20%", to: ["a2"] }, h.clock.t);
    const text = deliverOutside(h.a2, "s")!;
    expect(text).toContain("下雨");
    expect(text).toContain("电量 20%");
    expect(text).not.toContain("微信");
    expect(h.percepts(h.a2, "phone")).toHaveLength(2);
  });
});

describe("全屋的东西、内感受、声音", () => {
  test("files 不看：不记；只记着：记了，<now> 不递", async () => {
    const h = setup();
    const dir = mkdtempSync(join(tmpdir(), "senses-"));
    const places = [{ label: "commons", dir }];
    const state = { snaps: {} as Record<string, never> };
    filesTick(h.residents, places, state, h.clock.t);
    setSenses(h.a1, { senses: { files: "不看" }, why: "x" });
    setSenses(h.a2, { senses: { files: "只记着" }, why: "x" });
    writeFileSync(join(dir, "纸条.md"), "hi");
    filesTick(h.residents, places, state, h.clock.t);
    expect(h.percepts(h.a1, "files")).toHaveLength(0);
    expect(h.percepts(h.a2, "files")).toHaveLength(1);
    const app = createApp({ store: h.a2, projections: new Projections(h.a2) });
    const now = (await (await app.request("/v1/now?session=s&ctx=95000&wrapAt=100000")).json()) as { text: string };
    expect(now.text).not.toContain("全屋的东西");
    expect(now.text).toContain("上下文快到头了");
    setSenses(h.a2, { senses: { files: "只记着", body: "不看" }, why: "x" });
    h.clock.t += MIN;
    const again = (await (await app.request("/v1/now?session=s2&ctx=95000&wrapAt=100000")).json()) as { text: string };
    expect(again.text).not.toContain("上下文");
  });
});
