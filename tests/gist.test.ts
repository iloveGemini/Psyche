/**
 * 梗概与"接着往下过"的确定性考卷（10-16）：哪些段该写、材料对不对、闸、拼出来的次序和长度、调度。
 * 只考系统；它写了什么，不考。
 */
import { describe, expect, test } from "bun:test";
import { EventStore } from "../src/store/events.ts";
import { Projections } from "../src/store/projections.ts";
import { experienceProjector } from "../src/archive/experience.ts";
import { shelfProjector } from "../src/reading/shelf.ts";
import { intake } from "../src/archive/intake.ts";
import { createApp } from "../src/server/app.ts";
import { pendingGists, weekOf, writeGist, GistError } from "../src/catalog/gist.ts";
import { renderContinuity, seedContinuity } from "../src/archive/continuity.ts";
import { tick } from "../src/heartbeat/scheduler.ts";

const T = (s: string) => Date.parse(`${s}+08:00`);
const JSON_H = { "content-type": "application/json" };

function setup(start = "2026-10-16T09:00:00") {
  let clock = T(start);
  const store = new EventStore(":memory:", { now: () => clock });
  const projections = new Projections(store);
  projections.register(experienceProjector);
  projections.register(shelfProjector);
  projections.live();
  const app = createApp({ store, projections });
  const get = async (path: string) => (await app.request(path)).json();
  const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers: JSON_H, body: JSON.stringify(body) });
  const episode = (at: string, text: string) => store.append({ kind: "episode", class: "self", source: "agent", at: T(at), payload: { text } });
  const set = (t: string) => (clock = T(t));
  return { store, get, post, episode, set };
}

describe("日历", () => {
  test("ISO 周：周一起，跨年按周四", () => {
    expect(weekOf("2026-10-12")).toBe("2026-W42"); // 周一
    expect(weekOf("2026-10-18")).toBe("2026-W42"); // 周日
    expect(weekOf("2026-10-19")).toBe("2026-W43");
    expect(weekOf("2027-01-01")).toBe("2026-W53");
  });
});

describe("哪些段该写", () => {
  test("天：有情节、过完了才算；今天不算；写了就不再出现", () => {
    const h = setup("2026-10-16T09:00:00");
    h.episode("2026-10-14T10:00:00", "十四号上午");
    h.episode("2026-10-14T21:00:00", "十四号晚上");
    h.episode("2026-10-16T08:00:00", "今天");
    expect(pendingGists(h.store).map((p) => `${p.span}:${p.key}`)).toEqual(["day:2026-10-14"]);
    expect(pendingGists(h.store)[0].source.map((s) => s.text)).toEqual(["十四号上午", "十四号晚上"]);
    writeGist(h.store, { span: "day", key: "2026-10-14", text: "写代码的一天" });
    expect(pendingGists(h.store)).toEqual([]);
  });

  test("周等那周的天写完、那周过完；月等周", () => {
    const h = setup("2026-11-02T09:00:00");
    h.episode("2026-10-26T10:00:00", "周一");
    h.episode("2026-10-27T10:00:00", "周二");
    expect(pendingGists(h.store).map((p) => p.span)).toEqual(["day", "day"]); // 周、月要等天
    writeGist(h.store, { span: "day", key: "2026-10-26", text: "一" });
    writeGist(h.store, { span: "day", key: "2026-10-27", text: "二" });
    const p = pendingGists(h.store);
    expect(p.map((x) => `${x.span}:${x.key}`)).toEqual(["week:2026-W44"]);
    expect(p[0].source).toEqual([{ label: "2026-10-26", text: "一" }, { label: "2026-10-27", text: "二" }]);
    writeGist(h.store, { span: "week", key: "2026-W44", text: "这一周" });
    expect(pendingGists(h.store).map((x) => `${x.span}:${x.key}`)).toEqual(["month:2026-10"]);
    expect(pendingGists(h.store)[0].source).toEqual([{ label: "2026-W44", text: "这一周" }]);
  });

  test("改写过的情节取新的", () => {
    const h = setup();
    const old = h.episode("2026-10-15T10:00:00", "旧的");
    h.store.append({ kind: "episode", class: "self", source: "agent", at: old.at, payload: { text: "新的" }, links: [{ to: old.id, rel: "revises" }] });
    expect(pendingGists(h.store)[0].source.map((s) => s.text)).toEqual(["新的"]);
  });
});

