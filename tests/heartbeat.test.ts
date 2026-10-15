/**
 * 心跳的确定性考卷（notes/plan/m5.md §七.1）：什么时候叫、为什么叫、叫不叫得动、递没递到、账记没记对。
 * 只考系统；它醒了写什么，不考。不跑 claude -p。
 */
import { describe, expect, test } from "bun:test";
import { EventStore } from "../src/store/events.ts";
import { Projections } from "../src/store/projections.ts";
import { intake } from "../src/archive/intake.ts";
import { experienceProjector, readExperience } from "../src/archive/experience.ts";
import { createApp } from "../src/server/app.ts";
import { birth } from "../src/self/self.ts";
import { decide, tick, logRun, type State } from "../src/heartbeat/scheduler.ts";

const T = (s: string) => Date.parse(`${s}+08:00`);
const MIN = 60_000;
const HOUR = 3600_000;
const DAY = 86_400_000;
const JSON_H = { "content-type": "application/json" };

function setup(start = "2026-10-15T08:00:00") {
  let clock = T(start);
  const store = new EventStore(":memory:", { now: () => clock });
  const projections = new Projections(store);
  projections.register(experienceProjector);
  projections.live();
  const app = createApp({ store, projections });
  const get = async (path: string) => (await app.request(path)).json();
  const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers: JSON_H, body: JSON.stringify(body) });
  const ok = async (path: string, body: unknown) => {
    const r = await post(path, body);
    const j = await r.json();
    if (r.status !== 200) throw new Error(`${path} 被拒：${j.error}`);
    return j;
  };
  const sit = (session: string, harness = "soma") => store.setSituation({ harness, session }, harness);
  const her = (text: string) => intake(store, { kind: "message.in", source: "soma", payload: { from: "Joy", text } });
  const me = (text: string) => intake(store, { kind: "message.out", source: "soma", payload: { text } });
  const episode = () => store.append({ kind: "episode", class: "self", source: "agent", payload: { text: "一件事" } });
  const set = (t: string) => (clock = T(t));
  const pass = (ms: number) => (clock += ms);
  const now = async () => (await get("/v1/now")).text as string;
  const ledger = () => store.readSyslog({ kind: "wake", limit: 1000 }).reverse().map((e) => e.detail as Record<string, unknown>);
  return { store, app, get, post, ok, sit, her, me, episode, set, pass, now, ledger, clock: () => clock };
}

/** 一段聊天，然后静下来：不算醒着，也没有要补写、要整理的 */
function quietSince(h: ReturnType<typeof setup>, at: string) {
  h.set(at);
  h.sit("S1");
  h.her("在吗");
  h.me("在");
  cover(h);
}

/** 情节写到 S1 最后一条（没有要补写的），并整理过（没有要整理的） */
function cover(h: ReturnType<typeof setup>) {
  const last = h.store.db.query(`SELECT MAX(id) AS id FROM events`).get() as { id: string };
  h.store.append({ kind: "episode", class: "self", source: "agent", payload: { text: "写到这", session: "S1", upTo: last.id } });
  h.store.append({ kind: "coldwrite.done", class: "self", source: "agent", payload: { upTo: last.id, unjudged: [] } });
}

describe("纯函数 decide", () => {
  const base: State = { awake: false, homeRunning: false, paused: false, budgetLeft: 3, candidates: [{ by: "alarm", key: "alarm:a" }] };
  test("醒着、家里正在跑：不叫", () => {
    expect(decide({ ...base, awake: true })).toBeNull();
    expect(decide({ ...base, homeRunning: true })).toBeNull();
  });
  test("暂停：跳过（记 paused）；额度只管它约的", () => {
    expect(decide({ ...base, paused: true })).toEqual({ skip: base.candidates[0], reason: "paused" });
    expect(decide({ ...base, budgetLeft: 0 })).toEqual({ skip: base.candidates[0], reason: "budget" });
    expect(decide({ ...base, budgetLeft: 0, candidates: [{ by: "tidy", key: "tidy:x" }] })).toEqual({ wake: { by: "tidy", key: "tidy:x" } });
  });
  test("没候选：null", () => expect(decide({ ...base, candidates: [] })).toBeNull());
});

