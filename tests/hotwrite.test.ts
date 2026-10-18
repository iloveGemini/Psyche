import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore, type PsycheEvent } from "../src/store/events.ts";
import { Projections } from "../src/store/projections.ts";
import { intake } from "../src/archive/intake.ts";
import { experienceProjector, readExperience } from "../src/archive/experience.ts";
import { cursorOf } from "../src/catalog/hotwrite.ts";
import { parsePrompt } from "../src/core/prompts.ts";
import { createApp } from "../src/server/app.ts";

const T = (s: string) => Date.parse(s);
const JSON_H = { "content-type": "application/json" };

function setup() {
  let clock = T("2026-10-14T09:00:00+08:00");
  const store = new EventStore(":memory:", { now: () => clock });
  const projections = new Projections(store);
  projections.register(experienceProjector);
  projections.live();
  const dir = mkdtempSync(join(tmpdir(), "psyche-prompts-"));
  writeFileSync(join(dir, "hot-write.md"), "---\nversion: 3\nauthor: system\n---\n\n把这一段写成情节。\n");
  const app = createApp({ store, projections, promptsDir: dir });
  const say = (text: string, at?: number) => intake(store, { kind: "message.in", source: "soma", payload: { from: "Joy", text }, at });
  const reply = (text: string) => intake(store, { kind: "message.out", source: "soma", payload: { text } });
  const get = async (q = "") => (await app.request(`/v1/hotwrite${q}`)).json();
  const post = (body: unknown) => app.request("/v1/hotwrite", { method: "POST", headers: JSON_H, body: JSON.stringify(body) });
  const episodes = () => store.list({ kinds: ["episode"] });
  const no = (ev: PsycheEvent) => ev.archiveNo.replace(/^2026-/, "");
  return { store, projections, app, say, reply, get, post, episodes, no, tick: (ms: number) => (clock += ms) };
}