describe("闸", () => {
  test("span、key 格式、空、超长、没过完：拒", () => {
    const h = setup("2026-10-16T09:00:00");
    const bad: Record<string, unknown>[] = [
      { span: "year", key: "2026", text: "x" },
      { span: "day", key: "10-15", text: "x" },
      { span: "week", key: "2026-42", text: "x" },
      { span: "day", key: "2026-10-15", text: " " },
      { span: "day", key: "2026-10-15", text: "字".repeat(301) },
      { span: "day", key: "2026-10-16", text: "今天还没完" },
      { span: "week", key: "2026-W42", text: "这周还没完" },
      { span: "month", key: "2026-10", text: "这月还没完" },
    ];
    for (const b of bad) expect(() => writeGist(h.store, b)).toThrow(GistError);
    expect(writeGist(h.store, { span: "day", key: "2026-10-15", text: "字".repeat(300) })).toMatchObject({ key: "2026-10-15" });
    expect(writeGist(h.store, { span: "week", key: "2026-W41", text: "上周" })).toMatchObject({ key: "2026-W41" });
  });

  test("不走上报口；REST 拒了给 400", async () => {
    const h = setup();
    expect((await h.post("/v1/events", { kind: "gist", source: "agent", payload: { span: "day", key: "2026-10-15", text: "x" } })).status).toBe(400);
    expect((await h.post("/v1/gist", { span: "day", key: "2026-10-16", text: "x" })).status).toBe(400);
    expect((await h.post("/v1/gist", { span: "day", key: "2026-10-15", text: "昨天" })).status).toBe(200);
  });
});

