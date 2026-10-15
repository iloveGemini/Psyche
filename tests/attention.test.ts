/**
 * 留意与关系的确定性考卷（notes/design/attention.md §六，契约 m2.md §十、m3.md §五⅞）。
 * 只考系统按它的留意 / track 给的东西准不准；它拿到以后写什么，不考。
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore, type PsycheEvent } from "../src/store/events.ts";
import { Projections } from "../src/store/projections.ts";
import { intake } from "../src/archive/intake.ts";
import { experienceProjector } from "../src/archive/experience.ts";
import { shelfProjector, readShelf } from "../src/reading/shelf.ts";
import { readSegment, writeEpisodes } from "../src/catalog/hotwrite.ts";
import { surface } from "../src/association/surface.ts";
import { createApp } from "../src/server/app.ts";

const T = (s: string) => Date.parse(`${s}+08:00`);
const DAY = 86_400_000;
const JSON_H = { "content-type": "application/json" };

function setup(start = "2026-09-01T00:00:00") {
  let clock = T(start);
  const store = new EventStore(":memory:", { now: () => clock });
  const projections = new Projections(store);
  projections.register(experienceProjector);
  projections.register(shelfProjector);
  projections.live();
  const dir = mkdtempSync(join(tmpdir(), "psyche-prompts-"));
  writeFileSync(join(dir, "cold-write.md"), "---\nversion: 5\nauthor: system\n---\n\n睡前整理。\n");
  const app = createApp({ store, projections, promptsDir: dir });
  const sit = (session: string, at: number) => store.setSituation({ harness: "soma", session }, "soma", at);
  const her = (text: string, at: number, from = "阿禾") => intake(store, { kind: "message.in", source: "soma", payload: { from, text }, at });
  const me = (text: string, at: number) => intake(store, { kind: "message.out", source: "soma", payload: { text }, at });
  const get = async () => (await app.request("/v1/coldwrite")).json();
  const post = (body: unknown) => app.request("/v1/coldwrite", { method: "POST", headers: JSON_H, body: JSON.stringify(body) });
  const no = (ev: PsycheEvent) => ev.archiveNo.replace(/^2026-/, "");
  /** 交一批，断言收下 */
  const write = async (entries: unknown[]) => {
    const { upTo } = await get();
    const res = await post({ upTo, entries });
    if (res.status !== 200) throw new Error(`被拒：${(await res.json()).error}`);
    return (await res.json()).written as { archiveNo: string }[];
  };
  const reject = async (entries: unknown[]) => {
    const { upTo } = await get();
    const res = await post({ upTo, entries });
    expect(res.status).toBe(400);
    return (await res.json()).error as string;
  };
  return { store, app, sit, her, me, get, post, no, write, reject, set: (at: number) => (clock = at) };
}

describe("留意：门槛与候选", () => {
  test("要 text 和 watch；一件事就能写", async () => {
    const t = setup();
    t.sit("d1", T("2026-09-01T20:00:00"));
    const a = t.her("今天的咖啡好苦", T("2026-09-01T20:01:00"));
    t.set(T("2026-09-02T03:00:00"));
    expect(await t.reject([{ op: "propose", shelf: "attend", text: "是今天苦，还是她不喜欢苦？", cites: [t.no(a)] }])).toContain("watch");
    await t.write([{ op: "propose", shelf: "attend", text: "是今天苦，还是她不喜欢苦？", watch: ["咖啡", "苦"], cites: [t.no(a)] }]);
    expect(readShelf(t.store.db, { shelf: "attend" })).toHaveLength(1);
  });

  test("之后的经历按留意词挂成候选：该挂的挂上，不相干的不挂", async () => {
    const t = setup();
    t.sit("d1", T("2026-09-01T20:00:00"));
    const a = t.her("今天的咖啡好苦", T("2026-09-01T20:01:00"));
    t.set(T("2026-09-02T03:00:00"));
    const [w] = await t.write([{ op: "propose", shelf: "attend", text: "是今天苦，还是她不喜欢苦？", watch: ["咖啡", "苦"], cites: [t.no(a)] }]);
    t.sit("d2", T("2026-09-03T20:00:00"));
    const hit = t.her("换了家店的咖啡 还是苦", T("2026-09-03T20:01:00"));
    const miss = t.her("今天把分类做完了", T("2026-09-03T20:05:00"));
    t.set(T("2026-09-04T03:00:00"));
    const m = await t.get();
    const c = m.candidates.find((x: any) => x.target === w.archiveNo);
    expect(c.lines.map((l: any) => l.archiveNo)).toEqual([t.no(hit)]);
    expect(JSON.stringify(m.candidates)).not.toContain(t.no(miss));
  });
});

