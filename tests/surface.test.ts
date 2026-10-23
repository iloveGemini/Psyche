import { describe, expect, test } from "bun:test";
import { EventStore } from "../src/store/events.ts";
import { Projections } from "../src/store/projections.ts";
import { intake } from "../src/archive/intake.ts";
import { experienceProjector } from "../src/archive/experience.ts";
import { shelfProjector } from "../src/reading/shelf.ts";
import { grams, isIdle, keywords, surface } from "../src/association/surface.ts";
import { writeEpisodes } from "../src/catalog/hotwrite.ts";
import { hybridRecall, queryVector, rrf } from "../src/archive/recall.ts";
import { normalize, type Embedder } from "../src/archive/vectors.ts";

const T = (s: string) => Date.parse(`${s}+08:00`);
const DAY = 86_400_000;

/** 假嵌入：按几个关键字的有无组成向量，"耳机"与"退款"同一维（意思相近、字面不同） */
const fake: Embedder = {
  model: "fake",
  async embed(texts) {
    return texts.map((t) => normalize(Float32Array.from([/耳机|退款/.test(t) ? 1 : 0, /饼图/.test(t) ? 1 : 0, 0.05])));
  },
};

function setup(start = "2026-09-01T00:00:00") {
  let clock = T(start);
  const store = new EventStore(":memory:", { now: () => clock });
  const p = new Projections(store);
  p.register(experienceProjector);
  p.register(shelfProjector);
  p.live();
  const sit = (session: string, at: number) => store.append({ kind: "situation", class: "situation", source: "soma", at, payload: { harness: "soma", session } });
  const her = (text: string, at: number) => intake(store, { kind: "message.in", source: "soma", payload: { from: "阿禾", text }, at });
  const me = (text: string, at: number) => intake(store, { kind: "message.out", source: "soma", payload: { text }, at });
  /** 14 天，每晚 21 点来；每天收尾写一条情节（浮现只给情节） */
  const evenings = (days = 14) => {
    for (let d = 0; d < days; d++) {
      const t = T(start) + d * DAY + 21 * 3_600_000;
      sit(`s${d}`, t - 1000);
      const a = her(d === 3 ? "那次退了个耳机 那负数是对的" : `今天做第 ${d} 个功能`, t);
      const b = me("好的，我们开始吧。", t + 60_000);
      const text = d === 3 ? "阿禾说那笔负数是那次退了个耳机，是对的。" : `阿禾来做第 ${d} 个功能，我们开始了。`;
      writeEpisodes(store, { session: `s${d}`, upTo: b.id, entries: [{ text, cites: [a.archiveNo.slice(5), b.archiveNo.slice(5)] }] }, 1);
    }
  };
  return { store, sit, her, me, evenings, set: (at: number) => (clock = at) };
}

test("两字组：汉字两两一组，拉丁词整词小写", () => {
  expect(grams("耳机 换了 SQL")).toEqual(["耳机", "换了", "sql"]);
});

test("空档与实词：语气词、应答不算话题；两个字的实词算", () => {
  expect(["嗯 在吗", "好", "好的", "行吧", "🤣", "嗯嗯"].every(isIdle)).toBe(true);
  expect(["耳机", "算了 不想说了"].some(isIdle)).toBe(false);
  expect(keywords("那个耳机后来换了个新的")).toContain("耳机");
  expect(keywords("那个耳机后来换了个新的")).not.toContain("那个");
});

test("rrf：两边都靠前的排最前，去重", () => {
  const a = [{ eventId: "x" }, { eventId: "y" }];
  const b = [{ eventId: "y" }, { eventId: "z" }];
  expect(rrf([a, b], 3).map((r) => r.eventId)).toEqual(["y", "x", "z"]);
});

