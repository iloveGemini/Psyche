/**
 * 通道的确定性考卷（notes/plan/m6.md §七.1）：信什么时候递、递成什么样、什么时候叫醒、谁算额度、交接信去哪。
 * 只考系统；它看不看信、回什么，不考。不跑 claude -p，不真发外部消息。
 */
import { describe, expect, test } from "bun:test";
import { EventStore } from "../src/store/events.ts";
import { Projections } from "../src/store/projections.ts";
import { intake } from "../src/archive/intake.ts";
import { experienceProjector, readExperience } from "../src/archive/experience.ts";
import { createApp } from "../src/server/app.ts";
import { tick } from "../src/heartbeat/scheduler.ts";
import { factsNow, held, mailCandidates, type DndRule } from "../src/channel/inbox.ts";
import { emailArgs, takeEmail, takeHouseEmail, topicOf, parseWatchLine, plainBody } from "../src/channel/email.ts";
import type { PsycheEvent } from "../src/store/events.ts";

const T = (s: string) => Date.parse(`${s}+08:00`);
const MIN = 60_000;
const DAY = 86_400_000;
const JSON_H = { "content-type": "application/json" };

function setup(start = "2026-10-15T08:00:00") {
  let clock = T(start);
  const store = new EventStore(":memory:", { now: () => clock });
  const projections = new Projections(store);
  projections.register(experienceProjector);
  projections.live();
  const sent: PsycheEvent[] = [];
  const app = createApp({ store, projections, outbox: (ev) => sent.push(ev) });
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
  const tool = (name = "Bash") => intake(store, { kind: "tool.call", source: "soma", payload: { name, callId: `c${clock}` } });
  const mail = (text: string, extra: Record<string, unknown> = {}) => ok("/v1/mail/in", { from: "Joy", text, via: "email", ...extra });
  const set = (t: string) => (clock = T(t));
  const pass = (ms: number) => (clock += ms);
  const now = async (session?: string) => (await get(`/v1/now${session ? `?session=${session}` : ""}`)).text as string;
  const ledger = () => store.readSyslog({ kind: "wake", limit: 1000 }).reverse().map((e) => e.detail as Record<string, unknown>);
  const exp = () => readExperience(store.db, {}).map((l) => l.text);
  return { store, app, sent, get, post, ok, sit, her, me, tool, mail, set, pass, now, ledger, exp };
}
type H = ReturnType<typeof setup>;

/** 一段聊天后静下来，情节写到最后、整理过：不醒着，也没有补写 / 整理的活 */
function quiet(h: H, at: string) {
  h.set(at);
  h.sit("S1");
  h.her("在吗");
  h.me("在");
  cover(h);
}
function cover(h: H) {
  const last = h.store.db.query(`SELECT MAX(id) AS id FROM events`).get() as { id: string };
  h.store.append({ kind: "episode", class: "self", source: "agent", payload: { text: "写到这", session: "S1", upTo: last.id } });
  h.store.append({ kind: "coldwrite.done", class: "self", source: "agent", payload: { upTo: last.id, unjudged: [] } });
}

describe("勿扰判定（纯函数）", () => {
  const night: DndRule = { when: { time: { from: "23:00", to: "08:00" } } };
  const busy: DndRule = { when: { busy: true }, except: [{ from: "Joy", urgent: true }] };
  const f = (hhmm: string, extra: Partial<{ awake: boolean; in: string | null; busy: boolean }> = {}) => ({ hhmm, awake: false, in: null, busy: false, ...extra });
  const joy = { from: "Joy" };

  test("时段跨零点：23:00–08:00 含 23:00、02:00，不含 08:00", () => {
    expect(held([night], f("23:00"), joy)).toBe(true);
    expect(held([night], f("02:00"), joy)).toBe(true);
    expect(held([night], f("08:00"), joy)).toBe(false);
    expect(held([night], f("12:00"), joy)).toBe(false);
  });
  test("在做事：挡；例外按 from + urgent", () => {
    expect(held([busy], f("10:00", { awake: true, busy: true }), joy)).toBe(true);
    expect(held([busy], f("10:00", { awake: true, busy: true }), { from: "Joy", urgent: true })).toBe(false);
    expect(held([busy], f("10:00", { awake: true }), joy)).toBe(false);
  });
  test("一条规则里的条件都满足才算；in 限地方", () => {
    const r: DndRule = { when: { awake: true, in: "soma", time: { from: "09:00", to: "18:00" } } };
    expect(held([r], f("10:00", { awake: true, in: "soma" }), joy)).toBe(true);
    expect(held([r], f("10:00", { awake: true, in: "home" }), joy)).toBe(false);
    expect(held([r], f("19:00", { awake: true, in: "soma" }), joy)).toBe(false);
    expect(held([r], f("10:00"), joy)).toBe(false);
  });
  test("例外只写 from：她的信都放行", () => {
    expect(held([{ ...night, except: [{ from: "Joy" }] }], f("02:00"), joy)).toBe(false);
    expect(held([{ ...night, except: [{ from: "Joy" }] }], f("02:00"), { from: "Roxy" })).toBe(true);
  });
});

