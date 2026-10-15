import { describe, expect, test } from "bun:test";
import { EventStore } from "../src/store/events.ts";
import { Projections } from "../src/store/projections.ts";
import { intake, INLINE_LIMIT } from "../src/archive/intake.ts";
import { experienceProjector, hasFts, readExperience } from "../src/archive/experience.ts";
import { recall, usesFts } from "../src/archive/recall.ts";
import { ago } from "../src/archive/now.ts";
import { writeEpisodes } from "../src/catalog/hotwrite.ts";
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
    expect(intake(store, { kind: "diary", source: "agent", payload: { doc: { hash: "x" } } }).class).toBe("self");
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
    store.append({ kind: "prompt.changed", class: "self", source: "agent", payload: { doc: { hash }, version: 3, why: "她说我太卑微" } });
    expect(readExperience(store.db)[0].text).toBe(`我改写了自己那段提示词（第 3 版）[^${hash.slice(0, 8)}]：她说我太卑微`);
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

describe("经历投影：情节覆盖原话", () => {
  /** 会话 S1 里三句话，热写前两句；之后又来一句，另有会话 S2 */
  function scene() {
    // 处境按时钟写；发生在处境之后的事件才挂得上它
    let clock = T("2026-10-14T08:00:00+08:00");
    const { store, projections } = setup(() => clock);
    store.setSituation({ harness: "soma", session: "S1" });
    const a = intake(store, { kind: "message.in", source: "soma", payload: { from: "Joy", text: "猫又把杯子推下去了" }, at: T("2026-10-14T09:00:00+08:00") });
    const b = intake(store, { kind: "message.out", source: "soma", payload: { text: "杯子碎了吗" }, at: T("2026-10-14T09:01:00+08:00") });
    writeEpisodes(store, { upTo: b.id, entries: [{ text: "她说猫把杯子推下去了，我先问杯子碎没碎。", felt: "想笑", cites: [a.archiveNo, b.archiveNo] }] }, 1);
    intake(store, { kind: "message.in", source: "soma", payload: { from: "Joy", text: "没碎" }, at: T("2026-10-14T09:02:00+08:00") });
    clock = T("2026-10-14T09:20:00+08:00");
    store.setSituation({ harness: "soma", session: "S2" });
    intake(store, { kind: "message.in", source: "soma", payload: { from: "Joy", text: "换个会话" }, at: T("2026-10-14T09:30:00+08:00") });
    return { store, projections };
  }

  test("被覆盖的原话默认不给；情节带感受、按 at 排；处境行不算段内", () => {
    const { store } = scene();
    expect(readExperience(store.db).map((l) => l.text)).toEqual([
      "（此后：在 soma）",
      "她说猫把杯子推下去了，我先问杯子碎没碎。（当时：想笑）",
      "Joy：没碎",
      "（此后：在 soma）",
      "Joy：换个会话",
    ]);
    expect(readExperience(store.db, { includeCovered: true })).toHaveLength(7);
    const cols = store.db.query(`SELECT kind, session, covered FROM p_experience ORDER BY rid`).all();
    expect(cols).toEqual([
      { kind: "situation", session: "S1", covered: 0 },
      { kind: "message.in", session: "S1", covered: 1 },
      { kind: "message.out", session: "S1", covered: 1 },
      { kind: "episode", session: "S1", covered: 0 },
      { kind: "message.in", session: "S1", covered: 0 },
      { kind: "situation", session: "S2", covered: 0 },
      { kind: "message.in", session: "S2", covered: 0 },
    ]);
  });

  test("重建后一字不差（含覆盖与全文索引）", () => {
    const { store, projections } = scene();
    const before = readExperience(store.db, { includeCovered: true });
    const visible = readExperience(store.db);
    const found = recall(store.db, { q: "推下去" });
    projections.rebuild("experience");
    expect(readExperience(store.db, { includeCovered: true })).toEqual(before);
    expect(readExperience(store.db)).toEqual(visible);
    expect(recall(store.db, { q: "推下去" })).toEqual(found);
  });

  test("从第 1 版的表升级：自动丢旧表、重放", () => {
    const store = new EventStore(":memory:");
    store.setSituation({ harness: "soma", session: "S1" });
    intake(store, { kind: "message.in", source: "soma", payload: { from: "Joy", text: "旧" } });
    store.db.run(`CREATE TABLE p_experience (event_id TEXT PRIMARY KEY, at INTEGER NOT NULL, archive_no TEXT NOT NULL, kind TEXT NOT NULL, class TEXT NOT NULL, situation TEXT, text TEXT NOT NULL)`);
    store.db.run(`INSERT INTO projection_cursors (name, version, last_id) VALUES ('experience', 1, '')`);
    new Projections(store).register(experienceProjector);
    expect(readExperience(store.db).map((l) => l.text)).toEqual(["（此后：在 soma）", "Joy：旧"]);
    expect(store.readSyslog({ kind: "projection.rebuilt" })[0].detail).toMatchObject({ name: "experience", version: experienceProjector.version });
  });
});