describe("作息的闸", () => {
  test("过去的闹钟、看不懂的 HH:MM、没 why、心跳太密、多余的项：拒", async () => {
    const h = setup();
    const bad = [
      { schedule: { alarms: [{ at: "2026-10-15T07:00", note: "x" }] }, why: "w" },
      { schedule: { alarms: [{ at: "下午三点", note: "x" }] }, why: "w" },
      { schedule: { alarms: [{ at: "2026-10-15T15:00" }] }, why: "w" },
      { schedule: { daily: [{ at: "9:00" }] }, why: "w" },
      { schedule: { daily: [{ at: "25:00" }] }, why: "w" },
      { schedule: { heartbeat: { everyMin: 5 } }, why: "w" },
      { schedule: { mood: "x" }, why: "w" },
      { schedule: {}, why: " " },
    ];
    for (const b of bad) expect((await h.post("/v1/schedule", b)).status).toBe(400);
  });

  test("收下：本地时间解析、按时间排、给 id；GET 看得到下次和额度", async () => {
    const h = setup();
    const r = await h.ok("/v1/schedule", { schedule: { alarms: [{ at: "2026-10-15T15:00", note: "看看她回了没" }, { at: T("2026-10-15T09:00:00"), note: "早" }], daily: [{ at: "21:00", note: "写日记" }] }, why: "排一下" });
    expect(r.schedule.alarms.map((a: { at: number }) => a.at)).toEqual([T("2026-10-15T09:00:00"), T("2026-10-15T15:00:00")]);
    const s = await h.get("/v1/schedule");
    expect(s.next).toMatchObject({ by: "alarm", note: "早" });
    expect(s.budget).toEqual({ used: 0, of: 3 });
    expect(s.settings).toEqual({ paused: false, wakeBudget: 3, heartbeat: false });
  });

  test("schedule.changed / diary / due 不走上报口", () => {
    const h = setup();
    expect(() => intake(h.store, { kind: "schedule.changed", source: "agent", payload: { schedule: {} } })).toThrow("不走上报");
    expect(() => intake(h.store, { kind: "diary", source: "agent", payload: { doc: { hash: "x" } } })).toThrow("不走上报");
    expect(() => intake(h.store, { kind: "due", source: "x", payload: { by: "alarm", key: "k" } })).toThrow("不走上报");
  });

  test("出生前的作息不带过去", async () => {
    const h = setup();
    await h.ok("/v1/schedule", { schedule: { alarms: [{ at: "2026-10-15T09:00", note: "x" }] }, why: "w" });
    cover(h);
    birth(h.store);
    expect((await h.get("/v1/schedule")).schedule).toBeNull();
  });
});

