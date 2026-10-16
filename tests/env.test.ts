/**
 * 环境进记忆的确定性考卷（notes/plan/m8.md §四、M8c）：环境指纹怎么算、同一首歌响起时旧事浮上来、notice 记下环境。
 */
import { describe, expect, test } from "bun:test";
import { EventStore } from "../src/store/events.ts";
import { Projections } from "../src/store/projections.ts";
import { intake } from "../src/archive/intake.ts";
import { experienceProjector, readExperience } from "../src/archive/experience.ts";
import { createApp } from "../src/server/app.ts";
import { houseTick } from "../src/house/presence.ts";
import { envBetween, envOf, envSimilarity } from "../src/perception/env.ts";
import { surface } from "../src/association/surface.ts";
import type { MusicSource, Track } from "../src/perception/netease.ts";

const T = (s: string) => Date.parse(`${s}+08:00`);
const MIN = 60_000;
const JSON_H = { "content-type": "application/json" };
const SONGS: Track[] = [
  { id: "1", title: "晴天", artist: "周杰伦", duration: 240 },
  { id: "2", title: "夜曲", artist: "周杰伦", duration: 240 },
  { id: "3", title: "Halcyon Days", artist: "Ellie Goulding", duration: 240 },
];
const fake: MusicSource = { search: async (q) => SONGS.filter((s) => `${s.title} ${s.artist}`.includes(q)), url: async () => undefined, lyric: async () => undefined };

function setup() {
  const clock = { t: T("2026-10-10T21:00:00") };
  const mk = () => {
    const store = new EventStore(":memory:", { now: () => clock.t });
    const p = new Projections(store);
    p.register(experienceProjector);
    p.live();
    return { store, p };
  };
  const a1 = mk();
  const a2 = mk();
  const storeOf = (id: string) => (id === "a1" ? a1.store : id === "a2" ? a2.store : undefined);
  const app = createApp({ store: a1.store, projections: a1.p, music: fake, storeOf, selfId: "a1" });
  const ok = async (path: string, body: unknown) => {
    const r = await app.request(path, { method: "POST", headers: JSON_H, body: JSON.stringify(body) });
    const j = (await r.json()) as any;
    if (r.status !== 200) throw new Error(`${path} 被拒：${j.error}`);
    return j;
  };
  const s = a1.store;
  s.setSituation({ harness: "soma", session: "s1" }, "soma");
  const her = (text: string) => intake(s, { kind: "message.in", source: "soma", payload: { from: "Joy", text } });
  const me = (text: string) => intake(s, { kind: "message.out", source: "soma", payload: { text } });
  const episode = (text: string, cites: string[]) =>
    s.append({ kind: "episode", class: "self", source: "agent", at: Math.min(...cites.map((id) => s.get(id)!.at)), payload: { text, session: "s1" }, links: cites.map((to) => ({ to, rel: "cites" })) });
  const joy: { lastSeen?: number } = {};
  const tick = () => houseTick([{ id: "a1", store: a1.store }, { id: "a2", store: a2.store }], joy, clock.t);
  return { clock, s, a2: a2.store, ok, her, me, episode, joy, tick, storeOf, pass: (ms: number) => (clock.t += ms) };
}