describe("段与游标", () => {
  test("第一次：段 = 会话里全部经历/自我事件；清单按模板渲染，带提示词和版本", async () => {
    const { store, say, reply, get } = setup();
    store.setSituation({ harness: "soma", model: "opus", session: "S1" });
    const a = say("早");
    reply("早，睡得怎么样");
    intake(store, { kind: "surfaced", source: "psyche", payload: { ref: "x" } }); // 渲染为 null：不进清单，但在段内
    const seg = await get();
    expect(seg.session).toBe("S1");
    expect(seg.upTo).toBe(store.list().at(-1)!.id);
    expect(seg.prompt).toBe("把这一段写成情节。");
    expect(seg.promptVersion).toBe(3);
    expect(seg.lines).toEqual([
      { archiveNo: "10-14#2", at: a.at, kind: "message.in", text: "Joy：早" },
      { archiveNo: "10-14#3", at: a.at, kind: "message.out", text: "我说：早，睡得怎么样" },
    ]);
  });

  test("写过之后：第二次只看新事件；晚到的事件 id 更大，进下一段、不被覆盖", async () => {
    const { store, say, reply, get, post, no, tick } = setup();
    store.setSituation({ harness: "soma", session: "S1" });
    const a = say("今天去爬山吧");
    tick(1000);
    const b = reply("好，带上外套");
    const seg1 = await get();
    expect(seg1.upTo).toBe(b.id);
    const res = await (await post({ upTo: seg1.upTo, entries: [{ text: "她约我去爬山，我提醒她带外套。", felt: "有点期待", cites: [no(a), no(b)] }] })).json();
    expect(res.episodes).toHaveLength(1);
    expect(cursorOf(store, "S1")).toBe(b.id);

    const empty = await get();
    expect(empty).toMatchObject({ session: "S1", upTo: null, lines: [] });

    tick(1000);
    const c = say("出发了");
    // 晚到：发生在 a、b 之间（同一会话里），但入库更晚
    const late = intake(store, { kind: "woke", source: "soma", payload: { by: "manual" }, at: a.at + 500 });
    expect(late.id > b.id).toBe(true);
    const seg2 = await get();
    expect(seg2.upTo).toBe(late.id);
    expect(seg2.lines.map((l: { text: string }) => l.text)).toEqual(["（醒来 · 手动）", "Joy：出发了"]);
    expect(seg2.lines[0].at).toBeLessThan(b.at);

    // 经历：a、b 被情节替换；晚到的和新的照旧是原话
    expect(readExperience(store.db).map((l) => l.text)).toEqual([
      "（此后：在 soma）",
      "她约我去爬山，我提醒她带外套。（当时：有点期待）",
      "（醒来 · 手动）",
      "Joy：出发了",
    ]);
    expect(readExperience(store.db, { includeCovered: true })).toHaveLength(6);
    void c;
  });

  test("情节事件的字段：kind/class/source/producer/at/payload/links/幂等键", async () => {
    const { store, say, reply, get, post, no, tick } = setup();
    store.setSituation({ harness: "soma", session: "S1" });
    tick(5000);
    const a = say("一");
    tick(5000);
    const b = reply("二");
    const { upTo } = await get();
    const res = await (await post({ upTo, entries: [{ text: "后一件", cites: [no(b)] }, { text: "两件一起", cites: [no(b), no(a), no(b)] }] })).json();
    const [e1, e2] = res.episodes.map((e: { id: string }) => store.get(e.id)!);
    expect(e1).toMatchObject({ kind: "episode", class: "self", source: "agent", producer: "hot-write@3", at: b.at, payload: { text: "后一件", session: "S1", upTo } });
    expect((e1.payload as object)).not.toHaveProperty("felt");
    expect(e2.at).toBe(a.at); // 所引事件最早的 at
    expect(store.linksFrom(e2.id).map((l) => [l.to, l.rel]).sort()).toEqual([[a.id, "cites"], [b.id, "cites"]].sort());
    const idem = store.db.query(`SELECT idem FROM events WHERE id = ?`).get(e2.id) as { idem: string };
    expect(idem.idem).toBe(`hot:S1:${upTo}:2`);
    expect(res.episodes[0].archiveNo).toBe(no(e1));
  });

  test("会话之间互不相干；session 省略 = 当前处境的会话", async () => {
    const { store, say, get } = setup();
    store.setSituation({ harness: "soma", session: "S1" });
    say("S1 的话");
    store.setSituation({ harness: "soma", session: "S2" });
    say("S2 的话");
    expect((await get()).lines.map((l: { text: string }) => l.text)).toEqual(["Joy：S2 的话"]);
    expect((await get("?session=S1")).lines.map((l: { text: string }) => l.text)).toEqual(["Joy：S1 的话"]);
  });

  test("没有会话：400", async () => {
    const { store, app } = setup();
    store.setSituation({ harness: "roxy" });
    expect((await app.request("/v1/hotwrite")).status).toBe(400);
  });
});