describe("闹钟", () => {
  test("不醒着：到点叫醒在家；家里取 <now> 时写 due、只带一次；响过就不在作息里；额度记一次", async () => {
    const h = setup();
    quietSince(h, "2026-10-15T08:00:00");
    await h.ok("/v1/schedule", { schedule: { alarms: [{ at: "2026-10-15T15:00", note: "她说三点前给答复" }] }, why: "等她" });
    cover(h);
    h.set("2026-10-15T14:59:00");
    expect(tick(h.store)).toBeNull();
    h.set("2026-10-15T15:00:00");
    expect(tick(h.store)).toEqual({ wake: { by: "alarm", key: expect.stringMatching(/^alarm:/), note: "她说三点前给答复", due: T("2026-10-15T15:00:00") } });
    // 家：处境换到 home、写 woke、取 <now>
    h.sit("H1", "home");
    intake(h.store, { kind: "woke", source: "home", payload: { by: "alarm" } });
    const n = await h.now();
    expect(n).toContain("刚发生：\n- 闹钟（约在 15:00）：她说三点前给答复");
    expect(await h.now()).not.toContain("刚发生");
    expect(h.store.list({ kinds: ["due"] })).toHaveLength(1);
    expect((await h.get("/v1/schedule")).schedule.alarms).toEqual([]);
    expect(h.ledger().map((l) => l.decided)).toEqual(["woke"]); // 叫醒后递到，不再记一次 delivered
    expect((await h.get("/v1/schedule")).budget.used).toBe(1);
    expect(readExperience(h.store.db, {}).map((l) => l.text)).toContain("（闹钟）她说三点前给答复");
  });

  test("醒着：不叫，下次取 <now> 时递进去；不花额度", async () => {
    const h = setup();
    quietSince(h, "2026-10-15T08:00:00");
    await h.ok("/v1/schedule", { schedule: { alarms: [{ at: "2026-10-15T15:00", note: "三点了" }] }, why: "w" });
    cover(h);
    h.set("2026-10-15T14:50:00");
    h.her("我回来了");
    h.set("2026-10-15T15:05:00");
    expect(tick(h.store)).toBeNull();
    expect(await h.now()).toContain("- 闹钟（约在 15:00）：三点了");
    expect(h.ledger()).toEqual([expect.objectContaining({ by: "alarm", decided: "delivered" })]);
    expect((await h.get("/v1/schedule")).budget.used).toBe(0);
    h.set("2026-10-15T16:00:00");
    expect(tick(h.store)).toBeNull(); // 递过就不再叫
  });

  test("醒着但 30 分钟没取 <now>：回到在家叫醒", async () => {
    const h = setup();
    quietSince(h, "2026-10-15T08:00:00");
    await h.ok("/v1/schedule", { schedule: { alarms: [{ at: "2026-10-15T15:00", note: "x" }] }, why: "w" });
    cover(h);
    h.set("2026-10-15T14:50:00");
    h.her("在吗");
    h.set("2026-10-15T15:10:00");
    expect(tick(h.store)).toBeNull();
    h.set("2026-10-15T15:21:00");
    expect(tick(h.store)).toMatchObject({ wake: { by: "alarm" } });
  });
});

describe("暂停与额度", () => {
  test("暂停：家里不叫、记一次 paused；递进去照旧", async () => {
    const h = setup();
    quietSince(h, "2026-10-15T08:00:00");
    await h.ok("/v1/settings", { paused: true });
    await h.ok("/v1/schedule", { schedule: { alarms: [{ at: "2026-10-15T15:00", note: "x" }] }, why: "w" });
    cover(h);
    h.set("2026-10-15T15:00:00");
    expect(tick(h.store)).toMatchObject({ skip: { by: "alarm" }, reason: "paused" });
    expect(tick(h.store)).toBeNull();
    h.her("在吗"); // 有人找它，它醒了：到点的事照样递
    const n = await h.now();
    expect(n).toContain("暂停中");
    expect(n).toContain("- 闹钟（约在 15:00）：x");
  });

  test("额度用完：它约的不醒、记 budget；整理照叫；第二天重置", async () => {
    const h = setup();
    quietSince(h, "2026-10-14T20:00:00");
    h.set("2026-10-15T08:00:00");
    await h.ok("/v1/settings", { wakeBudget: 1 });
    await h.ok("/v1/schedule", { schedule: { alarms: [{ at: "2026-10-15T09:00", note: "一" }, { at: "2026-10-15T09:30", note: "二" }] }, why: "w" });
    cover(h);
    for (let i = 0; i < 5; i++) h.episode();
    expect(tick(h.store)).toMatchObject({ wake: { by: "tidy" } }); // 有活，不花额度
    h.set("2026-10-15T09:00:00");
    expect(tick(h.store)).toMatchObject({ wake: { by: "alarm", note: "一" } });
    h.set("2026-10-15T09:30:00");
    expect(tick(h.store)).toMatchObject({ skip: { by: "alarm", note: "二" }, reason: "budget" });
    expect(tick(h.store)).toBeNull();
    expect((await h.get("/v1/schedule")).budget).toEqual({ used: 1, of: 1 });
    h.set("2026-10-16T09:00:00");
    expect((await h.get("/v1/schedule")).budget).toEqual({ used: 0, of: 1 });
  });

  test("设置：缺省、改了记系统日志、乱填拒", async () => {
    const h = setup();
    expect(await h.get("/v1/settings")).toEqual({ paused: false, wakeBudget: 3, heartbeat: false });
    await h.ok("/v1/settings", { wakeBudget: 5 });
    expect(await h.get("/v1/settings")).toEqual({ paused: false, wakeBudget: 5, heartbeat: false });
    expect(h.store.readSyslog({ kind: "param.changed" })[0].detail).toMatchObject({ name: "settings", old: { wakeBudget: 3 }, value: { wakeBudget: 5 } });
    for (const b of [{ wakeBudget: -1 }, { wakeBudget: 1.5 }, { paused: "yes" }, { mood: 1 }]) expect((await h.post("/v1/settings", b)).status).toBe(400);
  });
});