describe("关系：按人一条，改写链", () => {
  test("要 about；同一个人只能一条现行版；改写不能换人", async () => {
    const t = setup();
    t.sit("d1", T("2026-09-01T20:00:00"));
    const a = t.her("帮我看看这个表", T("2026-09-01T20:01:00"));
    t.set(T("2026-09-02T03:00:00"));
    expect(await t.reject([{ op: "propose", shelf: "relation", text: "她找我多半是做小账本", cites: [t.no(a)] }])).toContain("about");
    const [r1] = await t.write([{ op: "propose", shelf: "relation", about: "阿禾", text: "她找我多半是做小账本", cites: [t.no(a)] }]);
    t.sit("d2", T("2026-09-03T21:00:00"));
    const b = t.her("今天心情不好 就待一会", T("2026-09-03T21:00:00"));
    t.set(T("2026-09-04T03:00:00"));
    expect(await t.reject([{ op: "propose", shelf: "relation", about: "阿禾", text: "她心情不好也会来", cites: [t.no(b)] }])).toContain("已经有");
    expect(await t.reject([{ op: "revise", target: r1.archiveNo, about: "别人", why: "换人", cites: [t.no(b)] }])).toContain("about");
    const [r2] = await t.write([{ op: "revise", target: r1.archiveNo, why: "她心情不好时也来", text: "她心情不好的时候也会来，不说为什么，就待着。", cites: [t.no(b)] }]);
    const [cur] = readShelf(t.store.db, { shelf: "relation" });
    expect(cur).toMatchObject({ archiveNo: r2.archiveNo.replace(/^/, "2026-"), about: "阿禾", text: "她心情不好的时候也会来，不说为什么，就待着。" });
    // 改写链：新版 revises 旧版，旧版还在
    const newer = t.store.byArchiveNo(r2.archiveNo)!;
    const prev = t.store.linksFrom(newer.id).find((l) => l.rel === "revises")!.to;
    expect(t.store.get(prev)!.archiveNo).toBe(`2026-${r1.archiveNo}`);
    // 别的人可以另有一条
    const c = t.her("你好 我是小周", T("2026-09-04T21:00:00"), "小周");
    t.set(T("2026-09-05T03:00:00"));
    await t.write([{ op: "propose", shelf: "relation", about: "小周", text: "只见过一次", cites: [t.no(c)] }]);
    expect(readShelf(t.store.db, { shelf: "relation" })).toHaveLength(2);
  });
});

/** 14 天，每晚 21 点来，做几句话就走 */
function evenings(t: ReturnType<typeof setup>, days = 14, start = "2026-09-01") {
  for (let d = 0; d < days; d++) {
    const at = T(`${start}T21:00:00`) + d * DAY;
    t.sit(`s${d}`, at - 1000);
    t.her(`今天做第 ${d} 个功能`, at);
    t.me("好的，我们开始吧。", at + 60_000);
    t.her("好了 先这样", at + 20 * 60_000);
  }
}

describe("track：统计和预感只给它要的", () => {
  test("没 track：冷写材料没有统计表", async () => {
    const t = setup();
    evenings(t);
    t.set(T("2026-09-15T03:00:00"));
    expect((await t.get()).stats).toBeNull();
  });

  test("track 了：只给那个人、那几项；数值和全表一致", async () => {
    const t = setup();
    evenings(t, 7);
    const last = t.her("先这样", T("2026-09-07T21:30:00"));
    t.her("你好 我是小周", T("2026-09-07T22:00:00"), "小周");
    t.set(T("2026-09-08T03:00:00"));
    await t.write([{ op: "propose", shelf: "relation", about: "阿禾", text: "她每晚来做小账本", track: ["arrivals", "hours"], cites: [t.no(last)] }]);
    evenings(t, 7, "2026-09-08");
    t.her("又是我 小周", T("2026-09-14T22:00:00"), "小周");
    t.set(T("2026-09-15T03:00:00"));
    const m = await t.get();
    expect(m.stats.people.map((p: any) => p.who)).toEqual(["阿禾"]);
    expect(m.stats.people[0].rows.map((r: any) => r.key)).toEqual(["arrivals"]);
    expect(m.stats.people[0].hours.period).toEqual([0, 0, 0, 1]);
    const full = await (await t.app.request(`/v1/stats?from=${m.stats.period.from}&to=${m.stats.period.to}`)).json();
    const fullRow = full.people.find((p: any) => p.who === "阿禾").rows.find((r: any) => r.key === "arrivals");
    expect(m.stats.people[0].rows[0].period).toBe(fullRow.period);
  });

  test("track 只认清单里的指标，而且要有 about", async () => {
    const t = setup();
    t.sit("d1", T("2026-09-01T20:00:00"));
    const a = t.her("嗯", T("2026-09-01T20:01:00"));
    t.set(T("2026-09-02T03:00:00"));
    expect(await t.reject([{ op: "propose", shelf: "relation", about: "阿禾", text: "x", track: ["mood"], cites: [t.no(a)] }])).toContain("track");
    expect(await t.reject([{ op: "propose", shelf: "attend", text: "她来得少了？", watch: ["来"], track: ["arrivals"], cites: [t.no(a)] }])).toContain("about");
    expect(await t.reject([{ op: "propose", shelf: "fact", text: "x", about: "阿禾", track: ["arrivals"], cites: [t.no(a)] }])).toContain("track");
  });

  const wake = async (t: ReturnType<typeof setup>, at: string, session: string) => {
    t.set(T(at));
    t.sit(session, T(at));
    intake(t.store, { kind: "woke", source: "soma", payload: { by: "heartbeat" }, at: T(at) });
    return surface(t.store, undefined, { session, dry: true, seed: 1 });
  };

  test("预感：没 track 到达就不报；track 了才报", async () => {
    const t = setup();
    evenings(t);
    expect((await wake(t, "2026-09-16T22:30:00", "w1")).items.some((i) => i.source === "hunch")).toBe(false);

    const t2 = setup();
    evenings(t2, 13);
    const last = t2.her("先这样", T("2026-09-13T21:30:00"));
    t2.set(T("2026-09-14T03:00:00"));
    await t2.write([{ op: "propose", shelf: "attend", about: "阿禾", text: "她每晚都来，哪天没来我想知道", watch: ["没来"], track: ["arrivals"], cites: [t2.no(last)] }]);
    expect((await wake(t2, "2026-09-15T22:30:00", "w1")).items.find((i) => i.source === "hunch")?.text).toContain("今天晚上还没来");
  });
});

