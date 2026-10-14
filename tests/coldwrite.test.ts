import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore, type PsycheEvent } from "../src/store/events.ts";
import { Projections } from "../src/store/projections.ts";
import { intake } from "../src/archive/intake.ts";
import { experienceProjector } from "../src/archive/experience.ts";
import { shelfProjector } from "../src/reading/shelf.ts";
import { coldCursor } from "../src/catalog/coldwrite.ts";
import { createApp } from "../src/server/app.ts";

const T = (s: string) => Date.parse(`${s}+08:00`);
const JSON_H = { "content-type": "application/json" };

function setup() {
  const store = new EventStore(":memory:", { now: () => T("2026-10-14T03:00:00") });
  const projections = new Projections(store);
  projections.register(experienceProjector);
  projections.register(shelfProjector);
  projections.live();
  const dir = mkdtempSync(join(tmpdir(), "psyche-prompts-"));
  writeFileSync(join(dir, "cold-write.md"), "---\nversion: 2\nauthor: system\n---\n\n睡前整理。\n");
  const app = createApp({ store, projections, promptsDir: dir });
  const session = (id: string, at: string) => store.setSituation({ harness: "soma", session: id }, "soma", T(at));
  const her = (text: string, at: string) => intake(store, { kind: "message.in", source: "soma", payload: { from: "阿禾", text }, at: T(at) });
  const me = (text: string, at: string) => intake(store, { kind: "message.out", source: "soma", payload: { text }, at: T(at) });
  const get = async () => (await app.request("/v1/coldwrite")).json();
  const post = (body: unknown) => app.request("/v1/coldwrite", { method: "POST", headers: JSON_H, body: JSON.stringify(body) });
  const no = (ev: PsycheEvent) => ev.archiveNo.replace(/^2026-/, "");
  return { store, app, session, her, me, get, post, no };
}

/** 两个会话：白天单字 + 追问 → 不耐烦，各一次；第一次里有明说的规矩 */
function twoDays(t: ReturnType<typeof setup>) {
  t.session("d1", "2026-10-05T14:00:00");
  const a1 = t.her("嗯", "2026-10-05T15:10:00");
  t.me("要不要我两个都列一下？", "2026-10-05T15:10:30");
  const a2 = t.her("你别追着问了", "2026-10-05T15:11:00");
  const told = t.her("我回一个字的时候你别追着问，等我自己说", "2026-10-05T15:12:00");
  t.session("d2", "2026-10-07T14:00:00");
  const b1 = t.her("哦", "2026-10-07T14:30:00");
  t.me("你要不要先查一下？", "2026-10-07T14:30:30");
  const b2 = t.her("烦 说了别追着问", "2026-10-07T14:31:00");
  return { a1, a2, told, b1, b2 };
}

const rule = (cites: string[]) => ({
  op: "propose",
  shelf: "rule",
  text: "她回一个字时我追问，她会不耐烦",
  when: "她回单字，我接着追问",
  then: "她不耐烦",
  observe: "她随后明说别问了、语气变冲",
  watch: ["别追着问", "烦"],
  cites,
});

describe("材料与游标", () => {
  test("按会话分组，给游标之后的经历和 upTo；书架空", async () => {
    const t = setup();
    const e = twoDays(t);
    const m = await t.get();
    expect(m.upTo).toBe(e.b2.id);
    expect(m.since).toBe("");
    expect(m.promptVersion).toBe(2);
    expect(m.material.map((g: any) => g.session)).toEqual(["d1", "d2"]);
    expect(m.material[0].lines[0]).toMatchObject({ archiveNo: t.no(e.a1), text: "阿禾：嗯" });
    expect(m.shelf).toEqual([]);
  });

  test("空 entries 合法：游标前移，下次没有新材料", async () => {
    const t = setup();
    const e = twoDays(t);
    expect((await t.post({ upTo: e.b2.id, entries: [] })).status).toBe(200);
    expect(coldCursor(t.store)).toBe(e.b2.id);
    expect((await t.get()).upTo).toBeNull();
  });
});