describe("整理", () => {
  test("空闲 ≥ 3h 且新情节 ≥ 5：叫；4 条不叫；叫过同一批不再叫", () => {
    const h = setup();
    quietSince(h, "2026-10-15T08:00:00");
    for (let i = 0; i < 4; i++) h.episode();
    h.set("2026-10-15T12:00:00");
    expect(tick(h.store)).toBeNull();
    h.episode();
    h.set("2026-10-15T10:59:00");
    expect(tick(h.store)).toBeNull(); // 没空闲 3 小时（最后一句在 08:00，10:59 还不到）
    h.set("2026-10-15T11:01:00");
    expect(tick(h.store)).toMatchObject({ wake: { by: "tidy" } });
    h.pass(10 * MIN);
    expect(tick(h.store)).toBeNull(); // 没交也不每分钟再醒
    h.episode();
    expect(tick(h.store)).toMatchObject({ wake: { by: "tidy" } }); // 有了新情节，是新的一批
  });

  test("距上次整理 ≥ 3 天：有一条新情节就叫", () => {
    const h = setup();
    quietSince(h, "2026-10-10T08:00:00");
    h.episode();
    h.set("2026-10-12T08:00:00");
    expect(tick(h.store)).toBeNull();
    h.set("2026-10-13T08:01:00");
    expect(tick(h.store)).toMatchObject({ wake: { by: "tidy" } });
  });
});

describe("家里的动静不算醒着", () => {
  test("家刚跑完：下一个候选不用等 30 分钟", () => {
    const h = setup();
    h.set("2026-10-15T08:00:00");
    h.sit("S2");
    h.her("一");
    h.sit("S3");
    h.her("二");
    h.set("2026-10-15T11:30:00");
    expect(tick(h.store)).toMatchObject({ wake: { by: "catchup", session: "S2" } });
    h.sit("H1", "home");
    h.me("补写完了");
    h.pass(MIN);
    expect(tick(h.store)).toMatchObject({ wake: { by: "catchup", session: "S3" } });
  });
});

describe("补写", () => {
  test("会话 ≥ 3h 没动静、还剩没写的：叫，带会话；先于整理；家里的会话不算", () => {
    const h = setup();
    h.set("2026-10-15T08:00:00");
    h.sit("H0", "home");
    h.me("家里随便想想"); // 家里的会话：不触发补写
    h.sit("S2");
    h.her("昨晚睡得好吗");
    h.me("还行");
    for (let i = 0; i < 5; i++) h.episode();
    h.set("2026-10-15T10:59:00");
    expect(tick(h.store)).toBeNull();
    h.set("2026-10-15T11:01:00");
    expect(tick(h.store)).toEqual({ wake: { by: "catchup", key: expect.stringMatching(/^catchup:S2:/), session: "S2", lines: 2 } });
    expect(tick(h.store)).toMatchObject({ wake: { by: "tidy" } });
    expect(tick(h.store)).toBeNull();
  });
});

