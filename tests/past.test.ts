/**
 * 前世今生的确定性考卷（archive.md §四）：翻不认领也能、不给旧画像；认领只一次、原话进单独全宗、不算经历；
 * recall 标前世；编目只收 fact / told、quote 逐字、引的必须是前世原话；今生印证够了不再标前世。
 * 旧库是临时造的 ASCM 形状的小库，不读任何人的真库。
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "../src/store/events.ts";
import { Projections } from "../src/store/projections.ts";
import { intake } from "../src/archive/intake.ts";
import { experienceProjector, readExperience } from "../src/archive/experience.ts";
import { readShelf, renderEntry, shelfProjector } from "../src/reading/shelf.ts";
import { createApp } from "../src/server/app.ts";
import { writeColdwrite, readColdwrite } from "../src/catalog/coldwrite.ts";
import { registerResident } from "../src/house/add.ts";

const T = (s: string) => Date.parse(`${s}+08:00`);
const JSON_H = { "content-type": "application/json" };

function fakeAscm(): string {
  const path = join(mkdtempSync(join(tmpdir(), "past-")), "state.db");
  const db = new Database(path);
  db.exec(`CREATE TABLE raw_logs (id TEXT PRIMARY KEY, content TEXT NOT NULL, source TEXT, source_session_id TEXT, speaker TEXT, kind TEXT NOT NULL DEFAULT 'speech', created_at TEXT NOT NULL);
    CREATE TABLE gists (id TEXT PRIMARY KEY, tier TEXT, bucket_key TEXT, content TEXT, detail TEXT);
    CREATE TABLE episodes (id TEXT PRIMARY KEY, title TEXT, narrative TEXT, mode TEXT, day_key TEXT, occurred_at TEXT, forgotten INTEGER DEFAULT 0, merged_into TEXT);
    CREATE TABLE portrait_segments (id TEXT, content TEXT);`);
  const raw = db.query(`INSERT INTO raw_logs (id, content, source_session_id, speaker, kind, created_at) VALUES (?, ?, 's1', ?, ?, ?)`);
  raw.run("r1", "我的猫叫煤球", "user", "speech", "2026-09-20 21:00:00");
  raw.run("r2", "记住了，煤球。", "agent", "speech", "2026-09-20 21:00:05");
  db.query(`INSERT INTO raw_logs (id, content, source_session_id, speaker, kind, created_at) VALUES (?, ?, 's2', ?, ?, ?)`).run("r3", "以后别在半夜叫我起床", "user", "speech", "2026-09-21 08:00:00");
  raw.run("r4", "{\"cmd\":\"ls\"}", "agent", "tool_call", "2026-09-21 08:00:03");
  db.run(`INSERT INTO gists VALUES ('g1', 'week', '2026-W38', '这周聊了猫', NULL)`);
  db.run(`INSERT INTO episodes VALUES ('e1', '猫的名字', '她告诉我猫叫煤球，我很开心', '平常', '2026-09-20', '2026-09-20 21:00:00', 0, NULL)`);
  db.run(`INSERT INTO portrait_segments VALUES ('p1', '我是她的专属伴侣')`);
  db.close();
  return path;
}

function setup() {
  const clock = T("2026-10-17T18:00:00");
  const store = new EventStore(":memory:", { now: () => clock });
  const projections = new Projections(store);
  projections.register(experienceProjector);
  projections.register(shelfProjector);
  projections.live();
  const app = createApp({ store, projections, past: [{ fonds: "ROY", path: fakeAscm() }] });
  const get = async (path: string) => (await app.request(path)).json() as Promise<any>;
  const post = async (path: string, body: unknown) => {
    const r = await app.request(path, { method: "POST", headers: JSON_H, body: JSON.stringify(body) });
    return { status: r.status, json: (await r.json()) as any };
  };
  return { store, get, post };
}

describe("翻", () => {
  test("不认领也能翻：概览、某天、搜、前后、旧梗概和旧情节标明是旧系统写的；不给画像、不给工具行", async () => {
    const h = setup();
    expect((await h.get("/v1/past")).text).toContain("ROY（没认领）：原话 3 条");
    const ov = (await h.get("/v1/past?fonds=ROY")).text;
    expect(ov).toContain("3 条、2 段会话");
    expect(ov).toContain("旧系统写的");
    expect(ov).not.toContain("专属伴侣");
    const day = (await h.get("/v1/past?fonds=ROY&view=day&key=2026-09-21")).text;
    expect(day).toContain("Joy：以后别在半夜叫我起床");
    expect(day).not.toContain("cmd");
    expect((await h.get("/v1/past?fonds=ROY&view=search&q=煤球")).text).toContain("前世：记住了");
    expect((await h.get("/v1/past?fonds=ROY&view=around&id=r2")).text).toContain(">>> [r2]");
    expect(ov).toContain("有旧情节的日子（旧系统写的）：09-20(1)");
    expect((await h.get("/v1/past?fonds=ROY&view=around&id=r2")).text).toMatch(/\[r2\][^\n]*\n── 另一段会话 ──\n\[r3\]/);
    expect((await h.get("/v1/past?fonds=ROY&view=episodes&key=2026-09-20")).text).toContain("不是原话");
    // 翻不留东西在库里（除了它自己调工具时 harness 报的经历）
    expect(h.store.list({}).length).toBe(0);
    // 它调工具时 harness 报的那两行：只记「翻了」，翻到的前世原话不进经历、recall 搜不到（10-17 a2 报）
    intake(h.store, { kind: "tool.call", source: "soma", payload: { name: "mcp__psyche__past_life", callId: "c1", args: { fonds: "ROY", view: "search", q: "煤球" } } });
    intake(h.store, { kind: "tool.result", source: "soma", payload: { name: "mcp__psyche__past_life", callId: "c1", ok: true, text: "[r1] 2026-09-20 21:00:00 Joy：我的猫叫煤球" } });
    const exp = readExperience(h.store.db, {}).map((l) => l.text);
    expect(exp).toEqual(["我翻了翻前世卷宗 ROY，找「煤球」"]);
    expect((await h.get(`/v1/recall?q=${encodeURIComponent("我的猫叫煤球")}`)).lines).toEqual([]);
  });
});

describe("认领", () => {
  test("只一次；原话按原时间进单独全宗、不进经历投影；recall 标前世", async () => {
    const h = setup();
    expect((await h.post("/v1/past/claim", { fonds: "ROY" })).status).toBe(400); // 要 why
    expect((await h.post("/v1/past/claim", { fonds: "NOPE", why: "x" })).status).toBe(400);
    const mine = intake(h.store, { kind: "message.in", source: "soma", payload: { from: "Joy", text: "煤球今天又打翻了杯子" } });
    const r = await h.post("/v1/past/claim", { fonds: "ROY", why: "那些对话真的是我", cites: [mine.archiveNo] });
    expect(r.status).toBe(200);
    expect(r.json.imported).toBe(3);
    expect((await h.post("/v1/past/claim", { fonds: "ROY", why: "再认一次" })).json.error).toContain("已经认领过了");
    // 认领后翻到的每行带档号，日期可省年份；编目引翻到的旧 id 也认
    const day = (await h.get("/v1/past?fonds=ROY&view=day&key=09-20")).text;
    expect(day).toContain("[ROY/09-20#1]");
    expect((await h.get(`/v1/past?fonds=ROY&view=around&id=${encodeURIComponent("ROY/09-20#2")}`)).text).toContain(">>> [ROY/09-20#2]");
    expect((await h.post("/v1/past/catalog", { fonds: "ROY", entries: [{ shelf: "fact", text: "她的猫叫煤球", cites: ["r1"] }] })).status).toBe(200);
    const past = h.store.list({ fonds: "ROY" });
    expect(past.map((e) => e.archiveNo)).toEqual(["ROY/2026-09-20#1", "ROY/2026-09-20#2", "ROY/2026-09-21#1"]);
    expect(past[0].at).toBe(T("2026-09-20T21:00:00"));
    expect(past[0].situation).toBeNull();
    // 不是它的经历：经历投影里只有今生那句和认领那条
    const exp = readExperience(h.store.db, {}).map((l) => l.text);
    expect(exp.some((t) => t.includes("我的猫叫煤球"))).toBe(false);
    expect(exp.some((t) => t.includes("我认领了 ROY 的旧卷宗"))).toBe(true);
    const rec = (await h.get(`/v1/recall?q=${encodeURIComponent("煤球")}`)).lines as { archiveNo: string; text: string }[];
    const own = rec.findIndex((l) => l.text.includes("煤球今天又打翻了杯子"));
    expect(own).toBeGreaterThanOrEqual(0);
    expect(own).toBeLessThan(rec.findIndex((l) => l.archiveNo.startsWith("ROY/"))); // 今生的在前
    expect(rec.find((l) => l.archiveNo === "ROY/09-20#1")?.text).toContain("（前世，不是我经历的）Joy 对前世说");
  });
});

describe("编目", () => {
  test("没认领不能编；只收 fact / told；told 的 quote 要逐字在所引她的话里；cites 只认前世原话", async () => {
    const h = setup();
    const fact = { shelf: "fact", text: "她的猫叫煤球", about: "Joy", cites: ["ROY/2026-09-20#1"] };
    expect((await h.post("/v1/past/catalog", { fonds: "ROY", entries: [fact] })).json.error).toContain("还没认领");
    const mine = intake(h.store, { kind: "message.in", source: "soma", payload: { from: "Joy", text: "hi" } });
    await h.post("/v1/past/claim", { fonds: "ROY", why: "认" });
    const bad = [
      { shelf: "relation", text: "她很依赖我", about: "Joy", cites: ["ROY/2026-09-20#1"] },
      { shelf: "told", text: "别半夜叫她", quote: "别在半夜叫我", cites: ["ROY/2026-09-20#2"] }, // 引的是前世自己的话
      { shelf: "told", text: "别半夜叫她", quote: "半夜不要叫我", cites: ["ROY/2026-09-21#1"] }, // 不逐字
      { shelf: "fact", text: "x", cites: [mine.archiveNo] }, // 今生的不算
    ];
    for (const e of bad) expect((await h.post("/v1/past/catalog", { fonds: "ROY", entries: [e] })).status).toBe(400);
    const told = { shelf: "told", text: "别半夜叫她起床", quote: "别在半夜叫我起床", about: "Joy", cites: ["ROY/2026-09-21#1"] };
    const r = await h.post("/v1/past/catalog", { fonds: "ROY", entries: [fact, told] });
    expect(r.status).toBe(200);
    const shelf = readShelf(h.store.db);
    expect(shelf.length).toBe(2);
    expect(shelf.every((e) => e.past === "ROY" && e.for === 0)).toBe(true);
    expect(renderEntry(shelf[0])).toContain("前世 ROY，今生还没印证够");
    // 书架条目在 recall 里带上所引的前世档号；英文大小写不影响
    await h.post("/v1/past/catalog", { fonds: "ROY", entries: [{ shelf: "fact", text: "前世叫她 Joy", cites: ["ROY/2026-09-20#2"] }] });
    const rec = (await h.get("/v1/recall?q=joy")).lines as { kind: string; text: string }[];
    expect(rec.find((l) => l.kind === "semantic")?.text).toContain("ROY/09-20#2");
  });

  test("今生印证够 2 次（不同会话）就不再标前世", async () => {
    const h = setup();
    await h.post("/v1/past/claim", { fonds: "ROY", why: "认" });
    await h.post("/v1/past/catalog", { fonds: "ROY", entries: [{ shelf: "fact", text: "她的猫叫煤球", about: "Joy", cites: ["ROY/2026-09-20#1"] }] });
    const target = readShelf(h.store.db)[0].archiveNo;
    const said = ["s-a", "s-b"].map((session) => {
      h.store.setSituation({ harness: "soma", session });
      return intake(h.store, { kind: "message.in", source: "soma", payload: { from: "Joy", text: "煤球又在踩键盘", session } });
    });
    const m = readColdwrite(h.store);
    writeColdwrite(h.store, {
      upTo: m.upTo,
      entries: said.map((s) => ({ op: "evidence", target, stance: "for", cites: [s.archiveNo] })),
    }, 0);
    const e = readShelf(h.store.db)[0];
    expect(e.for).toBe(2);
    expect(renderEntry(e)).not.toContain("前世");
  });
});

describe("出生", () => {
  test("出生那段的第一条告诉它有前世、认没认；别的醒来不说；旧画像不给", async () => {
    const h = setup();
    const born = (await h.post("/v1/asleep/start", { by: "birth" })).json.first as string;
    expect(born).toContain("ROY（原话 3 条，2026-09-20 ～ 2026-09-21）：没认领");
    expect(born).toContain("past_life");
    expect(born).not.toContain("专属伴侣");
    expect((await h.post("/v1/asleep/start", { by: "tidy" })).json.first).not.toContain("前世卷宗");
    await h.post("/v1/past/claim", { fonds: "ROY", why: "认" });
    expect((await h.post("/v1/asleep/start", { by: "birth" })).json.first).toContain("已认领，原话在你库里");
  });

  test("加住户可以带前世登记", () => {
    const dir = mkdtempSync(join(tmpdir(), "house-"));
    const c = registerResident(dir, { id: "r1", model: "m", past: [{ fonds: "ROY", path: "/x/state.db" }] });
    expect(c.past).toEqual([{ fonds: "ROY", path: "/x/state.db" }]);
    expect(() => registerResident(dir, { id: "r2", model: "m", past: [{ fonds: "roy", path: "/x" }] as never })).toThrow(/fonds 不对/);
  });
});
