import { describe, expect, test } from "bun:test";
import { EventStore } from "../src/store/events.ts";
import { Projections } from "../src/store/projections.ts";
import { intake } from "../src/archive/intake.ts";
import { runScenes, sceneOf, scenesProjector } from "../src/catalog/scenes.ts";

const T = (s: string) => Date.parse(s);
const say = (store: EventStore, text: string, at: string) =>
  intake(store, { kind: "message.in", source: "roxy", payload: { from: "Joy", text }, at: T(`2026-10-13T${at}:00+08:00`) });

function setup() {
  const store = new EventStore(":memory:", { now: () => T("2026-10-13T08:00:00+08:00") });
  const projections = new Projections(store);
  projections.register(scenesProjector);
  projections.live();
  return { store, projections };
}

describe("① 分场", () => {
  test("间隔 ≥ 30 分钟另起一场，换地方另起一场", () => {
    const { store } = setup();
    store.setSituation({ harness: "roxy" });
    const a = say(store, "早", "09:00");
    const b = say(store, "吃了吗", "09:10");
    const c = say(store, "我回来了", "11:00");
    store.setSituation({ harness: "claude-code" });
    const d = intake(store, { kind: "tool.call", source: "cc", payload: { name: "bash", callId: "1" }, at: T("2026-10-13T11:05:00+08:00") });
    const scenes = runScenes(store);
    expect(scenes.map((s) => (s.payload as { reason: string }).reason)).toEqual(["start", "gap", "moved"]);
    expect(scenes.map((s) => (s.payload as { count: number }).count)).toEqual([2, 1, 1]);
    expect(sceneOf(store.db, a.id)?.id).toBe(scenes[0].id);
    expect(sceneOf(store.db, b.id)?.id).toBe(scenes[0].id);
    expect(sceneOf(store.db, c.id)?.id).toBe(scenes[1].id);
    expect(sceneOf(store.db, d.id)?.id).toBe(scenes[2].id);
    expect(scenes.every((s) => s.class === "dream" && s.producer?.startsWith("catalog/scenes"))).toBe(true);
  });

  test("游标：只切新来的；没有新经历就什么都不产出", () => {
    const { store } = setup();
    say(store, "一", "09:00");
    expect(runScenes(store)).toHaveLength(1);
    expect(runScenes(store)).toHaveLength(0);
    say(store, "二", "12:00");
    const next = runScenes(store);
    expect(next).toHaveLength(1);
    expect((next[0].payload as { count: number }).count).toBe(1);
  });

  test("导入的全宗、处境、梦本身都不进场", () => {
    const { store } = setup();
    store.setSituation({ harness: "roxy" });
    store.append({ kind: "message.in", class: "experience", source: "import", fonds: "ROY", payload: { from: "Joy", text: "前世" } });
    say(store, "今生", "09:00");
    const [scene] = runScenes(store);
    expect((scene.payload as { count: number }).count).toBe(1);
    expect(runScenes(store)).toHaveLength(0); // 自己产出的 scene 不会被下一轮再切
  });

  test("晚到的事件按发生时间归场", () => {
    const { store } = setup();
    say(store, "一", "09:00");
    say(store, "三", "09:20");
    const late = intake(store, { kind: "percept", source: "phone", payload: { sensor: "屏幕", value: "解锁" }, at: T("2026-10-13T09:10:00+08:00") });
    const scenes = runScenes(store);
    expect(scenes).toHaveLength(1);
    expect(sceneOf(store.db, late.id)?.id).toBe(scenes[0].id);
  });

  test("场次投影重建后不变", () => {
    const { store, projections } = setup();
    const a = say(store, "一", "09:00");
    say(store, "二", "12:00");
    runScenes(store);
    const before = sceneOf(store.db, a.id);
    projections.rebuild("scenes");
    expect(sceneOf(store.db, a.id)).toEqual(before);
  });
});