describe("心跳", () => {
  test("开关关着：写了不生效，<now> 里注明；开了从较晚者算起", async () => {
    const h = setup();
    quietSince(h, "2026-10-15T08:00:00");
    await h.ok("/v1/schedule", { schedule: { heartbeat: { everyMin: 60 } }, why: "给自己留点时间" });
    cover(h);
    h.set("2026-10-15T12:00:00");
    expect(tick(h.store)).toBeNull();
    expect(await h.now()).toContain("心跳暂未开放，写了不生效");
    await h.ok("/v1/settings", { heartbeat: true });
    h.set("2026-10-15T08:30:00");
    h.her("又来了"); // 她 08:30 找过 → 09:30 才到
    h.set("2026-10-15T09:29:00");
    expect(tick(h.store)).toBeNull();
    h.set("2026-10-15T09:31:00");
    expect(tick(h.store)).toMatchObject({ wake: { by: "heartbeat" } });
    intake(h.store, { kind: "woke", source: "home", payload: { by: "heartbeat" } });
    h.pass(30 * MIN);
    expect(tick(h.store)).toBeNull();
    h.pass(31 * MIN);
    expect(tick(h.store)).toMatchObject({ wake: { by: "heartbeat" } });
  });
});

describe("定点", () => {
  test("写作息之前的点不当场响；之后到点叫；每天一次", async () => {
    const h = setup();
    quietSince(h, "2026-10-15T08:00:00");
    await h.ok("/v1/schedule", { schedule: { daily: [{ at: "07:00", note: "早" }, { at: "21:00", note: "写日记" }] }, why: "w" });
    cover(h);
    h.set("2026-10-15T20:00:00");
    expect(tick(h.store)).toBeNull();
    h.set("2026-10-15T21:00:00");
    expect(tick(h.store)).toMatchObject({ wake: { by: "daily", note: "写日记" } });
    h.sit("H1", "home");
    intake(h.store, { kind: "woke", source: "home", payload: { by: "daily" } });
    expect(await h.now()).toContain("- 定点（约在 21:00）：写日记");
    h.set("2026-10-16T07:00:00");
    expect(tick(h.store)).toMatchObject({ wake: { by: "daily", note: "早" } });
  });
});

describe("<now> 与账本", () => {
  test("作息一行：下次、额度；没写作息不出现", async () => {
    const h = setup();
    quietSince(h, "2026-10-15T08:00:00");
    expect(await h.now()).not.toContain("作息");
    await h.ok("/v1/schedule", { schedule: { alarms: [{ at: "2026-10-15T15:00", note: "看看" }] }, why: "w" });
    cover(h);
    expect(await h.now()).toContain("作息：下次 10-15 15:00（闹钟：看看） · 今天额度 0/3");
  });

  test("家跑完记下留下了什么；按天汇总", async () => {
    const h = setup();
    quietSince(h, "2026-10-15T08:00:00");
    await h.ok("/v1/schedule", { schedule: { alarms: [{ at: "2026-10-15T15:00", note: "x" }] }, why: "w" });
    cover(h);
    h.set("2026-10-15T15:00:00");
    const d = tick(h.store) as { wake: { key: string } };
    h.sit("H1", "home");
    await h.ok("/v1/diary", { text: "今天三点醒了一次。", title: "三点" });
    expect(logRun(h.store, d.wake.key, { session: "H1", costUsd: 0.1, ms: 30_000 })).toEqual({ episodes: 0, shelf: 0, diary: 1, prompt: 0, schedule: 0 });
    const w = await h.get("/v1/wakes");
    expect(w.days).toEqual([{ day: "2026-10-15", woke: 1, delivered: 0, skipped: 0, by: { alarm: 1 }, costUsd: 0.1, empty: 0 }]);
    expect(w.entries[0].run.produced.diary).toBe(1);
    expect(readExperience(h.store.db, {}).map((l) => l.text)).toContainEqual(expect.stringMatching(/^我写了日记《三点》\[\^\w{8}\]$/));
  });
});