describe("来信与翻开", () => {
  test("来信进经历但不带正文，recall 搜不到；翻开才读：记 mail.read，经历换成全文", async () => {
    const h = setup();
    quiet(h, "2026-10-15T08:00:00");
    h.set("2026-10-15T14:02:00");
    const m = await h.mail("周末去看海吗", { subject: "周末" });
    expect(h.store.get(m.id)!.situation).toBeNull(); // 不挂在哪段会话上
    expect(h.exp()).toContain("（来信 · Joy，经邮件）还没看");
    expect((await h.get("/v1/recall?q=看海")).lines).toEqual([]);
    const list = await h.get("/v1/mail");
    expect(list.mails[0]).toMatchObject({ dir: "in", from: "Joy", read: false, chars: 6, subject: "周末" });
    expect(list.mails[0].text).toBeUndefined();

    h.sit("S2");
    h.her("我回来了");
    const r = await h.ok("/v1/mail/open", { refs: [m.archiveNo] });
    expect(r.mails[0]).toMatchObject({ text: "周末去看海吗", read: true });
    expect(h.store.list({ kinds: ["mail.read"] })).toHaveLength(1);
    expect(h.exp()).toContain("（来信 · Joy，经邮件）《周末》周末去看海吗");
    expect((await h.get("/v1/recall?q=看海")).lines).toHaveLength(1);
    await h.ok("/v1/mail/open", { refs: [m.archiveNo] }); // 再翻一次：照给全文，不再记
    expect(h.store.list({ kinds: ["mail.read"] })).toHaveLength(1);
  });

  test("来信、发信、已读都不走上报口；乱填的来信拒", async () => {
    const h = setup();
    for (const kind of ["mail.in", "mail.out", "mail.read"])
      expect(() => intake(h.store, { kind, source: "x", payload: { from: "Joy", to: "Joy", text: "x", refs: [] } })).toThrow("不走上报");
    for (const b of [{ from: "Joy", text: "", via: "email" }, { from: "", text: "x", via: "email" }, { from: "Joy", text: "x" }])
      expect((await h.post("/v1/mail/in", b)).status).toBe(400);
  });

  test("同一封外部来信报两次只记一次（ext 幂等）", async () => {
    const h = setup();
    await h.mail("一", { ext: "msg_1" });
    await h.mail("一", { ext: "msg_1" });
    expect(h.store.list({ kinds: ["mail.in"] })).toHaveLength(1);
  });
});

describe("递消息，不递信", () => {
  test("醒着也推一轮；那一轮「刚发生」报一次、不带正文；之后状态行现算到翻开为止；不花额度", async () => {
    const h = setup();
    quiet(h, "2026-10-15T08:00:00");
    h.set("2026-10-15T14:00:00");
    h.sit("S2");
    h.her("在忙吗");
    h.set("2026-10-15T14:02:00");
    const m = await h.mail("晚上吃什么");
    expect(tick(h.store)).toMatchObject({ wake: { by: "mail" } }); // 醒着也推（10-16 家 = Soma）
    const n1 = await h.now("S2");
    expect(n1).toContain("刚发生：\n- 来信（Joy · 邮件 · 14:02）");
    expect(n1).not.toContain("晚上吃什么");
    const n2 = await h.now("S2");
    expect(n2).not.toContain("刚发生");
    expect(n2).toContain("收件箱：1 封没看（Joy，最早 14:02）");
    expect(h.store.readSyslog({ kind: "mail.noticed" })).toHaveLength(1);
    await h.ok("/v1/mail/open", { refs: [m.id] });
    expect(await h.now("S2")).not.toContain("收件箱");
    h.set("2026-10-15T16:00:00");
    expect(tick(h.store)).toBeNull(); // 报过了，它知道有信，不再因这封叫醒
    expect((await h.get("/v1/schedule")).budget.used).toBe(0);
  });

  test("它自己那一轮先取了 <now>：报过了，不再推", async () => {
    const h = setup();
    quiet(h, "2026-10-15T08:00:00");
    h.set("2026-10-15T14:00:00");
    h.sit("S2");
    h.her("在吗");
    await h.mail("x");
    expect(await h.now("S2")).toContain("- 来信（Joy · 邮件 · 14:00）");
    expect(tick(h.store)).toBeNull();
  });
});

