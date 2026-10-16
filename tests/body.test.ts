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

test("工具老出错：半小时内 ≥3 次才说，次数跨档再说；经历里就是那几行", async () => {
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
  expect(readExperience(store.db, {}).map((l) => l.text).filter((t) => t.startsWith("身上"))).toEqual(["身上：\n- 最近半小时工具出错了 3 次"]);
  // /v1/now 带 ctx 时出现在 <now> 里
  const app = createApp({ store, projections: p });
  const { text } = (await (await app.request("/v1/now?session=s1&ctx=120000&wrapAt=150000")).json()) as { text: string };
  expect(text).toContain("身上：\n- 这一段的上下文用了收尾线的 80%，快满了");
});