describe("反馈线：我做了什么 → 结果，一律给", () => {
  test("我连着说的几条配上她的下一条原话；情节覆盖了也给原话；没人回就是 null", async () => {
    const t = setup();
    t.sit("d1", T("2026-09-01T21:00:00"));
    t.her("室友说手机自带的就够了", T("2026-09-01T21:00:00"));
    const o1 = t.me("听起来有点泄气吧。", T("2026-09-01T21:01:00"));
    const o2 = t.me("那共享账本和手机页面你更想先做哪个？", T("2026-09-01T21:01:30"));
    const reply = t.her("算了 不想说了", T("2026-09-01T21:02:00"));
    const o3 = t.me("好。", T("2026-09-01T21:02:30"));
    const { upTo } = readSegment(t.store, "d1");
    writeEpisodes(t.store, { session: "d1", upTo, entries: [{ text: "我急着出主意，阿禾说不想说了。", cites: [t.no(o1), t.no(reply)] }] }, 1);
    t.set(T("2026-09-03T03:00:00"));
    const m = await t.get();
    // 材料里是情节，反馈线里是原话
    expect(JSON.stringify(m.material)).not.toContain("算了 不想说了");
    expect(m.feedback).toEqual([
      { acts: [o1, o2].map((e) => expect.objectContaining({ archiveNo: t.no(e), kind: "message.out" })), next: expect.objectContaining({ archiveNo: t.no(reply), text: "阿禾：算了 不想说了" }) },
      { acts: [expect.objectContaining({ archiveNo: t.no(o3) })], next: null },
    ]);
  });

  test("不受留意约束：书架空、什么都没留意也给", async () => {
    const t = setup();
    t.sit("d1", T("2026-09-01T21:00:00"));
    const o = t.me("在吗？", T("2026-09-01T21:00:00"));
    const r = t.her("在", T("2026-09-01T21:05:00"));
    t.set(T("2026-09-02T03:00:00"));
    const m = await t.get();
    expect(m.shelf).toEqual([]);
    expect(m.feedback).toEqual([{ acts: [expect.objectContaining({ archiveNo: t.no(o) })], next: expect.objectContaining({ archiveNo: t.no(r) }) }]);
  });

  test("她隔一天以上才说话，不算回应；别的会话的话也不算", async () => {
    const t = setup();
    t.sit("d1", T("2026-09-01T21:00:00"));
    t.me("明天见", T("2026-09-01T21:00:00"));
    t.sit("d2", T("2026-09-01T21:10:00"));
    t.her("（另一个会话）", T("2026-09-01T21:10:00"));
    t.sit("d1", T("2026-09-03T21:00:00"));
    t.her("我回来了", T("2026-09-03T21:00:00"));
    t.set(T("2026-09-04T03:00:00"));
    const m = await t.get();
    expect(m.feedback).toEqual([{ acts: [expect.objectContaining({ text: "我说：明天见" })], next: null }]);
  });

  test("工具：只给出错的，配上那次调用", async () => {
    const t = setup();
    t.sit("d1", T("2026-09-01T21:00:00"));
    intake(t.store, { kind: "tool.call", source: "soma", payload: { name: "Bash", callId: "c1", args: { command: "ls" } }, at: T("2026-09-01T21:00:00") });
    intake(t.store, { kind: "tool.result", source: "soma", payload: { name: "Bash", callId: "c1", ok: true, text: "a b" }, at: T("2026-09-01T21:00:01") });
    const call = intake(t.store, { kind: "tool.call", source: "soma", payload: { name: "Bash", callId: "c2", args: { command: "bun test" } }, at: T("2026-09-01T21:01:00") });
    const fail = intake(t.store, { kind: "tool.result", source: "soma", payload: { name: "Bash", callId: "c2", ok: false, text: "3 fail" }, at: T("2026-09-01T21:01:05") });
    t.set(T("2026-09-02T03:00:00"));
    const m = await t.get();
    expect(m.feedback).toEqual([{ acts: [expect.objectContaining({ archiveNo: t.no(call) })], next: expect.objectContaining({ archiveNo: t.no(fail), text: "Bash 出错：3 fail" }) }]);
  });
});