describe("不醒着：叫醒", () => {
  test("她的信推一轮叫醒，不花额度；那一轮取 <now> 报一次；叫过不再叫", async () => {
    const h = setup();
    quiet(h, "2026-10-15T08:00:00");
    await h.ok("/v1/settings", { wakeBudget: 0 });
    h.set("2026-10-15T14:02:00");
    await h.mail("在家吗");
    expect(tick(h.store)).toMatchObject({ wake: { by: "mail", key: expect.stringMatching(/^mail:/) } });
    expect(h.ledger().at(-1)).toMatchObject({ by: "mail", decided: "woke", budgeted: false });
    intake(h.store, { kind: "woke", source: "soma", payload: { by: "mail" } });
    expect(await h.now("S1")).toContain("- 来信（Joy · 邮件 · 14:02）");
    h.pass(MIN);
    expect(tick(h.store)).toBeNull();
  });

  test("它关了来信叫醒：不叫，记一次 off；之后到 <now> 里照样报", async () => {
    const h = setup();
    quiet(h, "2026-10-15T08:00:00");
    await h.ok("/v1/schedule", { schedule: { wakeOn: { mail: false } }, why: "想安静几天" });
    cover(h);
    h.set("2026-10-15T14:00:00");
    await h.mail("x");
    expect(tick(h.store)).toMatchObject({ skip: { by: "mail" }, reason: "off" });
    expect(tick(h.store)).toBeNull();
    expect(h.ledger().filter((l) => l.reason === "off")).toHaveLength(1);
    h.sit("S2");
    h.her("在吗");
    expect(await h.now("S2")).toContain("- 来信（Joy · 邮件 · 14:00）");
  });

  test("勿扰时段：挡住、记 dnd；出了时段再叫；她勾了急、命中例外就照叫", async () => {
    const h = setup();
    quiet(h, "2026-10-15T08:00:00");
    await h.ok("/v1/schedule", { schedule: { dnd: [{ when: { time: { from: "23:00", to: "08:00" } }, except: [{ from: "Joy", urgent: true }] }] }, why: "夜里别叫" });
    cover(h);
    h.set("2026-10-15T23:30:00");
    await h.mail("睡了吗");
    expect(tick(h.store)).toMatchObject({ skip: { by: "mail" }, reason: "dnd" });
    h.set("2026-10-16T02:00:00");
    expect(tick(h.store)).toMatchObject({ wake: { by: "gist" } }); // 15 号过完了：睡着时写梗概（勿扰不管）
    expect(tick(h.store)).toBeNull();
    await h.mail("急事", { urgent: true });
    expect(tick(h.store)).toMatchObject({ wake: { by: "mail" } });
    h.set("2026-10-16T08:00:00");
    expect(tick(h.store)).toMatchObject({ wake: { by: "mail" } }); // 23:30 那封：出了时段
  });

  test("暂停盖过例外：急的也不叫", async () => {
    const h = setup();
    quiet(h, "2026-10-15T08:00:00");
    await h.ok("/v1/settings", { paused: true });
    h.set("2026-10-15T14:00:00");
    await h.mail("急", { urgent: true });
    expect(tick(h.store)).toMatchObject({ skip: { by: "mail" }, reason: "paused" });
  });

  test("勿扰不管它自己约的闹钟", async () => {
    const h = setup();
    quiet(h, "2026-10-15T08:00:00");
    await h.ok("/v1/schedule", { schedule: { alarms: [{ at: "2026-10-15T23:30", note: "看月亮" }], dnd: [{ when: { time: { from: "23:00", to: "08:00" } } }] }, why: "w" });
    cover(h);
    h.set("2026-10-15T23:30:00");
    expect(tick(h.store)).toMatchObject({ wake: { by: "alarm" } });
  });

  test("勿扰的闸：看不懂的时段、未知条件、空条件、例外没 from：拒", async () => {
    const h = setup();
    const bad = [
      { dnd: [{ when: { time: { from: "9:00", to: "18:00" } } }] },
      { dnd: [{ when: { mood: "bad" } }] },
      { dnd: [{ when: {} }] },
      { dnd: [{ when: { busy: true }, except: [{ urgent: true }] }] },
      { wakeOn: { mail: "yes" } },
      { wakeOn: { phone: true } },
    ];
    for (const schedule of bad) expect((await h.post("/v1/schedule", { schedule, why: "w" })).status).toBe(400);
  });
});