describe("浮现", () => {
  test("预感：平时晚上来、今天晚上没来 → 报；凌晨 → 不报（她这个点不来）", async () => {
    const t = setup();
    t.evenings();
    // 预感只对它 track 了到达的人报（attention.md §四；没 track 的情形见 attention.test.ts）
    t.store.append({ kind: "semantic.proposed", class: "self", source: "agent", payload: { shelf: "attend", about: "阿禾", text: "她哪天没来", watch: ["没来"], track: ["arrivals"] } });
    t.set(T("2026-09-16T22:30:00"));
    t.sit("w1", T("2026-09-16T22:30:00"));
    intake(t.store, { kind: "woke", source: "soma", payload: { by: "heartbeat" }, at: T("2026-09-16T22:30:00") });
    const r = await surface(t.store, undefined, { session: "w1", dry: true, seed: 1 });
    expect(r.mode).toBe("fresh");
    expect(r.items.find((i) => i.source === "hunch")?.text).toContain("今天晚上还没来");
    // 刚醒：上次怎么散的先想起来
    expect(r.items.some((i) => i.parts.lastTime === 1 && i.text.includes("第 13 个功能"))).toBe(true);

    t.set(T("2026-09-17T03:00:00"));
    t.sit("w2", T("2026-09-17T03:00:00"));
    intake(t.store, { kind: "woke", source: "soma", payload: { by: "heartbeat" }, at: T("2026-09-17T03:00:00") });
    const r2 = await surface(t.store, undefined, { session: "w2", dry: true, seed: 1 });
    expect(r2.items.some((i) => i.source === "hunch")).toBe(false);
  });

  test("隔了很久她回来、开口说话：她的话是线索，上次怎么散的也先想起来", async () => {
    const t = setup();
    t.evenings();
    t.set(T("2026-09-15T21:00:01"));
    t.sit("back", T("2026-09-15T21:00:00"));
    t.her("咳咳 看看这是哪里", T("2026-09-15T21:00:00"));
    const r = await surface(t.store, undefined, { session: "back", dry: true, seed: 1 });
    expect(r.mode).toBe("fresh");
    expect(r.items.some((i) => i.parts.lastTime === 1 && i.text.includes("第 13 个功能"))).toBe(true);
  });

  test("睡着时的会话不算「上次」：补写完那句汇报不当线索，上次怎么散的还是和她那段", async () => {
    const t = setup();
    t.evenings();
    t.store.append({ kind: "situation", class: "situation", source: "sleep", at: T("2026-09-15T03:00:00"), payload: { harness: "sleep", session: "z" } });
    intake(t.store, { kind: "message.out", source: "sleep", payload: { text: "补写好了，记成了一条情节。", session: "z" }, at: T("2026-09-15T03:01:00") });
    t.set(T("2026-09-15T21:00:01"));
    t.sit("back", T("2026-09-15T21:00:00"));
    t.her("咳咳 看看这是哪里", T("2026-09-15T21:00:00"));
    const r = await surface(t.store, undefined, { session: "back", dry: true, seed: 1 });
    expect(r.items.some((i) => i.parts.lastTime === 1 && i.text.includes("第 13 个功能"))).toBe(true);
    expect(r.cue).not.toContain("补写好了");
  });

  test("字面接不上、向量接得上：她说耳机，想起退款那次；本会话的原话不算", async () => {
    const t = setup();
    t.evenings();
    t.set(T("2026-09-15T21:20:00"));
    t.sit("now", T("2026-09-15T21:00:00"));
    t.her("在吗 今天想聊聊", T("2026-09-15T21:00:00"));
    t.me("在，你说。", T("2026-09-15T21:01:00"));
    t.her("后来那个退款到账了", T("2026-09-15T21:20:00"));
    const lexical = await surface(t.store, undefined, { session: "now", dry: true, seed: 1 });
    expect(lexical.items.some((i) => i.text.includes("耳机"))).toBe(false);
    const withVec = await surface(t.store, fake, { session: "now", dry: true, seed: 1 });
    expect(withVec.mode).toBe("chat");
    expect(withVec.items.some((i) => i.text.includes("耳机"))).toBe(true);
    expect(withVec.items.some((i) => i.text.includes("今天想聊聊"))).toBe(false);
  });

  test("种子里有的不浮（10-23）：放进 <continuity> 的情节、末尾原话那段都不再想起；没认领的种子归下一段会话", async () => {
    const t = setup();
    t.evenings();
    const refund = (t.store.db.query(`SELECT id FROM events WHERE kind = 'episode' AND json_extract(payload, '$.text') LIKE '%耳机%'`).get() as { id: string }).id;
    const seeded = (payload: Record<string, unknown>, at: number) => t.store.append({ kind: "continuity.seeded", class: "self", source: "psyche", situation: null, at, payload });
    const ask = async (session: string) => {
      t.set(T("2026-09-15T21:20:00"));
      t.sit(session, T("2026-09-15T21:00:00"));
      t.her("后来那个退款到账了", T("2026-09-15T21:20:00"));
      return surface(t.store, fake, { session, dry: true, seed: 1 });
    };
    // 带 session 的种子
    seeded({ episodes: [refund], since: T("2026-09-14T20:00:00"), session: "a" }, T("2026-09-15T20:59:00"));
    const a = await ask("a");
    expect(a.items.some((i) => i.text.includes("耳机"))).toBe(false);
    expect(a.items.some((i) => i.parts.lastTime === 1)).toBe(false);
    // 不带 session（Roxy）：这段会话之前最近的一条归它
    const t2 = setup();
    t2.evenings();
    const refund2 = (t2.store.db.query(`SELECT id FROM events WHERE kind = 'episode' AND json_extract(payload, '$.text') LIKE '%耳机%'`).get() as { id: string }).id;
    t2.store.append({ kind: "continuity.seeded", class: "self", source: "psyche", situation: null, at: T("2026-09-15T20:59:00"), payload: { episodes: [refund2] } });
    t2.set(T("2026-09-15T21:20:00"));
    t2.sit("b", T("2026-09-15T21:00:00"));
    t2.her("后来那个退款到账了", T("2026-09-15T21:20:00"));
    const b = await surface(t2.store, fake, { session: "b", dry: true, seed: 1 });
    expect(b.items.some((i) => i.text.includes("耳机"))).toBe(false);
    // 中间另有会话开了头：种子不是这段的
    t2.set(T("2026-09-15T22:20:00"));
    t2.sit("c", T("2026-09-15T22:00:00"));
    t2.her("后来那个退款到账了", T("2026-09-15T22:20:00"));
    const c = await surface(t2.store, fake, { session: "c", dry: true, seed: 1 });
    expect(c.items.some((i) => i.text.includes("耳机"))).toBe(true);
  });

  test("空档输入不拿内容去匹配：她回「嗯」，不浮回忆", async () => {
    const t = setup();
    t.evenings();
    t.set(T("2026-09-15T21:20:00"));
    t.sit("now", T("2026-09-15T21:00:00"));
    t.her("在吗 今天想聊聊", T("2026-09-15T21:00:00"));
    t.me("在，你说。", T("2026-09-15T21:01:00"));
    t.her("嗯", T("2026-09-15T21:20:00"));
    const r = await surface(t.store, fake, { session: "now", dry: true, seed: 1 });
    expect(r.idle).toBe(true);
    expect(r.items.filter((i) => i.source === "recall")).toEqual([]);
  });

  test("不 dry：写 surfaced（线索在事件里）；不应期内不再浮", async () => {
    const t = setup();
    t.evenings();
    t.set(T("2026-09-15T21:20:00"));
    t.sit("now", T("2026-09-15T21:19:00"));
    t.her("耳机那事还记得吗", T("2026-09-15T21:19:00"));
    const a = await surface(t.store, fake, { session: "now", seed: 1 });
    const ev = t.store.list({ kinds: ["surfaced"] });
    expect(ev.length).toBe(a.items.length);
    expect((ev[0].payload as { cue: string }).cue).toContain("耳机");
    t.me("记得。", T("2026-09-15T21:20:00"));
    t.her("耳机", T("2026-09-15T21:21:00"));
    t.set(T("2026-09-15T21:22:00"));
    const b = await surface(t.store, fake, { session: "now", dry: true, seed: 1 });
    expect(b.items.filter((i) => a.items.some((x) => x.ref === i.ref))).toEqual([]);
  });

  test("混合 recall：字面搜不到的句子，向量补上", async () => {
    const t = setup();
    t.evenings();
    const lines = await hybridRecall(t.store.db, fake, { q: "上次退款那笔" });
    expect(lines[0].text).toContain("耳机");
  });

  test("嵌入服务卡住：查询向量超时就只用字面，不干等", async () => {
    const t = setup();
    t.evenings();
    const stuck: Embedder = { model: "stuck", embed: () => new Promise(() => {}) };
    const t0 = performance.now();
    expect(await queryVector(t.store.db, stuck, "耳机", 50)).toBeNull();
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