describe("recall", () => {
  function corpus() {
    const { store, projections } = setup(() => T("2026-10-12T08:00:00+08:00"));
    store.setSituation({ harness: "soma", session: "S1" });
    const say = (text: string, at: string) => intake(store, { kind: "message.in", source: "soma", payload: { from: "Joy", text }, at: T(at) });
    const a = say("周末去爬山吧", "2026-10-12T09:00:00+08:00");
    const b = say("爬山要带水", "2026-10-13T09:00:00+08:00");
    say("I fixed the Parser bug", "2026-10-13T10:00:00+08:00");
    say("山顶好冷", "2026-10-14T09:00:00+08:00");
    say("100% 确定 a_b", "2026-10-14T09:30:00+08:00");
    return { store, projections, a, b };
  }

  test("bun:sqlite 带 FTS5 trigram", () => {
    const { store } = corpus();
    expect(hasFts(store.db)).toBe(true);
  });

  test("中文 ≥3 字走 FTS；英文不分大小写", () => {
    const { store } = corpus();
    expect(usesFts(store.db, "去爬山")).toBe(true);
    expect(recall(store.db, { q: "去爬山" }).map((l) => l.text)).toEqual(["Joy：周末去爬山吧"]);
    expect(recall(store.db, { q: "parser" }).map((l) => l.text)).toEqual(["Joy：I fixed the Parser bug"]);
    expect(recall(store.db, { q: "fixed bug" }).map((l) => l.text)).toEqual(["Joy：I fixed the Parser bug"]);
  });

  test("短词（< 3 字）退回 LIKE；按时间新的在前", () => {
    const { store } = corpus();
    expect(usesFts(store.db, "爬山")).toBe(false);
    expect(recall(store.db, { q: "爬山" }).map((l) => l.text)).toEqual(["Joy：爬山要带水", "Joy：周末去爬山吧"]);
    expect(recall(store.db, { q: "山" }).map((l) => l.text)).toEqual(["Joy：山顶好冷", "Joy：爬山要带水", "Joy：周末去爬山吧"]);
    // LIKE 的通配符照字面
    expect(recall(store.db, { q: "0%" }).map((l) => l.text)).toEqual(["Joy：100% 确定 a_b"]);
    expect(recall(store.db, { q: "a_b" }).map((l) => l.text)).toEqual(["Joy：100% 确定 a_b"]);
    expect(recall(store.db, { q: "%" })).toHaveLength(1);
  });

  test("时间范围与条数", () => {
    const { store } = corpus();
    expect(recall(store.db, { q: "山", from: T("2026-10-13T00:00:00+08:00"), to: T("2026-10-14T00:00:00+08:00") }).map((l) => l.text)).toEqual(["Joy：爬山要带水"]);
    expect(recall(store.db, { q: "山", limit: 1 })).toHaveLength(1);
  });

  test("只搜可见行：被覆盖的原话搜不到，情节搜得到", () => {
    const { store, a, b } = corpus();
    writeEpisodes(store, { upTo: b.id, entries: [{ text: "我们说好周末上山，要带够水。", cites: [a.archiveNo, b.archiveNo] }] }, 1);
    expect(recall(store.db, { q: "去爬山" })).toEqual([]);
    expect(recall(store.db, { q: "带够水" }).map((l) => l.kind)).toEqual(["episode"]);
    expect(recall(store.db, { q: "水" }).map((l) => l.kind)).toEqual(["episode"]);
  });

  test("REST：日期参数按本地自然日，档号省略年份；缺 q 或时间看不懂 400", async () => {
    const { store, projections } = corpus();
    const app = createApp({ store, projections });
    const r = await (await app.request(`/v1/recall?q=${encodeURIComponent("山")}&from=2026-10-13&to=2026-10-13`)).json();
    expect(r.lines).toEqual([{ archiveNo: "10-13#1", at: T("2026-10-13T09:00:00+08:00"), kind: "message.in", text: "Joy：爬山要带水" }]);
    expect((await app.request("/v1/recall")).status).toBe(400);
    expect((await app.request("/v1/recall?q=x&from=昨天")).status).toBe(400);
  });
});