describe("校验：不过就 400，整批不入库", () => {
  async function prepared() {
    const s = setup();
    const { store, say, reply, get, post, no } = s;
    store.setSituation({ harness: "soma", session: "S1" });
    const a = say("一");
    const b = reply("二");
    const first = await get();
    await post({ upTo: first.upTo, entries: [{ text: "写过的", cites: [no(a)] }] });
    const c = say("三");
    const d = reply("四");
    store.setSituation({ harness: "soma", session: "S2" });
    const other = say("别的会话");
    store.setSituation({ harness: "soma", session: "S1" });
    const e = say("五");
    return { ...s, a, b, c, d, e, other };
  }

  test.each([
    ["缺 upTo", (x: any) => ({ entries: [{ text: "t", cites: [x.no(x.c)] }] })],
    ["upTo 是别的会话的", (x: any) => ({ upTo: x.other.id, entries: [{ text: "t", cites: [x.no(x.c)] }] })],
    ["upTo 在游标之前", (x: any) => ({ upTo: x.a.id, entries: [{ text: "t", cites: [x.no(x.a)] }] })],
    ["upTo 不存在", (x: any) => ({ upTo: "01ZZZZ", entries: [{ text: "t", cites: [x.no(x.c)] }] })],
    ["entries 空", (x: any) => ({ upTo: x.d.id, entries: [] })],
    ["entries 缺", (x: any) => ({ upTo: x.d.id })],
    ["text 空", (x: any) => ({ upTo: x.d.id, entries: [{ text: "  ", cites: [x.no(x.c)] }] })],
    ["cites 空", (x: any) => ({ upTo: x.d.id, entries: [{ text: "t", cites: [] }] })],
    ["cite 解析不到", (x: any) => ({ upTo: x.d.id, entries: [{ text: "t", cites: ["10-14#999"] }] })],
    ["cite 是别的会话的", (x: any) => ({ upTo: x.e.id, entries: [{ text: "t", cites: [x.no(x.other)] }] })],
    ["cite 在游标之前", (x: any) => ({ upTo: x.d.id, entries: [{ text: "t", cites: [x.no(x.a)] }] })],
    ["cite 在 upTo 之后", (x: any) => ({ upTo: x.c.id, entries: [{ text: "t", cites: [x.no(x.d)] }] })],
    ["cite 是处境", (x: any) => ({ upTo: x.d.id, entries: [{ text: "t", cites: ["10-14#1"] }] })],
    ["felt 不是字符串", (x: any) => ({ upTo: x.d.id, entries: [{ text: "t", felt: 1, cites: [x.no(x.c)] }] })],
    ["一条好一条坏", (x: any) => ({ upTo: x.d.id, entries: [{ text: "好的", cites: [x.no(x.c)] }, { text: "坏的", cites: [x.no(x.a)] }] })],
  ])("%s", async (_name, body) => {
    const x = await prepared();
    const before = x.episodes().length;
    const res = await x.post(body(x));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeString();
    expect(x.episodes()).toHaveLength(before);
    // 游标没动，经历没被覆盖
    expect(cursorOf(x.store, "S1")).toBe(x.b.id);
    expect(readExperience(x.store.db).map((l) => l.text)).toContain("Joy：三");
  });

  test("对照：同样的段，合法的那条能写进去", async () => {
    const x = await prepared();
    const res = await x.post({ upTo: x.d.id, entries: [{ text: "三和四", cites: [x.no(x.c), x.no(x.d)] }] });
    expect(res.status).toBe(200);
  });
});

describe("幂等", () => {
  test("同一 (会话, upTo) 重试拿到同一批，不重复入库；游标已前移也照样认", async () => {
    const { store, say, get, post, episodes, no } = setup();
    store.setSituation({ harness: "soma", session: "S1" });
    const a = say("一");
    const { upTo } = await get();
    const body = { upTo, entries: [{ text: "甲", cites: [no(a)] }, { text: "乙", cites: [no(a)] }] };
    const r1 = await (await post(body)).json();
    const r2 = await (await post(body)).json();
    expect(r2).toEqual(r1);
    expect(episodes()).toHaveLength(2);
    say("二");
    const r3 = await (await post(body)).json();
    expect(r3).toEqual(r1);
    expect(episodes()).toHaveLength(2);
  });
});

describe("提示词", () => {
  test("去掉 frontmatter，版本取 version；没有 frontmatter = 第 0 版", () => {
    expect(parsePrompt("---\nversion: 2\n---\n\n正文\n")).toEqual({ text: "正文", version: 2 });
    expect(parsePrompt("只有正文")).toEqual({ text: "只有正文", version: 0 });
  });

  test("文件不存在：空串、第 0 版", async () => {
    const store = new EventStore(":memory:");
    store.setSituation({ harness: "soma", session: "S1" });
    const projections = new Projections(store);
    const app = createApp({ store, projections, promptsDir: mkdtempSync(join(tmpdir(), "psyche-empty-")) });
    const seg = await (await app.request("/v1/hotwrite")).json();
    expect([seg.prompt, seg.promptVersion]).toEqual(["", 0]);
    expect(await (await app.request("/v1/prompt")).json()).toEqual({ text: "", version: 0, mechanismVersion: 0, born: false });
  });

  test("/v1/prompt：仓库里的机制（初我是空的）", async () => {
    const store = new EventStore(":memory:");
    const app = createApp({ store, projections: new Projections(store) });
    const p = await (await app.request("/v1/prompt")).json();
    expect(p.version).toBe(0);
    expect(p.text.startsWith("# 你的记忆")).toBe(true);
    expect(p.text).not.toContain("你们的起点是同伴");
  });
});