describe("醒着时的勿扰：在做事就攒着", () => {
  test("busy 时不报、不显示收件箱，作息行写攒了几封；停下来 15 分钟后报", async () => {
    const h = setup();
    quiet(h, "2026-10-15T08:00:00");
    await h.ok("/v1/schedule", { schedule: { dnd: [{ when: { busy: true } }] }, why: "做事时别打断" });
    cover(h);
    h.set("2026-10-15T14:00:00");
    h.sit("S2");
    h.her("帮我看看这个");
    h.tool();
    await h.mail("x");
    const n = await h.now("S2");
    expect(n).not.toContain("来信");
    expect(n).not.toContain("收件箱");
    expect(n).toContain("勿扰中，攒了 1 封");
    h.set("2026-10-15T14:16:00");
    h.me("看完了");
    expect(await h.now("S2")).toContain("- 来信（Joy · 邮件 · 14:00）");
  });

  test("记忆工具不算在做事", async () => {
    const h = setup();
    quiet(h, "2026-10-15T08:00:00");
    await h.ok("/v1/schedule", { schedule: { dnd: [{ when: { busy: true } }] }, why: "w" });
    cover(h);
    h.set("2026-10-15T14:00:00");
    h.sit("S2");
    h.her("你记得吗");
    h.tool("mcp__psyche__recall");
    await h.mail("x");
    expect(await h.now("S2")).toContain("- 来信（Joy · 邮件 · 14:00）");
  });
});

describe("发信", () => {
  test("回信不算额度；主动写给她每封算 1；额度用完被拒；醒一次 + 写一封 = 2", async () => {
    const h = setup();
    quiet(h, "2026-10-15T08:00:00");
    await h.ok("/v1/schedule", { schedule: { alarms: [{ at: "2026-10-15T15:00", note: "x" }] }, why: "w" });
    cover(h);
    h.set("2026-10-15T15:00:00");
    expect(tick(h.store)).toMatchObject({ wake: { by: "alarm" } }); // 醒 1
    const m = await h.mail("在吗");
    await h.ok("/v1/mail/out", { to: "Joy", text: "在的", replyTo: m.archiveNo });
    expect((await h.get("/v1/schedule")).budget.used).toBe(1);
    await h.ok("/v1/mail/out", { to: "Joy", text: "想起一件事" }); // 写信 1
    expect((await h.get("/v1/schedule")).budget).toEqual({ used: 2, of: 3 });
    expect(await h.now("S1")).toContain("今天额度 2/3（醒 1 · 写信 1）");
    await h.ok("/v1/mail/out", { to: "Joy", text: "还有一件" });
    const r = await h.post("/v1/mail/out", { to: "Joy", text: "第四封" });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain("3/3");
    await h.ok("/v1/mail/out", { to: "Joy", text: "回信照发", replyTo: m.id }); // 用完了回信照样能发
  });

  test("闸：空正文、没登记的人、replyTo 不是她的来信、for 配给人、不认识的地方：拒", async () => {
    const h = setup();
    h.sit("S1");
    const m = await h.mail("x");
    const out = await h.ok("/v1/mail/out", { to: "self", text: "给之后的我" });
    const bad = [
      { to: "Joy", text: " " },
      { to: "Roxy", text: "x" },
      { to: "Joy", text: "x", replyTo: out.archiveNo },
      { to: "Joy", text: "x", replyTo: "10-15#999" },
      { to: "Joy", text: "x", for: "home" },
      { to: "self", text: "x", for: "火星" },
    ];
    for (const b of bad) expect((await h.post("/v1/mail/out", b)).status).toBe(400);
    expect(h.store.get(out.id)!.payload).toMatchObject({ to: "self", from: { harness: "soma", session: "S1" } });
    void m;
  });

  test("写给她的信交出站（交接信不交）；经历里记它写了什么；没送出去的进 <now>", async () => {
    const h = setup();
    h.sit("S1");
    h.her("在吗");
    const m = await h.mail("周末呢", { subject: "周末" });
    const r = await h.ok("/v1/mail/out", { to: "Joy", text: "好呀", replyTo: m.id });
    await h.ok("/v1/mail/out", { to: "self", text: "记得问她周末", for: "soma" });
    expect(h.sent.map((e) => e.payload)).toEqual([expect.objectContaining({ to: "Joy", text: "好呀" })]);
    expect(h.exp()).toEqual(expect.arrayContaining(["我回了 Joy 的信：好呀", "我给之后在别处的自己留了封信（给 soma）：记得问她周末"]));
    h.store.syslog("mail.sent", { ref: r.id, via: "email", ok: false, error: "网络断了" });
    expect(await h.now("S1")).toContain("没送出去的信：1 封（邮件：网络断了）");
    h.store.syslog("mail.sent", { ref: r.id, via: "email", ok: true });
    expect(await h.now("S1")).not.toContain("没送出去");
  });
});

