/**
 * 内感受的确定性考卷（m8.md §六.1）：上下文、额度跨档才报（moment 的状态闸，10-27）、换模型首轮说、工具老出错才说；递到的不进经历。
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

test("上下文：有收尾线按 25 / 50 / 75 / 90% 跨档才报；没收尾线（工位）每 5 万 token 一档；新一段首轮全报", async () => {
  const { store, p } = setup();
  store.setSituation({ harness: "soma", session: "s1" }, "soma");
  const app = createApp({ store, projections: p });
  const now = async (s: string, q: string) => ((await (await app.request(`/v1/now?session=${s}${q}`)).json()) as { text: string }).text;
  expect(await now("s1", "&ctx=20000&wrapAt=150000")).toContain("上下文：约 20k，到收尾线的 13%");
  expect(await now("s1", "&ctx=30000&wrapAt=150000")).not.toContain("上下文");
  expect(await now("s1", "&ctx=80000&wrapAt=150000")).toContain("上下文：约 80k，到收尾线的 53%");
  expect(await now("s1", "&ctx=140000&wrapAt=150000")).toContain("到收尾线的 93%——再过几轮就会收尾");
  store.setSituation({ harness: "soma", session: "s2" }, "soma");
  expect(await now("s2", "&ctx=10000&wrapAt=150000")).toContain("上下文：约 10k");
  // 工位：没有收尾线
  store.setSituation({ harness: "claude-code", session: "s3" }, "claude-code");
  expect(await now("s3", "&ctx=82000")).toContain("上下文：已用约 82k token");
  expect(await now("s3", "&ctx=95000")).not.toContain("上下文");
  expect(await now("s3", "&ctx=101000")).toContain("上下文：已用约 101k token");
  // 没带 ctx 不报
  expect(await now("s3", "")).not.toContain("上下文");
});

test("换了模型：新一段首轮说一次", () => {
  const { store } = setup();
  store.setSituation({ harness: "soma", session: "s1", model: "claude-opus-5-5" }, "soma");
  store.setSituation({ harness: "soma", session: "s2", model: "claude-sonnet-5-5" }, "soma");
  expect(deliverBody(store, "s2")).toBe("身上：\n- 这一段用的是 claude-sonnet-5-5，上一段是 claude-opus-5-5");
  expect(deliverBody(store, "s2")).toBeNull();
});

test("工具老出错：半小时内 ≥3 次才说，次数跨档再说；递到的不进经历", async () => {
  const { store, clock, p } = setup();
  store.setSituation({ harness: "soma", session: "s1" }, "soma");
  const fail = () => intake(store, { kind: "tool.result", source: "soma", payload: { callId: String(Math.random()), name: "Bash", ok: false, text: "boom" } });
  fail();
  fail();
  expect(deliverBody(store, "s1")).toBeNull();
  fail();
  expect(deliverBody(store, "s1")).toBe("身上：\n- 最近半小时工具出错了 3 次");
  fail();
  expect(deliverBody(store, "s1")).toBeNull();
  clock.t += 31 * 60_000;
  expect(deliverBody(store, "s1")).toBeNull(); // 回落：记档位，不递话
  expect(readExperience(store.db, {}).map((l) => l.text).filter((t) => t.startsWith("身上"))).toEqual([]);
  expect(store.readSyslog({ kind: "percept.delivered" }).map((l) => (l.detail as { text: string }).text)).toEqual(["", "身上：\n- 最近半小时工具出错了 3 次"]);
  void p;
});

test("房间里被静音：Soma 带来的房间名报成一行，没有就不报（soma2.md §5.7）", async () => {
  const { store, p } = setup();
  store.setSituation({ harness: "soma", session: "s1" }, "soma");
  const app = createApp({ store, projections: p });
  const now = async (q: string) => ((await (await app.request(`/v1/now?session=s1${q}`)).json()) as { text: string }).text;
  expect(await now(`&muted=${encodeURIComponent(JSON.stringify(["S3 测试"]))}`)).toContain("房间：你在《S3 测试》被静音了");
  expect(await now("")).toContain("房间：哪里都没被静音了");
  expect(await now("")).not.toContain("静音");
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

test("订阅额度：跨 50 / 75 / 90% 或换了窗口才重报；新一段首轮全报；没带就没有", async () => {
  const { store, p } = setup();
  store.setSituation({ harness: "soma", session: "s1" }, "soma");
  const app = createApp({ store, projections: p });
  const now = async (s: string, q: string) => ((await (await app.request(`/v1/now?session=${s}${q}`)).json()) as { text: string }).text;
  const w = (pct: number, reset = "2026-10-16T15:00:00Z") => `&q5h=${pct}&q5hReset=${reset}&q7d=61`;
  expect(await now("s1", w(32.4))).toContain("订阅额度（全屋共用）：5 小时窗口 32%，10-16 23:00 重置 · 本周 61%");
  expect(await now("s1", w(45))).not.toContain("订阅额度");
  expect(await now("s1", w(62))).toContain("5 小时窗口 62%");
  expect(await now("s1", w(10, "2026-10-16T20:00:00Z"))).toContain("5 小时窗口 10%");
  store.setSituation({ harness: "soma", session: "s2" }, "soma");
  expect(await now("s2", w(10, "2026-10-16T20:00:00Z"))).toContain("订阅额度");
  expect(await now("s2", "")).not.toContain("订阅额度");
});
