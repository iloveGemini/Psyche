import { describe, expect, test } from "bun:test";
import { EventStore } from "../src/store/events.ts";
import { Projections } from "../src/store/projections.ts";
import { intake, INLINE_LIMIT } from "../src/archive/intake.ts";
import { experienceProjector, readExperience } from "../src/archive/experience.ts";
import { createApp } from "../src/server/app.ts";

const T = (s: string) => Date.parse(s);

function setup(now?: () => number) {
  const store = new EventStore(":memory:", { now });
  const projections = new Projections(store);
  projections.register(experienceProjector);
  projections.live();
  return { store, projections };
}

describe("入库口", () => {
  test("未登记的 kind、缺字段、类型不对、不该挂的关系，一律拒收", () => {
    const { store } = setup();
    expect(() => intake(store, { kind: "feeling", source: "x", payload: {} })).toThrow(/未登记/);
    expect(() => intake(store, { kind: "message.in", source: "roxy", payload: { text: "早" } })).toThrow(/缺字段 from/);
    expect(() => intake(store, { kind: "tool.result", source: "cc", payload: { callId: "1", name: "bash", ok: "yes" } })).toThrow(/boolean/);
    expect(() => intake(store, { kind: "diary", source: "agent", payload: { doc: { hash: "x" } }, links: [{ to: "y", rel: "annotates" }] })).toThrow(/不能挂/);
    expect(store.list()).toHaveLength(0);
  });

  test("class 由 kind 决定，调用方不用操心", () => {
    const { store } = setup();
    expect(intake(store, { kind: "named", source: "agent", payload: { name: "某某" } }).class).toBe("self");
    expect(intake(store, { kind: "woke", source: "psyche", payload: { by: "心跳" } }).class).toBe("experience");
  });

  test("大块工具返回进资料库，事件里只留哈希；原文完整可取", () => {
    const { store } = setup();
    const big = "x".repeat(INLINE_LIMIT + 1);
    const ev = intake(store, { kind: "tool.result", source: "cc", payload: { callId: "1", name: "bash", ok: true, text: big } });
    const p = ev.payload as { result: { hash: string }; size: number; text?: string };
    expect(p.text).toBeUndefined();
    expect(p.size).toBe(big.length);
    expect(store.getMaterial(p.result.hash)?.text()).toBe(big);
  });
});

describe("经历投影", () => {
  test("第一人称模板、按发生时间排、导入全宗不算它的经历", () => {
    const { store } = setup(() => T("2026-10-13T08:00:00+08:00"));
    store.setSituation({ harness: "roxy", model: "gemini-3.8-flash" });
    intake(store, { kind: "message.in", source: "roxy", payload: { from: "Joy", text: "早" }, at: T("2026-10-13T09:00:00+08:00") });
    intake(store, { kind: "message.out", source: "roxy", payload: { text: "早，睡得怎么样" }, at: T("2026-10-13T09:00:05+08:00") });
    // 晚到的感知：发生得更早
    intake(store, { kind: "percept", source: "phone", payload: { sensor: "屏幕", value: "解锁" }, at: T("2026-10-13T08:59:00+08:00") });
    store.append({ kind: "message.in", class: "experience", source: "import", fonds: "ROY", payload: { from: "Joy", text: "前世的话" } });
    const lines = readExperience(store.db).map((l) => l.text);
    expect(lines).toEqual(["（此后：在 roxy，用 gemini-3.8-flash）", "（感知 · 屏幕）解锁", "Joy：早", "我说：早，睡得怎么样"]);
  });

  test("提示词改动：角标指向资料，带上为什么", () => {
    const { store } = setup();
    const hash = store.putMaterial("别先道歉");
    intake(store, { kind: "prompt.changed", source: "agent", payload: { doc: { hash }, version: 3, why: "她说我太卑微" } });
    expect(readExperience(store.db)[0].text).toBe(`我改了自己的提示词（第 3 版）[^${hash.slice(0, 8)}]，因为她说我太卑微`);
  });

  test("重建后一字不差", () => {
    const { store, projections } = setup();
    intake(store, { kind: "message.in", source: "roxy", payload: { from: "Joy", text: "在吗" } });
    intake(store, { kind: "tool.call", source: "cc", payload: { name: "bash", callId: "1", args: { command: "ls" } } });
    const before = readExperience(store.db);
    projections.rebuild("experience");
    expect(readExperience(store.db)).toEqual(before);
  });
});

describe("REST", () => {
  const auth = { authorization: "Bearer t0ken", "content-type": "application/json" };

  test("要鉴权；批量上报在一个事务里，有一条坏的整批不入库", async () => {
    const { store, projections } = setup();
    const app = createApp({ store, projections, token: "t0ken" });
    expect((await app.request("/v1/events", { method: "POST", body: "{}" })).status).toBe(401);
    const bad = await app.request("/v1/events", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ items: [{ kind: "message.in", source: "roxy", payload: { from: "Joy", text: "一" } }, { kind: "nope", source: "roxy", payload: {} }] }),
    });
    expect(bad.status).toBe(400);
    expect(store.list()).toHaveLength(0);
  });

  test("上报 → 按档号取 → 取经历；重试不重复", async () => {
    const { store, projections } = setup();
    const app = createApp({ store, projections, token: "t0ken" });
    const item = { kind: "message.in", source: "roxy", idem: "m1", payload: { from: "Joy", text: "早" } };
    const r1 = await (await app.request("/v1/events", { method: "POST", headers: auth, body: JSON.stringify(item) })).json();
    const r2 = await (await app.request("/v1/events", { method: "POST", headers: auth, body: JSON.stringify(item) })).json();
    expect(r2.events[0].id).toBe(r1.events[0].id);
    const no = encodeURIComponent(r1.events[0].archiveNo);
    const got = await (await app.request(`/v1/archive/${no}`, { headers: auth })).json();
    expect(got.event.payload.text).toBe("早");
    const exp = await (await app.request("/v1/experience", { headers: auth })).json();
    expect(exp.lines.map((l: { text: string }) => l.text)).toEqual(["Joy：早"]);
  });

  test("处境只在变化时写", async () => {
    const { store, projections } = setup();
    const app = createApp({ store, projections });
    const post = async (b: object) => (await app.request("/v1/situation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) })).json();
    const a = await post({ harness: "claude-code", model: "opus" });
    const b = await post({ harness: "claude-code", model: "opus" });
    expect(b.id).toBe(a.id);
    expect(store.list({ classes: ["situation"] })).toHaveLength(1);
  });

  test("资料存取", async () => {
    const { store, projections } = setup();
    const app = createApp({ store, projections });
    const { hash } = await (await app.request("/v1/materials", { method: "POST", headers: { "content-type": "text/markdown" }, body: "# 日记" })).json();
    const res = await app.request(`/v1/materials/${hash}`);
    expect(res.headers.get("content-type")).toBe("text/markdown");
    expect(await res.text()).toBe("# 日记");
  });
});