describe("交接信", () => {
  test("不送回原处：同会话、同地方换会话都不报；到了别处报一次；翻开就算读过；不叫醒", async () => {
    const h = setup();
    quiet(h, "2026-10-15T08:00:00");
    h.set("2026-10-15T09:00:00");
    h.sit("S1");
    await h.ok("/v1/mail/out", { to: "self", text: "那件事做到一半" });
    expect(await h.now("S1")).not.toContain("交接信");
    h.sit("S2");
    h.her("新开一段");
    expect(await h.now("S2")).not.toContain("交接信");
    h.set("2026-10-20T09:00:00"); // 隔了几天：不过期
    const d = tick(h.store);
    expect(d && "wake" in d ? d.wake.by : null).not.toBe("mail"); // 写给自己的，不叫醒
    h.sit("R1", "roxy"); // 离开家，去了别处
    const n = await h.now("R1");
    expect(n).toContain("- 交接信（10-15 09:00 在 soma 写的）");
    expect(n).not.toContain("做到一半");
    expect(await h.now("R1")).toContain("交接信 1 封没看");
    const list = await h.get("/v1/mail?days=30");
    const letter = list.mails.find((x: { dir: string }) => x.dir === "handoff");
    await h.ok("/v1/mail/open", { refs: [letter.id] });
    expect(await h.now("R1")).not.toContain("交接信");
    h.sit("S3");
    h.her("回来了");
    expect(await h.now("S3")).not.toContain("交接信");
  });

  test("写明 for：只去那里，不是写信那个会话", async () => {
    const h = setup();
    h.sit("S1");
    await h.ok("/v1/mail/out", { to: "self", text: "给 Soma 下一段的我", for: "soma" });
    expect(await h.now("S1")).not.toContain("交接信");
    h.sit("R1", "roxy");
    expect(await h.now("R1")).not.toContain("交接信");
    h.sit("S2");
    expect(await h.now("S2")).toContain("- 交接信");
  });
});

describe("在哪", () => {
  test("GET /v1/where：最近活动的地方、从何时起、醒没醒着", async () => {
    const h = setup();
    h.set("2026-10-15T09:00:00");
    h.sit("S1");
    h.her("在吗");
    expect(await h.get("/v1/where")).toMatchObject({ harness: "soma", session: "S1", awake: true });
    h.set("2026-10-15T10:00:00");
    expect((await h.get("/v1/where")).awake).toBe(false);
  });
});

describe("通道设置", () => {
  test("缺省 Joy 经 Soma 留言；能改通道和地址（Joy 的设置，记系统日志）；乱填拒", async () => {
    const h = setup();
    expect(await h.get("/v1/channels")).toEqual({ channels: { Joy: ["soma-note"] }, addresses: {} });
    await h.ok("/v1/channels", { channels: { Joy: ["soma-note", "email"] }, addresses: { Joy: { email: "joy@example.com" } } });
    expect(await h.get("/v1/channels")).toEqual({ channels: { Joy: ["soma-note", "email"] }, addresses: { Joy: { email: "joy@example.com" } } });
    expect(h.store.readSyslog({ kind: "param.changed" })[0].detail).toMatchObject({ name: "channels" });
    for (const b of [{ channels: { Joy: ["pigeon"] } }, { channels: { Joy: "email" } }, { addresses: { Joy: { email: 1 } } }, { mood: 1 }]) expect((await h.post("/v1/channels", b)).status).toBe(400);
  });
});