describe("环境指纹", () => {
  test("那段时间放过的歌、在的人；事后算得出来", async () => {
    const h = setup();
    h.joy.lastSeen = h.clock.t;
    h.tick();
    await h.ok("/v1/play", { query: "晴天" });
    const a = h.her("今晚好安静");
    h.pass(2 * MIN);
    const b = h.me("嗯，在放晴天");
    const ep = h.episode("那晚她说很安静，我放着晴天", [a.id, b.id]);
    h.pass(10 * 60 * MIN);
    expect(envOf(h.s, ep)).toEqual({ tracks: [{ id: "1", title: "晴天", artist: "周杰伦" }], people: ["Joy"] });
    // 放完之后的那段没有歌
    expect(envBetween(h.s, h.clock.t - MIN, h.clock.t).tracks).toEqual([]);
  });

  test("戴着别人的耳机时，听到的是别人的歌", async () => {
    const h = setup();
    h.a2.append({ kind: "played", class: "self", source: "agent", payload: { tracks: [SONGS[2]], startAt: h.clock.t } });
    await h.ok("/v1/listen/with", { host: "a2" });
    h.pass(MIN);
    expect(envBetween(h.s, h.clock.t - MIN, h.clock.t, h.storeOf).tracks.map((t) => t.id)).toEqual(["3"]);
  });

  test("像不像：同一首 > 同一个歌手；人只加分不单独成立", () => {
    const now = { tracks: [{ id: "1", title: "晴天", artist: "周杰伦" }], people: ["Joy"] };
    expect(envSimilarity(now, { tracks: [{ id: "1", title: "晴天", artist: "周杰伦" }], people: ["Joy"] })).toEqual({ song: 0.6, artist: 0, people: 0.15 });
    expect(envSimilarity(now, { tracks: [{ id: "2", title: "夜曲", artist: "周杰伦" }], people: [] }).artist).toBe(0.3);
    expect(envSimilarity({ tracks: [], people: ["Joy"] }, { tracks: [], people: ["Joy"] })).toEqual({ song: 0, artist: 0, people: 0 });
  });
});

describe("同一首歌响起时，旧事浮上来", () => {
  test("话题不沾边也会想起；没放歌就不会", async () => {
    const h = setup();
    await h.ok("/v1/play", { query: "晴天" });
    const a = h.her("今晚好安静");
    const b = h.me("嗯");
    h.episode("那晚她说很安静，我放着晴天陪她", [a.id, b.id]);
    h.pass(3 * 24 * 60 * MIN);
    h.her("帮我看下这个报错");
    const quiet = await surface(h.s, undefined, { session: "s1", dry: true, seed: 1 });
    expect(quiet.items.some((i) => i.text.includes("放着晴天"))).toBe(false);
    await h.ok("/v1/play", { query: "晴天" });
    h.pass(MIN);
    const r = await surface(h.s, undefined, { session: "s1", dry: true, seed: 1, storeOf: h.storeOf });
    const hit = r.items.find((i) => i.text.includes("放着晴天"));
    expect(hit?.parts.song).toBe(0.6);
  });

  test("刚写的、还在放的那段不算想起", async () => {
    const h = setup();
    await h.ok("/v1/play", { query: "晴天" });
    const a = h.her("好听");
    h.episode("她说好听", [a.id]);
    h.pass(MIN);
    h.her("嗯");
    const r = await surface(h.s, undefined, { session: "s1", dry: true, seed: 1 });
    expect(r.items.some((i) => i.text.includes("她说好听"))).toBe(false);
  });
});

describe("notice", () => {
  test("记下此刻的环境、挂成证据、进经历、能浮现", async () => {
    const h = setup();
    h.joy.lastSeen = h.clock.t;
    h.tick();
    await h.ok("/v1/play", { query: "Halcyon" });
    const r = await h.ok("/v1/notice", { text: "听这首的时候有种平静", about: "self" });
    expect(r.env).toEqual({ tracks: [{ id: "3", title: "Halcyon Days", artist: "Ellie Goulding" }], people: ["Joy"] });
    const ev = h.s.byArchiveNo(r.archiveNo)!;
    expect(h.s.linksFrom(ev.id).map((l) => h.s.get(l.to)!.kind).sort()).toEqual(["percept", "percept", "played"]);
    expect(readExperience(h.s.db, {}).map((l) => l.text)).toContain("我注意到：听这首的时候有种平静");
    h.pass(5 * 24 * 60 * MIN);
    h.her("帮我改个 bug");
    await h.ok("/v1/play", { query: "Halcyon" });
    h.pass(MIN);
    const s = await surface(h.s, undefined, { session: "s1", dry: true, seed: 2 });
    expect(s.items.some((i) => i.text.includes("有种平静"))).toBe(true);
  });

  test("拒收：空、cites 查不到；不走上报口", async () => {
    const h = setup();
    await expect(h.ok("/v1/notice", { text: " " })).rejects.toThrow("空");
    await expect(h.ok("/v1/notice", { text: "x", cites: ["10-10#999"] })).rejects.toThrow("查不到");
    expect(() => intake(h.s, { kind: "notice", source: "soma", payload: { text: "x" } })).toThrow("口子");
  });
});