describe("<now>", () => {
  test("时间带星期、harness 与会话起点、上次有人说话、未写条数", async () => {
    let clock = T("2026-10-14T09:00:00+08:00");
    const { store, projections } = setup(() => clock);
    store.setSituation({ harness: "soma", session: "S1" });
    intake(store, { kind: "message.in", source: "soma", payload: { from: "Joy", text: "早" }, at: T("2026-10-14T09:05:00+08:00") });
    intake(store, { kind: "message.out", source: "soma", payload: { text: "早" }, at: T("2026-10-14T09:06:00+08:00") });
    intake(store, { kind: "surfaced", source: "psyche", payload: { ref: "x" } }); // 不进清单，不算
    intake(store, { kind: "message.in", source: "soma", payload: { from: "小白", text: "在吗" }, at: T("2026-10-14T12:09:00+08:00") });
    clock = T("2026-10-14T12:10:00+08:00");
    const app = createApp({ store, projections });
    const { text } = await (await app.request("/v1/now")).json();
    expect(text).toBe(
      ["<now>", "现在：2026-10-14 周三 12:10", "在：soma，本会话从 10-14 09:00 起", "上次有人跟我说话：Joy，3 小时前", "还没写进记忆的：3 条", "</now>"].join("\n"),
    );
  });

  test("没处境、没人说过话：只剩现在", async () => {
    const { store, projections } = setup(() => T("2027-01-02T08:00:00+08:00"));
    intake(store, { kind: "message.in", source: "roxy", payload: { from: "Joy", text: "只有一条" } });
    const { text } = await (await createApp({ store, projections }).request("/v1/now")).json();
    expect(text).toBe("<now>\n现在：2027-01-02 周六 08:00\n</now>");
  });

  test("处境没有会话：只报 harness，不报未写条数", async () => {
    const { store, projections } = setup(() => T("2026-10-14T09:00:00+08:00"));
    store.setSituation({ harness: "roxy" });
    const { text } = await (await createApp({ store, projections }).request("/v1/now")).json();
    expect(text).toBe("<now>\n现在：2026-10-14 周三 09:00\n在：roxy\n</now>");
  });

  test("多久前", () => {
    expect([ago(30_000), ago(5 * 60_000), ago(3 * 3600_000 + 59 * 60_000), ago(50 * 3600_000)]).toEqual(["刚刚", "5 分钟前", "3 小时前", "2 天前"]);
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

describe("recall 不搜回声", () => {
  test("记忆工具的调用行、本会话这一轮的话都不搜；别的会话照搜", async () => {
    const { store, projections } = setup(() => T("2026-10-14T14:00:00+08:00"));
    store.setSituation({ harness: "soma", session: "S1" });
    intake(store, { kind: "message.in", source: "soma", payload: { from: "Joy", text: "午饭吃了面" }, at: T("2026-10-14T12:00:00+08:00") });
    store.setSituation({ harness: "soma", session: "S2" });
    intake(store, { kind: "message.in", source: "soma", payload: { from: "Joy", text: "我午饭吃了什么？" }, at: T("2026-10-14T14:00:00+08:00") });
    intake(store, { kind: "tool.call", source: "soma", payload: { name: "mcp__psyche__recall", callId: "c1", args: { query: "午饭" } }, at: T("2026-10-14T14:00:01+08:00") });
    intake(store, { kind: "tool.call", source: "soma", payload: { name: "Bash", callId: "c2", args: { command: "echo 午饭" } }, at: T("2026-10-14T14:00:02+08:00") });

    expect(recall(store.db, { q: "午饭", session: "S2" }).map((l) => l.text)).toEqual(["Joy：午饭吃了面"]);
    // 不给会话：这一轮也搜得到，但记忆工具行仍不搜
    expect(recall(store.db, { q: "午饭" }).map((l) => l.kind)).toEqual(["tool.call", "message.in", "message.in"]);
    // REST 省略 session = 当前处境的会话
    const app = createApp({ store, projections });
    const r = await (await app.request(`/v1/recall?q=${encodeURIComponent("午饭")}`)).json();
    expect(r.lines.map((l: { text: string }) => l.text)).toEqual(["Joy：午饭吃了面"]);
  });
});