describe("邮箱通道（agently-cli，不跑 CLI）", () => {
  test("watch 的一行：取 message；拿不到详情的跳过", () => {
    expect(parseWatchLine(`{"message":{"message_id":"msg_1","subject":"s","from":{"email":"a@b.c"},"body":"hi"}}`)).toMatchObject({ message_id: "msg_1" });
    expect(parseWatchLine(`{"fetch_error":{"type":"x"}}`)).toBeUndefined();
    expect(parseWatchLine("not json")).toBeUndefined();
  });

  test("HTML 正文去标签", () => {
    expect(plainBody({ message_id: "m", body: "<div>你好<br>明天见</div><style>x{}</style>", body_format: "HTML" })).toBe("你好\n明天见");
  });

  test("回信里引用的原信截掉（连页脚）；只在引用里夹着写的不截", () => {
    // 10-16 真信的样子（QQ 邮箱回 Agent Mail 的信）
    const qq =
      `<div>嗯？</div><div>你的边界感呢？🤨</div><div id="original-content"><br  /><div class="xm_mail_oringinal_describe"><div>------------------ 原始邮件 ------------------</div>` +
      `<div><b>发件人:</b> joylove &lt;joylove@agent.qq.com&gt;</div></div><div>看到了👀 这是我收到你的第一封信</div><div data-xmail_bot_mail_report="true">此邮件由 Agent Mail 自动发送。举报 退订</div></div>`;
    expect(plainBody({ message_id: "m", body: qq, body_format: "HTML" })).toBe("嗯？\n你的边界感呢？🤨");
    expect(plainBody({ message_id: "m", body: `<div dir="ltr">好</div><div class="gmail_quote"><div>On Thu wrote:</div><blockquote>旧的</blockquote></div>`, body_format: "HTML" })).toBe("好");
    expect(plainBody({ message_id: "m", body: "好呀\n\n------------------ 原始邮件 ------------------\n发件人: joylove\n旧的" })).toBe("好呀");
    expect(plainBody({ message_id: "m", body: "嗯\n\nOn Thu, Oct 16, 2026 at 9:37 AM joylove <joylove@agent.qq.com> wrote:\n> 旧的" })).toBe("嗯");
    expect(plainBody({ message_id: "m", body: "行\n\n在 2026年10月16日 09:37，joylove 写道：\n> 旧的" })).toBe("行");
    // 引用之上什么都没写（夹在引用里回）：整封留着
    const inline = `<div id="original-content"><div>旧的</div><div>我在这里回：好</div></div>`;
    expect(plainBody({ message_id: "m", body: inline, body_format: "HTML" })).toBe("旧的\n我在这里回：好");
    // 正文里提到「原始邮件」不算分隔
    expect(plainBody({ message_id: "m", body: "原始邮件我删了\n明天说" })).toBe("原始邮件我删了\n明天说");
  });

  test("只收她的地址：是她的 → mail.in（from Joy、幂等）；别人的只计数", async () => {
    const h = setup();
    await h.ok("/v1/channels", { channels: { Joy: ["soma-note", "email"] }, addresses: { Joy: { email: "Joy@Example.com" } } });
    const msg = { message_id: "msg_9", subject: "嗨", from: { email: "joy@example.com" }, body: "今天好累" };
    expect(takeEmail(h.store, msg)).toBe("taken");
    expect(takeEmail(h.store, msg)).toBe("taken");
    expect(h.store.list({ kinds: ["mail.in"] }).map((e) => e.payload)).toEqual([{ from: "Joy", text: "今天好累", via: "email", subject: "嗨", ext: "msg_9" }]);
    expect(takeEmail(h.store, { message_id: "msg_10", from: { email: "news@shop.com" }, body: "促销" })).toBe("ignored");
    expect(h.store.list({ kinds: ["mail.in"] })).toHaveLength(1);
    expect(h.store.readSyslog({ kind: "mail.ignored" })).toHaveLength(1);
  });

  test("发：回她的邮件用 +reply；主动写用 +send，没写主题取正文第一行", () => {
    expect(emailArgs({ to: "joy@example.com", text: "好呀", replyToExt: "msg_9" })).toEqual(["message", "+reply", "--id", "msg_9", "--body", "好呀", "--body-format", "plain", "--confirmed"]);
    expect(emailArgs({ to: "joy@example.com", text: "想起一件事\n下午那个……" })).toEqual([
      "message", "+send", "--to", "joy@example.com", "--subject", "想起一件事", "--body", "想起一件事\n下午那个……", "--body-format", "plain", "--confirmed",
    ]);
    expect(emailArgs({ to: "joy@example.com", text: "x", subject: "周末" })).toContain("周末");
  });
});

