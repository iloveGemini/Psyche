/**
 * 内感受的确定性考卷（m8.md §六.1）：上下文跨档才说、换模型首轮说、工具老出错才说；经历里就是递出去的那几行。
 */
import { expect, test } from "bun:test";
import { EventStore } from "../src/store/events.ts";
import { Projections } from "../src/store/projections.ts";
import { intake } from "../src/archive/intake.ts";
import { experienceProjector, readExperience } from "../src/archive/experience.ts";
import { createApp } from "../src/server/app.ts";
import { deliverBody } from "../src/perception/body.ts";

function setup() {
  const clock = { t: Date.parse("2026-10-16T20:00:00+08:00") };
  const store = new EventStore(":memory:", { now: () => clock.t });
  const p = new Projections(store);
  p.register(experienceProjector);
  p.live();
  return { clock, store, p };
}

test("上下文：过半 / 快满 / 马上收尾，跨档才说；回落后再涨过去再说", () => {
  const { store } = setup();
  store.setSituation({ harness: "soma", session: "s1" }, "soma");
  expect(deliverBody(store, "s1", { ctx: 40_000, wrapAt: 150_000 })).toBeNull();
  expect(deliverBody(store, "s1", { ctx: 80_000, wrapAt: 150_000 })).toBe("身上：\n- 这一段的上下文过半了（收尾线的 53%）");
  expect(deliverBody(store, "s1", { ctx: 90_000, wrapAt: 150_000 })).toBeNull();
  expect(deliverBody(store, "s1", { ctx: 140_000, wrapAt: 150_000 })).toContain("快到头了（到收尾线的 93%）");
  // 换了一段（新会话）重新算
  store.setSituation({ harness: "soma", session: "s2" }, "soma");
  expect(deliverBody(store, "s2", { ctx: 10_000, wrapAt: 150_000 })).toBeNull();
  expect(deliverBody(store, "s2", { ctx: 80_000, wrapAt: 150_000 })).toContain("过半");
  // 没带 ctx（不是 Soma 来的）不说
  expect(deliverBody(store, "s2", {})).toBeNull();
});

test("换了模型：新一段首轮说一次", () => {
  const { store } = setup();
  store.setSituation({ harness: "soma", session: "s1", model: "claude-opus-5-5" }, "soma");
  store.setSituation({ harness: "soma", session: "s2", model: "claude-sonnet-5-5" }, "soma");
  expect(deliverBody(store, "s2", {})).toBe("身上：\n- 这一段用的是 claude-sonnet-5-5，上一段是 claude-opus-5-5");
  expect(deliverBody(store, "s2", {})).toBeNull();
});

test("工具老出错：半小时内 ≥3 次才说，次数跨档再说；递到的不进经历", async () => {
  const { store, clock, p } = setup();
  store.setSituation({ harness: "soma", session: "s1" }, "soma");
  const fail = () => intake(store, { kind: "tool.result", source: "soma", payload: { callId: String(Math.random()), name: "Bash", ok: false, text: "boom" } });
  fail();
  fail();
  expect(deliverBody(store, "s1", {})).toBeNull();
  fail();
  expect(deliverBody(store, "s1", {})).toBe("身上：\n- 最近半小时工具出错了 3 次");
  fail();
  expect(deliverBody(store, "s1", {})).toBeNull();
  clock.t += 31 * 60_000;
  expect(deliverBody(store, "s1", {})).toBeNull(); // 回落：记档位，不递话
  expect(readExperience(store.db, {}).map((l) => l.text).filter((t) => t.startsWith("身上"))).toEqual([]);
  expect(store.readSyslog({ kind: "percept.delivered" }).map((l) => (l.detail as { text: string }).text)).toEqual(["", "身上：\n- 最近半小时工具出错了 3 次"]);
  // /v1/now 带 ctx 时出现在 <now> 里
  const app = createApp({ store, projections: p });
  const { text } = (await (await app.request("/v1/now?session=s1&ctx=120000&wrapAt=150000")).json()) as { text: string };
  expect(text).toContain("身上：\n- 这一段的上下文用了收尾线的 80%，快满了");
});

