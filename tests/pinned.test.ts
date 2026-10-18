import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "../src/store/events.ts";
import { Projections } from "../src/store/projections.ts";
import { intake } from "../src/archive/intake.ts";
import { experienceProjector } from "../src/archive/experience.ts";
import { shelfProjector } from "../src/reading/shelf.ts";
import { renderContinuity } from "../src/archive/continuity.ts";
import { PIN_BUDGET, pinnedRoots } from "../src/self/pinned.ts";
import { readSegment } from "../src/catalog/hotwrite.ts";
import { createApp } from "../src/server/app.ts";

const T = (s: string) => Date.parse(`${s}+08:00`);
const JSON_H = { "content-type": "application/json" };

function setup() {
  let now = T("2026-10-18T10:00:00");
  const store = new EventStore(":memory:", { now: () => now });
  const projections = new Projections(store);
  projections.register(experienceProjector);
  projections.register(shelfProjector);
  projections.live();
  const dir = mkdtempSync(join(tmpdir(), "psyche-prompts-"));
  writeFileSync(join(dir, "hot-write.md"), "---\nversion: 1\nauthor: system\n---\n\n写成情节。\n");
  writeFileSync(join(dir, "cold-write.md"), "---\nversion: 1\nauthor: system\n---\n\n整理。\n");
  const app = createApp({ store, projections, promptsDir: dir });
  const post = async (path: string, body: unknown) => app.request(path, { method: "POST", headers: JSON_H, body: JSON.stringify(body) });
  const ok = async (path: string, body: unknown) => {
    const r = await post(path, body);
    const j = await r.json();
    if (r.status !== 200) throw new Error(j.error);
    return j;
  };
  const say = (text: string) => {
    now += 60_000;
    return intake(store, { kind: "message.in", source: "soma", payload: { from: "Joy", text }, at: now });
  };
  /** 书架上一条事实 */
  const fact = async (text: string) => {
    const ev = say(text);
    const cold = await (await app.request("/v1/coldwrite")).json();
    const r = await ok("/v1/coldwrite", { upTo: cold.upTo, entries: [{ op: "propose", shelf: "fact", text, cites: [ev.archiveNo] }] });
    return r.written[0].archiveNo as string;
  };
  /** 写一段情节，顺手 pin / unpin */
  const hot = async (extra: Record<string, unknown>) => {
    const ev = say("随便聊聊");
    const seg = readSegment(store, "S1");
    return post("/v1/hotwrite", { session: "S1", upTo: seg.upTo, entries: [{ text: "聊了聊", cites: [ev.archiveNo] }], ...extra });
  };
  store.setSituation({ harness: "soma", session: "S1" }, "soma", now);
  return { store, app, fact, hot, ok, say };
}

test("常驻区：跟 hotwrite 一起钉，进 <continuity>，钉的是条目（改写跟到新版、作废就没了）", async () => {
  const h = setup();
  const a = await h.fact("Joy 的猫叫年糕");
  const b = await h.fact("Joy 周末不工作");
  expect((await h.hot({ pin: [a, b] })).status).toBe(200);
  let c = renderContinuity(h.store)!;
  expect(c).toContain("【常驻】");
  expect(c).toContain("年糕");
  expect(c).toContain("周末不工作");
  // 钉的调整不算没写的经历
  expect(readSegment(h.store, "S1").lines).toHaveLength(0);
  // 书架上看得到哪些钉着；hotwrite_segment 报用量
  const shelf = await (await h.app.request("/v1/shelf")).json();
  expect(shelf.entries.filter((e: any) => e.pinned).length).toBe(2);
  // 改写：跟到最新版
  const ev = h.say("年糕是橘猫，周末我有时也工作");
  const cold = await (await h.app.request("/v1/coldwrite")).json();
  await h.ok("/v1/coldwrite", { upTo: cold.upTo, entries: [{ op: "revise", target: a, text: "Joy 的猫叫年糕，橘猫", why: "她补了一句", cites: [ev.archiveNo] }, { op: "retire", target: b, why: "她改了", cites: [ev.archiveNo] }] });
  c = renderContinuity(h.store)!;
  expect(c).toContain("橘猫");
  expect(c).not.toContain("周末不工作");
  // 撤下
  expect((await h.hot({ unpin: [a] })).status).toBe(200);
  expect(pinnedRoots(h.store).length).toBe(1); // b 还在名单上，但作废了不显示
  expect(renderContinuity(h.store) ?? "").not.toContain("【常驻】");
});

test("常驻区：超额整批拒（情节也不写）；不是书架条目拒；上报口不收", async () => {
  const h = setup();
  const big = await h.fact("长".repeat(PIN_BUDGET));
  const r = await h.hot({ pin: [big] });
  expect(r.status).toBe(400);
  expect((await r.json()).error).toContain(`/ ${PIN_BUDGET} 字`);
  expect(h.store.db.query(`SELECT COUNT(*) AS n FROM events WHERE kind = 'episode'`).get()).toEqual({ n: 0 });
  const r2 = await h.hot({ pin: ["10-18#1"] });
  expect((await r2.json()).error).toContain("不是书架条目");
  expect(() => intake(h.store, { kind: "pin.changed", source: "soma", payload: { pin: [], unpin: [] } })).toThrow("口子");
});