void DAY;

describe("和别处的接线", () => {
  test("「上次有人跟我说话」算翻开过的来信；没翻开的不算", async () => {
    const h = setup();
    quiet(h, "2026-10-15T08:00:00");
    h.set("2026-10-15T12:00:00");
    const m = await h.mail("中午好");
    h.set("2026-10-15T13:00:00");
    h.sit("S2");
    h.her("在吗");
    expect(await h.now("S2")).toContain("上次有人跟我说话：Joy，5 小时前");
    await h.ok("/v1/mail/open", { refs: [m.id] });
    expect(await h.now("S2")).toContain("上次有人跟我说话：Joy，1 小时前（来信，看过了）");
  });

  test("冷写材料：没翻开的信不进；这段里翻开的、哪怕信到得早也补进来", async () => {
    const { readColdwrite } = await import("../src/catalog/coldwrite.ts");
    const h = setup();
    quiet(h, "2026-10-15T08:00:00");
    h.set("2026-10-15T09:00:00");
    const early = await h.mail("早上那封");
    await h.mail("没看的那封");
    h.sit("S2");
    h.her("在吗");
    const last = h.store.db.query(`SELECT MAX(id) AS id FROM events`).get() as { id: string };
    h.store.append({ kind: "coldwrite.done", class: "self", source: "agent", payload: { upTo: last.id, unjudged: [] } });
    h.set("2026-10-15T10:00:00");
    await h.ok("/v1/mail/open", { refs: [early.id] });
    const texts = readColdwrite(h.store).material.flatMap((g) => g.lines.map((l) => l.text));
    expect(texts).toContain("（来信 · Joy，经邮件）早上那封");
    expect(texts.join("\n")).not.toContain("没看的那封");
    expect(texts.join("\n")).not.toContain("还没看");
  });
});

describe("写信那一边看（Soma 留言页）", () => {
  test("full=1：来信给全文、read 照旧是他翻没翻；不带 full 照旧不给", async () => {
    const h = setup();
    await h.mail("留给你的话");
    expect((await h.get("/v1/mail?full=1")).mails[0]).toMatchObject({ text: "留给你的话", read: false });
    expect((await h.get("/v1/mail")).mails[0].text).toBeUndefined();
    expect(h.store.list({ kinds: ["mail.read"] })).toHaveLength(0);
  });
});

describe("住户之间写信（m6.md §八）", () => {
  function house() {
    const a1 = setup();
    const a2 = setup();
    const storeOf = (id: string) => (id === "a1" ? a1.store : id === "a2" ? a2.store : undefined);
    const residentIds = () => ["a1", "a2"];
    const appOf = (h: H, id: string) => createApp({ store: h.store, projections: new Projections(h.store), storeOf, selfId: id, residentIds });
    const send = async (h: H, id: string, body: unknown) => {
      const r = await appOf(h, id).request("/v1/mail/out", { method: "POST", headers: JSON_H, body: JSON.stringify(body) });
      return { status: r.status, j: (await r.json()) as Record<string, any> };
    };
    return { a1, a2, send };
  }

  test("写给住户：进对方库（from = 寄信人、经屋里），对方 <now> 报有信、会被叫醒；记 mail.sent", async () => {
    const { a1, a2, send } = house();
    const r = await send(a1, "a1", { to: "a2", text: "分镜好了，在 project/绘本/STATE.md，轮到你上色" });
    expect(r.status).toBe(200);
    const got = a2.store.list({ kinds: ["mail.in"], fonds: "", limit: 10 });
    expect(got.map((e) => e.payload)).toEqual([{ from: "a1", text: "分镜好了，在 project/绘本/STATE.md，轮到你上色", via: "house", ext: r.j.id }]);
    expect(mailCandidates(a2.store, factsNow(a2.store, null)).map((c) => c.by)).toEqual(["mail"]);
    expect(await a2.now()).toContain("来信（a1 · 屋里");
    expect(a1.store.readSyslog({ kind: "mail.sent", limit: 10 }).map((l) => l.detail)).toEqual([{ ref: r.j.id, via: "house", ok: true }]);
  });

  test("写给住户每封都算额度，回信也算；写给自己 / 屋里没有的人 → 拒", async () => {
    const { a1, a2, send } = house();
    const first = await send(a1, "a1", { to: "a2", text: "好了" });
    expect(first.j.budget.used).toBe(1);
    const letter = a2.store.list({ kinds: ["mail.in"], fonds: "", limit: 10 })[0];
    const back = await send(a2, "a2", { to: "a1", text: "收到", replyTo: letter.id });
    expect(back.status).toBe(200);
    expect(back.j.budget.used).toBe(1);
    expect((await send(a1, "a1", { to: "a1", text: "我自己" })).status).toBe(400);
    const nobody = await send(a1, "a1", { to: "a3", text: "在吗" });
    expect(nobody.j.error).toContain("能写给 Joy、a2");
  });
});