describe("系统闸", () => {
  test("规律：证据来自同一个会话 → 拒；两个会话 → 收，计印证 2", async () => {
    const t = setup();
    const e = twoDays(t);
    const r1 = await t.post({ upTo: e.b2.id, entries: [rule([t.no(e.a1), t.no(e.a2)])] });
    expect(r1.status).toBe(400);
    expect((await r1.json()).error).toContain("2 个不同的会话");
    const r2 = await t.post({ upTo: e.b2.id, entries: [rule([t.no(e.a2), t.no(e.b2)])] });
    expect(r2.status).toBe(200);
    const { entries } = await (await t.app.request("/v1/shelf")).json();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ shelf: "rule", for: 2, against: 0, when: "她回单字，我接着追问" });
  });

  test("规律缺观察方式 → 拒", async () => {
    const t = setup();
    const e = twoDays(t);
    const { observe, ...bad } = rule([t.no(e.a2), t.no(e.b2)]);
    expect((await t.post({ upTo: e.b2.id, entries: [bad] })).status).toBe(400);
  });

  test("明说的规矩：原话要逐字出现在所引的她的话里", async () => {
    const t = setup();
    const e = twoDays(t);
    const told = (quote: string) => ({ op: "propose", shelf: "told", text: "她说过回单字时别追问", quote, cites: [t.no(e.told)] });
    const bad = await t.post({ upTo: e.b2.id, entries: [told("回一个字时别追问我")] });
    expect((await bad.json()).error).toContain("找不到");
    expect((await t.post({ upTo: e.b2.id, entries: [told("我回一个字的时候你别追着问，等我自己说")] })).status).toBe(200);
  });

  test("不能引处境、书架条目或 upTo 之后的事", async () => {
    const t = setup();
    const e = twoDays(t);
    const sit = t.store.situation!;
    const r = await t.post({ upTo: e.a2.id, entries: [{ op: "propose", shelf: "fact", text: "x", cites: [t.no(sit)] }] });
    expect((await r.json()).error).toContain("不是你的经历");
    const r2 = await t.post({ upTo: e.a2.id, entries: [{ op: "propose", shelf: "fact", text: "x", cites: [t.no(e.b2)] }] });
    expect((await r2.json()).error).toContain("材料之后");
  });

  test("上报口不收书架条目", () => {
    const t = setup();
    expect(() => intake(t.store, { kind: "semantic.proposed", source: "agent", payload: { shelf: "fact", text: "x" } })).toThrow("冷写");
  });
});

