import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore, type PsycheEvent } from "../src/store/events.ts";
import { Projections } from "../src/store/projections.ts";
import { intake } from "../src/archive/intake.ts";
import { experienceProjector } from "../src/archive/experience.ts";
import { shelfProjector } from "../src/reading/shelf.ts";
import { coldCursor, FEEDBACK_BUDGET, readColdwrite } from "../src/catalog/coldwrite.ts";
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

test("材料太长分批：截在超额前一行，交了这批游标前移、下一批接着给", async () => {
  const t = setup();
  t.session("s1", "2026-10-13T10:00:00");
  const evs = Array.from({ length: 5 }, (_, i) => t.her(`第${i}句`.padEnd(10, "嗯"), `2026-10-13T10:0${i}:00`));
  const first = readColdwrite(t.store, undefined, 30);
  expect(first.upTo).toBe(evs[1].id);
  expect(first.rest).toBe(3);
  expect(first.material.flatMap((g) => g.lines).map((l) => l.text)).toEqual(["阿禾：第0句嗯嗯嗯嗯嗯嗯嗯", "阿禾：第1句嗯嗯嗯嗯嗯嗯嗯"]);
  expect((await t.post({ upTo: first.upTo, entries: [] })).status).toBe(200);
  const second = readColdwrite(t.store, undefined, 30);
  expect(second.material.flatMap((g) => g.lines)[0].text).toContain("第2句");
  expect(second.rest).toBe(1);
  // 一行就超额也给这一行
  expect(readColdwrite(t.store, undefined, 1).material.flatMap((g) => g.lines)).toHaveLength(1);
  // 缺省额度够，一次给完
  expect((await t.get()).rest).toBe(0);
});

test("反馈封顶：超了 FEEDBACK_BUDGET 留最近的", () => {
  const t = setup();
  t.session("s1", "2026-10-13T10:00:00");
  for (let i = 0; i < 20; i++) {
    t.me(`第${i}次`.padEnd(500, "长"), `2026-10-13T10:${String(i * 2).padStart(2, "0")}:00`);
    t.her(`回${i}`, `2026-10-13T10:${String(i * 2 + 1).padStart(2, "0")}:00`);
  }
  const fb = readColdwrite(t.store, undefined, 1_000_000).feedback;
  const size = fb.reduce((n, f) => n + [...f.acts, ...(f.next ? [f.next] : [])].reduce((m, l) => m + l.text.length, 0), 0);
  expect(size).toBeLessThanOrEqual(FEEDBACK_BUDGET);
  expect(fb.at(-1)!.next!.text).toContain("回19");
});