describe("房子的一个邮箱按 @ 分（soma2.md §8.2）", () => {
  const house = async () => {
    const a1 = setup();
    const a2 = setup();
    // 她的地址只登记在 a1 那里：a2 收到也认得出是她
    await a1.ok("/v1/channels", { channels: { Joy: ["soma-note", "email"] }, addresses: { Joy: { email: "joy@example.com" } } });
    a2.store.append({ kind: "named", class: "self", source: "agent", payload: { name: "Argon" } });
    const people = [
      { id: "a1", store: a1.store, name: null },
      { id: "a2", store: a2.store, name: "Argon" },
    ];
    const inbox = (s: EventStore) => s.list({ kinds: ["mail.in"] }).map((e) => {
      const p = e.payload as { subject?: string; text: string };
      return p.subject ?? p.text;
    });
    const mail = (id: string, subject: string, body = "嗯") => ({ message_id: id, subject, from: { email: "joy@example.com" }, body });
    return { a1, a2, people, inbox, mail };
  };

  test("@ 谁给谁（认 id 也认它取的名字，可几个）；主题里的 [名字] 认回去；都没有给默认的", async () => {
    const h = await house();
    expect(takeHouseEmail(h.people, h.mail("m1", "@a2 周末"), "a1")).toEqual([{ to: "a2", result: "taken" }]);
    expect(takeHouseEmail(h.people, h.mail("m2", "两个人都看看", "@Argon @a1 这个"), "a1").map((r) => r.to)).toEqual(["a1", "a2"]);
    expect(takeHouseEmail(h.people, h.mail("m3", "Re: [a2] 想起一件事"), "a1").map((r) => r.to)).toEqual(["a2"]);
    expect(takeHouseEmail(h.people, h.mail("m4", "随便说说"), "a1").map((r) => r.to)).toEqual(["a1"]);
    // @a10 不是 @a1
    expect(takeHouseEmail(h.people, h.mail("m5", "@a10 是谁"), "a2").map((r) => r.to)).toEqual(["a2"]);
    expect(h.inbox(h.a2.store)).toEqual(["@a2 周末", "两个人都看看", "Re: [a2] 想起一件事", "@a10 是谁"]);
    expect((h.a2.store.list({ kinds: ["mail.in"] })[0].payload as { from: string }).from).toBe("Joy");
  });

  test("同一个话题上次给过谁就给谁（接住回住户 +reply 的信）；陌生地址不收", async () => {
    const h = await house();
    takeHouseEmail(h.people, h.mail("m1", "@a2 周末去哪"), "a1");
    expect(takeHouseEmail(h.people, h.mail("m2", "回复：Re: @a2 周末去哪"), "a1").map((r) => r.to)).toEqual(["a2"]);
    expect(topicOf("Re: [Argon] 回复：周末")).toBe("周末");
    expect(takeHouseEmail(h.people, { message_id: "m3", subject: "促销", from: { email: "news@shop.com" }, body: "买" }, "a1")).toEqual([{ to: "a1", result: "ignored" }]);
  });

  test("住了不止一个人：主动写的信主题前加 [名字]；回信不动", () => {
    expect(emailArgs({ to: "joy@example.com", text: "想起一件事", tag: "a2" })).toContain("[a2] 想起一件事");
    expect(emailArgs({ to: "joy@example.com", text: "好", replyToExt: "msg_1", tag: "a2" })).not.toContain("[a2] 好");
  });
});