describe("第二次睡：候选、判断、改写、作废", () => {
  async function slept(t: ReturnType<typeof setup>) {
    const e = twoDays(t);
    await t.post({ upTo: e.b2.id, entries: [rule([t.no(e.a2), t.no(e.b2)]), { op: "propose", shelf: "fact", text: "周五演示", cites: [t.no(e.a1)] }] });
    const shelf = (await (await t.app.request("/v1/shelf")).json()).entries;
    return { e, ruleNo: shelf.find((x: any) => x.shelf === "rule").archiveNo, factNo: shelf.find((x: any) => x.shelf === "fact").archiveNo };
  }

  test("watch 词命中的新行摆成候选；没判的记进 coldwrite.done", async () => {
    const t = setup();
    const { ruleNo } = await slept(t);
    t.session("d3", "2026-10-09T15:00:00");
    const c1 = t.her("你能不能让我安静一会儿 烦", "2026-10-09T16:01:00");
    const c2 = t.her("说了别追着问", "2026-10-09T16:02:00");
    const m = await t.get();
    expect(m.since).not.toBe("");
    expect(m.material.map((g: any) => g.session)).toEqual(["d3"]);
    expect(m.candidates).toEqual([{ target: ruleNo, lines: [expect.objectContaining({ archiveNo: t.no(c1), hit: "烦" }), expect.objectContaining({ archiveNo: t.no(c2), hit: "别追着问" })] }]);
    const r = await (await t.post({ upTo: c2.id, entries: [{ op: "evidence", target: ruleNo, stance: "for", cites: [t.no(c1)] }] })).json();
    expect(r.unjudged).toBe(1);
    const done = t.store.list({ kinds: ["coldwrite.done"] }).at(-1)!;
    expect((done.payload as any).unjudged).toEqual([{ target: ruleNo, line: t.no(c2) }]);
    const { entries } = await (await t.app.request("/v1/shelf?shelf=rule")).json();
    expect(entries[0]).toMatchObject({ for: 3 });
  });

  test("反例要挂事件；同一事件不能重复计", async () => {
    const t = setup();
    const { e, ruleNo } = await slept(t);
    t.session("d3", "2026-10-09T15:00:00");
    const c = t.her("嗯", "2026-10-09T23:50:00");
    const noCite = await t.post({ upTo: c.id, entries: [{ op: "evidence", target: ruleNo, stance: "against", cites: [] }] });
    expect((await noCite.json()).error).toContain("反例要指出");
    const dup = await t.post({ upTo: c.id, entries: [{ op: "evidence", target: ruleNo, stance: "for", cites: [t.no(e.b2)] }] });
    expect((await dup.json()).error).toContain("已经算过");
  });

  test("改写：新版成现行，旧档号不能再当 target；作废后不在书架上", async () => {
    const t = setup();
    const { ruleNo, factNo } = await slept(t);
    t.session("d3", "2026-10-08T22:00:00");
    const moved = t.her("演示改到下周二了", "2026-10-08T22:22:00");
    const night = t.her("困了 睡了", "2026-10-08T23:52:00");
    const r = await t.post({
      upTo: night.id,
      entries: [
        { op: "revise", target: factNo, text: "演示改到下周二", why: "她说改期了", cites: [t.no(moved)] },
        { op: "revise", target: ruleNo, when: "白天她回单字，我接着追问", why: "深夜那次她只是困了", cites: [t.no(night)] },
      ],
    });
    expect(r.status).toBe(200);
    const { entries } = await (await t.app.request("/v1/shelf")).json();
    const fact = entries.find((x: any) => x.shelf === "fact");
    expect(fact.text).toBe("演示改到下周二");
    expect(fact.archiveNo).not.toBe(factNo);
    const ruleNow = entries.find((x: any) => x.shelf === "rule");
    expect(ruleNow).toMatchObject({ when: "白天她回单字，我接着追问", then: "她不耐烦" });

    t.session("d4", "2026-10-10T14:00:00");
    const x = t.her("好", "2026-10-10T14:10:00");
    const stale = await t.post({ upTo: x.id, entries: [{ op: "retire", target: factNo, why: "过时", cites: [t.no(x)] }] });
    expect((await stale.json()).error).toContain("不是最新版");
    expect((await t.post({ upTo: x.id, entries: [{ op: "retire", target: fact.archiveNo, why: "演示做完了", cites: [t.no(x)] }] })).status).toBe(200);
    const after = (await (await t.app.request("/v1/shelf")).json()).entries;
    expect(after.map((x: any) => x.shelf)).toEqual(["rule"]);
  });

  test("重试同一个 upTo：拿回同一批，不重复写", async () => {
    const t = setup();
    const e = twoDays(t);
    const body = { upTo: e.b2.id, entries: [rule([t.no(e.a2), t.no(e.b2)])] };
    const a = await (await t.post(body)).json();
    const b = await (await t.post(body)).json();
    expect(b.written).toEqual(a.written);
    expect(t.store.list({ kinds: ["semantic.proposed"] })).toHaveLength(1);
  });

  test("recall 先给书架条目，再给经历", async () => {
    const t = setup();
    await slept(t);
    const { lines } = await (await t.app.request(`/v1/recall?q=${encodeURIComponent("追问")}`)).json();
    expect(lines[0]).toMatchObject({ kind: "semantic" });
    expect(lines[0].text).toContain("（规律）");
    expect(lines.slice(1).every((l: any) => l.kind !== "semantic")).toBe(true);
  });
});