describe("接着往下过", () => {
  test("馆藏与书架 → 月 → 周 → 天 → 最近的情节；天梗概之后的情节才放；同一段后写的算数", () => {
    const h = setup("2026-11-12T09:00:00");
    writeGist(h.store, { span: "month", key: "2026-09", text: "九月" });
    writeGist(h.store, { span: "week", key: "2026-W44", text: "W44" });
    writeGist(h.store, { span: "day", key: "2026-11-10", text: "十号旧" });
    writeGist(h.store, { span: "day", key: "2026-11-10", text: "十号" });
    h.episode("2026-11-10T10:00:00", "十号的情节（已在天梗概里）");
    h.episode("2026-11-11T10:00:00", "十一号的情节");
    h.episode("2026-11-12T08:00:00", "今天的情节");
    expect(renderContinuity(h.store)).toBe(
      [
        "【馆藏与书架】",
        "馆藏：原始记录 0 条 · 情节 3 条 · 梗概：天 1 / 周 1 / 月 1",
        "书架：事实 0 · 明说的规矩 0 · 规律 0 · 镜子 0 · 留意 0 · 关系 0",
        "",
        "【月】",
        "2026-09：九月",
        "",
        "【周】",
        "2026-W44：W44",
        "",
        "【天】",
        "11-10：十号",
        "",
        "【最近的情节】",
        "11-11",
        "十一号的情节",
        "11-12（今天）",
        "今天的情节",
      ].join("\n"),
    );
  });

  test("情节从新往旧取到预算；说明少放了几条", () => {
    const h = setup();
    for (let i = 0; i < 5; i++) h.episode(`2026-10-16T0${i}:00:00`, `${i}`.repeat(10));
    expect(renderContinuity(h.store, { days: 7, weeks: 4, months: 12, episodeChars: 25 })).toBe(
      [
        "【馆藏与书架】",
        "馆藏：原始记录 0 条 · 情节 5 条 · 梗概：天 0 / 周 0 / 月 0",
        "书架：事实 0 · 明说的规矩 0 · 规律 0 · 镜子 0 · 留意 0 · 关系 0",
        "",
        "【最近的情节】",
        "（更早的 3 条没放进来，要找用 recall）",
        "10-16（今天）",
        "3".repeat(10),
        "4".repeat(10),
      ].join("\n"),
    );
  });

  test("since 去重（10-23）：开头不早于原话第一行的情节不放；带 session 才记下种子放了哪些", async () => {
    const h = setup();
    const a = h.episode("2026-10-16T06:00:00", "早上的事");
    const b = h.episode("2026-10-16T08:00:00", "原话里那段");
    const seed = seedContinuity(h.store, undefined, { since: T("2026-10-16T07:30:00") });
    expect(seed.text).toContain("早上的事");
    expect(seed.text).not.toContain("原话里那段");
    expect(seed.episodes.sort()).toEqual([a.id, b.id].sort());
    const seededCount = () => (h.store.db.query(`SELECT COUNT(*) AS n FROM events WHERE kind = 'continuity.seeded'`).get() as { n: number }).n;
    await h.get("/v1/continuity");
    expect(seededCount()).toBe(0);
    const r = await h.get(`/v1/continuity?since=${encodeURIComponent("2026-10-16T07:30:00+08:00")}&session=new`);
    expect(r.text).not.toContain("原话里那段");
    const row = h.store.db.query(`SELECT payload FROM events WHERE kind = 'continuity.seeded'`).get() as { payload: string };
    expect(JSON.parse(row.payload)).toEqual({ episodes: seed.episodes, since: T("2026-10-16T07:30:00"), session: "new" });
  });

  test("since 去重只算原话那段会话写的（10-24）：同一时段在别处写的照样放", async () => {
    const h = setup();
    const ep = (at: string, text: string, session: string) =>
      h.store.append({ kind: "episode", class: "self", source: "agent", at: T(at), payload: { text, session } });
    ep("2026-10-16T08:00:00", "原话里那段", "old");
    ep("2026-10-16T08:30:00", "工位上写的", "cc");
    const seed = seedContinuity(h.store, undefined, { since: T("2026-10-16T07:30:00"), tailSession: "old" });
    expect(seed.text).not.toContain("原话里那段");
    expect(seed.text).toContain("工位上写的");
    const r = await h.get(`/v1/continuity?since=${encodeURIComponent("2026-10-16T07:30:00+08:00")}&tailSession=old`);
    expect(r.text).toContain("工位上写的");
    expect(r.text).not.toContain("原话里那段");
  });

  test("什么都没有：null", () => expect(renderContinuity(setup().store)).toBeNull());
});

describe("调度", () => {
  test("空闲 ≥ 3h 且有该写的：睡着时叫梗概；同一批不再叫；有新的一段再叫", () => {
    const h = setup("2026-10-16T09:00:00");
    h.store.append({ kind: "coldwrite.done", class: "self", source: "agent", payload: { upTo: "z", unjudged: [] } });
    h.episode("2026-10-15T10:00:00", "昨天");
    expect(tick(h.store)).toMatchObject({ wake: { by: "gist", key: "gist:2026-10-15" } });
    expect(tick(h.store)).toBeNull();
    h.episode("2026-10-16T08:00:00", "今天");
    h.set("2026-10-17T09:00:00");
    expect(tick(h.store)).toMatchObject({ wake: { by: "gist", key: "gist:2026-10-15,2026-10-16" } });
  });
});