describe("写记忆本身怎么进经历", () => {
  test("写记忆的调用、成功的返回不进经历（否则又成了没写的）；被拒的留着；收尾那轮的话是经历", async () => {
    const { renderExperience } = await import("../src/archive/render.ts");
    const ev = (kind: string, payload: object) => ({ kind, payload }) as Parameters<typeof renderExperience>[0];
    expect(renderExperience(ev("tool.call", { name: "mcp__psyche__hotwrite", callId: "1", args: { upTo: "x", entries: [{}, {}] } }))).toBeNull();
    expect(renderExperience(ev("tool.call", { name: "mcp__psyche__hotwrite_segment", callId: "2", args: {} }))).toBeNull();
    expect(renderExperience(ev("tool.result", { name: "mcp__psyche__hotwrite", callId: "1", ok: true, text: "记下了 2 条" }))).toBeNull();
    expect(renderExperience(ev("tool.result", { name: "mcp__psyche__hotwrite", callId: "1", ok: false, text: "Psyche 拒绝了（400）：cites 不在段里" }))).toContain("拒绝了");
    expect(renderExperience(ev("message.out", { text: "写好了。", wrapUp: true }))).toBe("我写完记忆时说：写好了。");
    expect(renderExperience(ev("message.out", { text: "写好了。" }))).toBe("我说：写好了。");
    expect(renderExperience(ev("tool.result", { name: "mcp__psyche__hotwrite_segment", callId: "2", ok: true, text: "……" }))).toBeNull();
  });
});

test("翻记忆：调用记一笔，翻出来的内容不再记成经历", async () => {
  const { renderExperience } = await import("../src/archive/render.ts");
  const ev = (kind: string, payload: object) => ({ kind, payload }) as Parameters<typeof renderExperience>[0];
  expect(renderExperience(ev("tool.call", { name: "mcp__psyche__recall", callId: "1", args: { query: "测试" } }))).toBe("我翻了翻记忆，找「测试」");
  expect(renderExperience(ev("tool.result", { name: "mcp__psyche__recall", callId: "1", ok: true, text: "[10-14#2] …" }))).toBeNull();
  expect(renderExperience(ev("tool.result", { name: "mcp__psyche__detail", callId: "2", ok: true, text: "{}" }))).toBeNull();
});

describe("改写情节", () => {
  test("新条 revises 旧条：旧条留着、经历里显示新的；只能改最新版；recall 搜不到旧说法", async () => {
    const { reviseEpisode } = await import("../src/catalog/hotwrite.ts");
    const { readExperience } = await import("../src/archive/experience.ts");
    const { recall } = await import("../src/archive/recall.ts");
    const { store, say, post } = setup();
    store.setSituation({ harness: "soma", model: "opus", session: "S1" });
    const a = say("早");
    const res = await post({ upTo: a.id, entries: [{ text: "他跟我说了早安", cites: [a.archiveNo] }] });
    const [{ archiveNo }] = ((await res.json()) as { episodes: { archiveNo: string }[] }).episodes;
    const r = reviseEpisode(store, { target: archiveNo, text: "测试的人跟我说了早安", why: "不该替别人定性别" });
    const texts = readExperience(store.db).map((l) => l.text);
    expect(texts).toContain("测试的人跟我说了早安");
    expect(texts).not.toContain("他跟我说了早安");
    expect(recall(store.db, { q: "他跟我说" })).toEqual([]);
    const rev = store.byArchiveNo(r.archiveNo)!;
    expect(store.linksFrom(rev.id).map((l) => l.rel).sort()).toEqual(["cites", "revises"]);
    expect(() => reviseEpisode(store, { target: archiveNo, text: "再改" })).toThrow(/已经改写过了/);
    expect(() => reviseEpisode(store, { target: a.archiveNo, text: "x" })).toThrow(/不是你的情节/);
  });
});