describe("系统闸", () => {
  test("规律：证据来自同一个会话 → 拒；两个会话 → 收，计印证 2", async () => {
    const t = setup();
    const e = twoDays(t);
    const r1 = await t.post({ upTo: e.b2.id, entries: [rule([t.no(e.a1), t.no(e.a2)])] });
    expect(r1.status).toBe(400);
    expect((await r1.json()).error).toContain("来自不同时间");
    const r2 = await t.post({ upTo: e.b2.id, entries: [rule([t.no(e.a2), t.no(e.b2)])] });
    expect(r2.status).toBe(200);
    const { entries } = await (await t.app.request("/v1/shelf")).json();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ shelf: "rule", for: 2, against: 0, when: "她回单字，我接着追问" });
  });

  test("同一会话也行：跨天、或相隔 6 小时以上", async () => {
    const t = setup();
    t.session("long", "2026-10-05T09:00:00");
    const a = t.her("嗯", "2026-10-05T09:10:00");
    const b = t.her("烦", "2026-10-05T10:00:00");
    const c = t.her("烦 别问了", "2026-10-05T16:30:00");
    const near = await t.post({ upTo: c.id, entries: [rule([t.no(a), t.no(b)])] });
    expect(near.status).toBe(400);
    expect((await t.post({ upTo: c.id, entries: [rule([t.no(a), t.no(c)])] })).status).toBe(200);
  });

  test("明说的规矩引情节：去情节挂的原件里找原话", async () => {
    const t = setup();
    const e = twoDays(t);
    const { writeEpisodes } = await import("../src/catalog/hotwrite.ts");
    const ep = writeEpisodes(t.store, { session: "d1", upTo: e.told.id, entries: [{ text: "她让我在她回单字时别追问", cites: [t.no(e.told)] }] }, 1).episodes[0];
    const told = { op: "propose", shelf: "told", text: "她回单字时别追问", quote: "我回一个字的时候你别追着问", cites: [ep.archiveNo] };
    const r = await t.post({ upTo: ep.id, entries: [told] });
    expect(await r.json()).toMatchObject({ written: [{ op: "propose" }] });
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

  test("计数按次不按行：首批按会话数，一次判断挂几行都算 1 次；改写的依据不计印证", async () => {
    const t = setup();
    const e = twoDays(t);
    await t.post({ upTo: e.b2.id, entries: [rule([t.no(e.a1), t.no(e.a2), t.no(e.b1), t.no(e.b2)])] });
    const shelf = async () => (await (await t.app.request("/v1/shelf")).json()).entries[0];
    expect(await shelf()).toMatchObject({ for: 2 });
    t.session("d3", "2026-10-09T00:30:00");
    const n1 = t.her("好", "2026-10-09T00:40:00");
    const n2 = t.me("要不要两种都写个草稿？", "2026-10-09T00:40:30");
    const n3 = t.her("眼睛睁不开了 晚安~", "2026-10-09T00:42:00");
    const no = (await shelf()).archiveNo;
    await t.post({ upTo: n3.id, entries: [{ op: "evidence", target: no, stance: "against", cites: [t.no(n1), t.no(n2), t.no(n3)] }] });
    expect(await shelf()).toMatchObject({ for: 2, against: 1 });
    t.session("d4", "2026-10-10T00:30:00");
    const m = t.her("嗯 困了", "2026-10-10T00:40:00");
    await t.post({ upTo: m.id, entries: [{ op: "revise", target: no, when: "白天她回单字，我接着追问", why: "深夜的两次她只是困了", cites: [t.no(m)] }] });
    expect(await shelf()).toMatchObject({ for: 2, against: 1 });
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
    // 带依据的档号；查询里只要有一个实词撞上就算（原来要求每个词都出现）
    expect(lines[0].text).toMatch(/依据：10-0[57]#\d+/);
    const any = await (await t.app.request(`/v1/recall?q=${encodeURIComponent("得分 追问 记一分")}`)).json();
    expect(any.lines[0]).toMatchObject({ kind: "semantic" });
  });
});

test("统计这段截到材料里最后一条消息：最后一条材料是情节时，不截掉那次对话", async () => {
  const { readSegment, writeEpisodes } = await import("../src/catalog/hotwrite.ts");
  const t = setup();
  t.session("d1", "2026-10-13T20:29:00");
  const a = t.her("泡了杯茶 来了", "2026-10-13T20:30:00");
  const b = t.me("好，今天做什么？", "2026-10-13T20:31:00");
  const c = t.her("好看 今天就到这", "2026-10-13T20:50:00");
  const { upTo } = readSegment(t.store, "d1");
  writeEpisodes(t.store, { session: "d1", upTo, entries: [{ text: "阿禾来了，做完就走。", cites: [a, b, c].map(t.no) }] }, 1);
  // 统计只给 track 了的（attention.md §四）
  t.store.append({ kind: "semantic.proposed", class: "self", source: "agent", payload: { shelf: "relation", about: "阿禾", text: "她来做小账本", track: ["convMinutes"] } });
  const m = await t.get();
  expect(m.stats.period.to).toBeGreaterThan(T("2026-10-13T20:50:00"));
  const conv = m.stats.people[0].rows.find((r: { key: string }) => r.key === "convMinutes");
  expect(conv.period).toBe(20);
});