describe("馆藏书架（Continuity）与备考（<moment>）", () => {
  test("Continuity 顶部常驻馆藏、前世、书架分类、按人；规律预警不放（10-27 撤）", () => {
    const h = setup("2026-10-18T12:00:00");
    // 1. 前世全宗记录
    h.store.append({ kind: "message.in", class: "experience", source: "past:ROY", fonds: "ROY", situation: null, at: T("2026-09-01T10:00:00"), payload: { from: "Joy", text: "旧话" } });
    // 2. 今生经历与书架（含前世待印证、按人归属、印证>=3零反例的待复核规律）
    const e1 = h.episode("2026-10-15T10:00:00", "证一");
    const e2 = h.episode("2026-10-16T10:00:00", "证二");
    const e3 = h.episode("2026-10-17T10:00:00", "证三");
    h.store.append({ kind: "semantic.proposed", class: "self", source: "agent", at: T("2026-10-17T11:00:00"), payload: { shelf: "fact", text: "前世事实", past: "ROY" } });
    h.store.append({ kind: "semantic.proposed", class: "self", source: "agent", at: T("2026-10-17T11:05:00"), payload: { shelf: "relation", about: "Joy", text: "和 Joy 的关系" }, links: [{ to: e1.id, rel: "evidence" }] });
    h.store.append({
      kind: "semantic.proposed",
      class: "self",
      source: "agent",
      at: T("2026-10-17T12:00:00"),
      payload: { shelf: "rule", text: "一条规律", when: "条件", then: "结果", observe: "观察" },
      links: [
        { to: e1.id, rel: "evidence" },
        { to: e2.id, rel: "evidence" },
        { to: e3.id, rel: "evidence" },
      ],
    });

    const text = renderContinuity(h.store)!;
    expect(text).toContain("馆藏：原始记录 0 条 · 情节 3 条 · 梗概：天 0 / 周 0 / 月 0 · 前世：ROY 1 条");
    expect(text).toContain("书架：事实 1 · 明说的规矩 0 · 规律 1 · 镜子 0 · 留意 0 · 关系 1（含前世待印证 1 条）；按人：Joy 1");
    expect(text).not.toContain("预警");
  });

  test("<moment> 备考：只报后台失败，恢复了报一句；旧会话未写 / 梗概未写 / 静默缺口 / 书架积压不报（10-27）", async () => {
    const h = setup("2026-10-14T10:00:00");
    h.store.setSituation({ harness: "soma", session: "S1" }, "soma", T("2026-10-14T10:00:00"));
    intake(h.store, { kind: "message.in", source: "soma", payload: { from: "Joy", text: "早" }, at: T("2026-10-14T10:01:00") });
    expect((await h.get("/v1/now?session=S1")).text).not.toContain("备考");

    // 新会话 S2，隔了 26 小时，S1 没写情节，攒了 5 条情节没整理：都不报
    h.set("2026-10-15T12:30:00");
    h.store.setSituation({ harness: "soma", session: "S2" }, "soma", T("2026-10-15T12:30:00"));
    intake(h.store, { kind: "message.in", source: "soma", payload: { from: "Joy", text: "在吗" }, at: T("2026-10-15T12:30:00") });
    for (let i = 0; i < 5; i++) h.episode(`2026-10-15T11:0${i}:00`, `新情节 ${i}`);
    const quiet = (await h.get("/v1/now?session=S2")).text as string;
    expect(quiet).not.toContain("备考");
    expect(quiet).not.toContain("还没写进记忆");

    // 后台整理失败：报
    h.store.syslog("wake.run", { key: "tidy:1", error: "timeout" });
    expect((await h.get("/v1/now?session=S2")).text).toContain("备考：后台整理失败于 10-15 12:30");
    // 没变不重报
    expect((await h.get("/v1/now?session=S2")).text).not.toContain("备考");
    // 交回整理：报一句恢复了
    h.store.append({ kind: "coldwrite.done", class: "self", source: "agent", at: T("2026-10-15T12:31:00"), payload: { upTo: "z", unjudged: [] } });
    expect((await h.get("/v1/now?session=S2")).text).toContain("备考：后台的活恢复了");
  });
});
