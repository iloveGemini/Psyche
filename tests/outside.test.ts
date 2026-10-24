/**
 * 外头来的事实的确定性考卷（m8.md §6.3）：全屋的口子收、只记变化、按 to 分发、全屋自己的几路不收、递成一行行。
 */
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "../src/store/events.ts";
import { Projections } from "../src/store/projections.ts";
import { experienceProjector, readExperience } from "../src/archive/experience.ts";
import { openHouse } from "../src/house/house.ts";
import { deliverOutside } from "../src/perception/outside.ts";

function setup() {
  const clock = { t: Date.parse("2026-10-23T21:00:00+08:00") };
  const mk = () => {
    const store = new EventStore(":memory:", { now: () => clock.t });
    const p = new Projections(store);
    p.register(experienceProjector);
    p.live();
    return store;
  };
  const a1 = mk();
  const a2 = mk();
  const house = openHouse(mkdtempSync(join(tmpdir(), "outside-")), [
    { id: "a1", store: a1 },
    { id: "a2", store: a2 },
  ] as never, () => clock.t);
  const post = async (body: unknown) => {
    const res = await house.handle(new Request("http://x/v1/house/percept", { method: "POST", body: JSON.stringify(body) }));
    return { status: res.status, json: (await res.json()) as any };
  };
  const percepts = (s: EventStore) => s.list({ kinds: ["percept"], fonds: "", limit: 100 }).map((e) => e.payload as any);
  return { clock, a1, a2, house, post, percepts };
}

test("收：缺省记进全屋；读数没变不记；to 只记给点名的", async () => {
  const h = setup();
  const r1 = await h.post({ sensor: "weather", value: { sky: "rain", c: 14 }, text: "下小雨，14°C" });
  expect(r1).toEqual({ status: 200, json: { written: ["a1", "a2"], unchanged: [] } });
  expect(h.percepts(h.a1)).toEqual([{ sensor: "weather", subject: "weather", value: { sky: "rain", c: 14 }, text: "下小雨，14°C" }]);

  expect((await h.post({ sensor: "weather", value: { sky: "rain", c: 14 }, text: "还在下小雨" })).json).toEqual({ written: [], unchanged: ["a1", "a2"] });
  expect((await h.post({ sensor: "weather", value: { sky: "clear", c: 12 }, text: "雨停了，12°C", to: ["a2"] })).json).toEqual({ written: ["a2"], unchanged: [] });
  expect(h.percepts(h.a1)).toHaveLength(1);
  expect(h.percepts(h.a2)).toHaveLength(2);
});

test("收：全屋自己的几路、坏字段、全屋没有的人都退回", async () => {
  const h = setup();
  for (const body of [
    { sensor: "presence", value: 1, text: "x" },
    { sensor: "files", value: 1, text: "x" },
    { sensor: "Weather", value: 1, text: "x" },
    { sensor: "weather", text: "x" },
    { sensor: "weather", value: 1, text: " " },
    { sensor: "weather", value: 1, text: "长".repeat(201) },
    { sensor: "weather", value: 1, text: "x", to: ["a9"] },
    { sensor: "weather", value: 1, text: "x", to: [] },
  ]) {
    const r = await h.post(body);
    expect(r.status).toBe(400);
  }
  expect(h.percepts(h.a1)).toEqual([]);
});

test("递：同一样压成一行；递过不重递；新会话接着上次；递到的不进经历", async () => {
  const h = setup();
  expect(deliverOutside(h.a1, "s1")).toBeNull();
  await h.post({ sensor: "weather", value: "rain", text: "下小雨，14°C" });
  h.clock.t += 60_000;
  await h.post({ sensor: "weather", value: "clear", text: "雨停了，12°C" });
  await h.post({ sensor: "window", subject: "east", value: "open", text: "东边的窗开着" });
  const text = deliverOutside(h.a1, "s1")!;
  expect(text.split("\n")).toEqual(["这段时间感知到的：", "- 雨停了，12°C（这段时间变了 2 次，21:01）", "- 东边的窗开着（21:01）"]);
  expect(deliverOutside(h.a1, "s1")).toBeNull();
  expect(deliverOutside(h.a1, "s2")).toBeNull();

  await h.post({ sensor: "window", subject: "east", value: "closed", text: "东边的窗关上了" });
  h.clock.t = Date.parse("2026-10-24T08:00:00+08:00");
  expect(deliverOutside(h.a1, "s3")).toBe("这段时间感知到的：\n- 东边的窗关上了（10-23 21:01）");

  const lines = readExperience(h.a1.db, {}).map((l) => l.text);
  expect(lines.some((l) => l.includes("雨停了") || l.includes("下小雨"))).toBe(false);
  expect(h.a1.readSyslog({ kind: "percept.delivered" }).map((l) => (l.detail as { text: string }).text)).toContain(text);
});

test("递：从没递过只报最近 6 小时的；全屋自己的感知不混进来", async () => {
  const h = setup();
  await h.post({ sensor: "weather", value: "rain", text: "下小雨" });
  h.a1.append({ kind: "percept", class: "experience", source: "house", situation: null, payload: { sensor: "presence", subject: "a2", value: "online" } });
  h.clock.t += 7 * 3_600_000;
  expect(deliverOutside(h.a1, "s1")).toBeNull();
  await h.post({ sensor: "weather", value: "clear", text: "晴" });
  expect(deliverOutside(h.a1, "s1")).toBe("这段时间感知到的：\n- 晴（04:00）");
});

test("Joy 那边（joy.mac）：她给谁开放了才记给谁；GET /v1/house/mac 报每人的开放", async () => {
  const h = setup();
  const { setSettings } = await import("../src/heartbeat/schedule.ts");
  setSettings(h.a2, { mac: { app: true } });
  const r = await h.post({ sensor: "joy.mac", subject: "app", value: "微信", text: "Joy 前台在用 微信" });
  expect(r.json).toEqual({ written: ["a2"], unchanged: [], ungranted: ["a1"] });
  expect((await h.post({ sensor: "joy.mac", subject: "desk", value: "active", text: "Joy 在用电脑" })).json).toEqual({ written: [], unchanged: [], ungranted: ["a1", "a2"] });
  expect(() => setSettings(h.a2, { mac: { screens: true } })).toThrow();
  expect(() => setSettings(h.a2, { mac: { desk: "yes" } })).toThrow();
  const res = await h.house.handle(new Request("http://x/v1/house/mac"));
  expect(await res.json()).toEqual({ grants: { a1: { desk: false, app: false, screen: false }, a2: { desk: false, app: true, screen: false } } });
});