test("房间里被静音：Soma 带来的房间名报成一行，没有就不报（soma2.md §5.7）", async () => {
  const { store, p } = setup();
  store.setSituation({ harness: "soma", session: "s1" }, "soma");
  const app = createApp({ store, projections: p });
  const now = async (q: string) => ((await (await app.request(`/v1/now?session=s1${q}`)).json()) as { text: string }).text;
  expect(await now(`&muted=${encodeURIComponent(JSON.stringify(["S3 测试"]))}`)).toContain("房间：你在《S3 测试》被静音了");
  expect(await now("")).not.toContain("被静音");
  expect(await now("&muted=oops")).not.toContain("被静音");
});

test("房间（P3）：在哪间、谁也在、几条没读；在自己房间也说一声；看不懂不报", async () => {
  const { store, p } = setup();
  store.setSituation({ harness: "soma", session: "s1" }, "soma");
  const app = createApp({ store, projections: p });
  const now = async (q: string) => ((await (await app.request(`/v1/now?session=s1${q}`)).json()) as { text: string }).text;
  const room = (r: unknown) => `&room=${encodeURIComponent(JSON.stringify(r))}`;
  expect(await now(room({ in: "客厅", with: ["a1", "Argon"], unread: 3 }))).toContain("房间：你在《客厅》，a1、Argon 也在；有 3 条没读（rooms 的 read 看）");
  expect(await now(room({ in: "客厅", with: [], unread: 0 }))).toContain("房间：你在《客厅》，就你一个\n");
  expect(await now(room({ in: null }))).toContain("房间：你在自己房间");
  expect(await now("&room=oops")).not.toContain("房间：");
  expect(await now("")).not.toContain("房间：");
});

test("订阅额度：跨档才说，跟窗口走、换一段不重报，窗口重置后从头算", () => {
  const { store } = setup();
  store.setSituation({ harness: "soma", session: "s1" }, "soma");
  const w = (pct: number, resetsAt = "2026-10-16T14:00:00Z") => ({ quota: { fiveHour: { pct, resetsAt } } });
  expect(deliverBody(store, "s1", w(30))).toBeNull();
  expect(deliverBody(store, "s1", w(62))).toBe("身上：\n- 订阅额度（全屋用同一个登录的共用）：5 小时窗口用了 62%，10-16 22:00 重置");
  expect(deliverBody(store, "s1", w(70))).toBeNull();
  // 换了一段：同一个窗口说过的不再说
  store.setSituation({ harness: "soma", session: "s2" }, "soma");
  expect(deliverBody(store, "s2", w(70))).toBeNull();
  expect(deliverBody(store, "s2", w(91))).toContain("用了 91%");
  // 窗口重置了：从头算
  expect(deliverBody(store, "s2", w(10, "2026-10-16T19:00:00Z"))).toBeNull();
  expect(deliverBody(store, "s2", w(55, "2026-10-16T19:00:00Z"))).toContain("用了 55%");
  // 本周的另算
  expect(deliverBody(store, "s2", { quota: { sevenDay: { pct: 80, resetsAt: "2026-10-20T00:00:00Z" } } })).toContain("本周用了 80%，10-20 08:00 重置");
});

test("订阅额度常显（10-24）：Soma 带来了就每轮一行此刻的数；没带（不走订阅的身体）就没有", async () => {
  const { store, p } = setup();
  store.setSituation({ harness: "soma", session: "s1" }, "soma");
  const app = createApp({ store, projections: p });
  const now = async (q: string) => ((await (await app.request(`/v1/now?session=s1${q}`)).json()) as { text: string }).text;
  const q = "&q5h=32.4&q5hReset=2026-10-16T15:00:00Z&q7d=61";
  expect(await now(q)).toContain("订阅额度（全屋共用）：5 小时窗口 32%，10-16 23:00 重置 · 本周 61%");
  expect(await now(q)).toContain("订阅额度（全屋共用）：5 小时窗口 32%");
  expect(await now("")).not.toContain("订阅额度");
});
