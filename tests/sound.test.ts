/**
 * 自己的声音的确定性考卷（notes/plan/m8.md §三、M8b）：歌单、虚的播放器、递什么、一起听、音频特征。
 * 网易云换成假的；不跑模型、不出声。
 */
import { describe, expect, test } from "bun:test";
import { EventStore } from "../src/store/events.ts";
import { Projections } from "../src/store/projections.ts";
import { intake } from "../src/archive/intake.ts";
import { experienceProjector, readExperience } from "../src/archive/experience.ts";
import { createApp } from "../src/server/app.ts";
import { nowPlaying, deliverSound, type SoundDeps } from "../src/perception/sound.ts";
import { parseLrc, type MusicSource, type Track } from "../src/perception/netease.ts";
import { analyzePcm, describeSection, RATE } from "../src/perception/features.ts";
import { openHouse } from "../src/house/house.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const T = (s: string) => Date.parse(`${s}+08:00`);
const JSON_H = { "content-type": "application/json" };
const SONGS: Track[] = [
  { id: "1", title: "晴天", artist: "周杰伦", duration: 60 },
  { id: "2", title: "夜曲", artist: "周杰伦", duration: 120 },
  { id: "3", title: "纯音乐", artist: "某人", duration: 30 },
];
const LRC: Record<string, string> = {
  "1": "[00:00.00]作词 : 周杰伦\n[00:05.00]故事的小黄花\n[00:10.00]从出生那年就飘着\n[00:20.00]童年的荡秋千\n[00:40.00]随记忆一直晃到现在",
  "2": "[00:03.00]一群嗜血的蚂蚁\n[00:08.00]被腐肉所吸引",
};
const fake: MusicSource = {
  search: async (q) => SONGS.filter((s) => `${s.title} ${s.artist}`.includes(q)),
  url: async (id) => `https://example.invalid/${id}.mp3`,
  lyric: async (id) => LRC[id],
};

function setup() {
  const clock = { t: T("2026-10-16T19:00:00") };
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
  const app = (who: "a1" | "a2") => createApp({ store: storeOf(who)!, projections: (who === "a1" ? a1 : a2).p, music: fake, storeOf, selfId: who });
  const call = async (who: "a1" | "a2", path: string, body?: unknown) => {
    const r = await app(who).request(path, body === undefined ? undefined : { method: "POST", headers: JSON_H, body: JSON.stringify(body) });
    return { status: r.status, json: (await r.json()) as any };
  };
  const ok = async (who: "a1" | "a2", path: string, body?: unknown) => {
    const r = await call(who, path, body);
    if (r.status !== 200) throw new Error(`${path} 被拒：${r.json.error}`);
    return r.json;
  };
  const deps: SoundDeps = { music: fake, storeOf };
  return { clock, a1: a1.store, a2: a2.store, call, ok, deps, pass: (s: number) => (clock.t += s * 1000) };
}

describe("歌单（以 Psyche 为准）", () => {
  test("建、加、拿掉、删；拒收", async () => {
    const h = setup();
    await h.ok("a1", "/v1/playlist", { op: "create", name: "喜欢的" });
    await h.ok("a1", "/v1/playlist", { op: "add", name: "喜欢的", query: "晴天" });
    await h.ok("a1", "/v1/playlist", { op: "add", name: "喜欢的", query: "夜曲" });
    await h.ok("a1", "/v1/playlist", { op: "add", name: "喜欢的", query: "晴天" }); // 重复加不重复
    expect((await h.ok("a1", "/v1/playlist")).playlists["喜欢的"].map((t: Track) => t.title)).toEqual(["夜曲", "晴天"]);
    await h.ok("a1", "/v1/playlist", { op: "remove", name: "喜欢的", query: "夜曲" });
    expect((await h.call("a1", "/v1/playlist", { op: "create", name: "喜欢的" })).json.error).toContain("已经有");
    expect((await h.call("a1", "/v1/playlist", { op: "add", name: "喜欢的", query: "不存在" })).json.error).toContain("没搜到");
    expect((await h.call("a1", "/v1/playlist", { op: "remove", name: "没有", query: "x" })).json.error).toContain("没有「没有」");
    await h.ok("a1", "/v1/playlist", { op: "delete", name: "喜欢的" });
    expect((await h.ok("a1", "/v1/playlist")).playlists).toEqual({});
    const lines = readExperience(h.a1.db, {}).map((l) => l.text);
    expect(lines).toContain("我建了歌单「喜欢的」");
    expect(lines).toContain("我把《夜曲》从「喜欢的」里拿掉了");
  });
});

describe("虚的播放器", () => {
  test("位置现算、歌单接着放、放完就停、stop", async () => {
    const h = setup();
    await h.ok("a1", "/v1/playlist", { op: "create", name: "l" });
    for (const q of ["晴天", "夜曲"]) await h.ok("a1", "/v1/playlist", { op: "add", name: "l", query: q });
    await h.ok("a1", "/v1/play", { playlist: "l" });
    h.pass(30);
    expect([nowPlaying(h.a1)!.track.title, nowPlaying(h.a1)!.pos]).toEqual(["晴天", 30]);
    h.pass(40);
    expect([nowPlaying(h.a1)!.track.title, nowPlaying(h.a1)!.pos, nowPlaying(h.a1)!.index]).toEqual(["夜曲", 10, 1]);
    h.pass(200);
    expect(nowPlaying(h.a1)).toBeNull();
    await h.ok("a1", "/v1/play", { query: "晴天" });
    await h.ok("a1", "/v1/stop", {});
    expect(nowPlaying(h.a1)).toBeNull();
    expect((await h.call("a1", "/v1/stop", {})).json.error).toContain("没在放");
  });
});

describe("递：这段时间听到的", () => {
  test("在放的、唱过的（去掉作词行、最多 8 行）、放完的；没在放就不报", async () => {
    const h = setup();
    h.a1.setSituation({ harness: "soma", session: "s1" }, "soma");
    expect(await deliverSound(h.a1, h.deps, "s1")).toBeNull();
    await h.ok("a1", "/v1/play", { query: "晴天" });
    h.pass(12);
    const first = (await deliverSound(h.a1, h.deps, "s1"))!;
    expect(first.split("\n")).toEqual(["这段时间听到的：", "- 正在放：《晴天》周杰伦，0:12 / 1:00", "- 刚唱过：故事的小黄花 / 从出生那年就飘着"]);
    h.pass(60);
    const next = (await deliverSound(h.a1, h.deps, "s1"))!;
    expect(next).toBe("这段时间听到的：\n- 放完了：《晴天》周杰伦"); // 单曲放完就停
    expect(await deliverSound(h.a1, h.deps, "s1")).toBeNull();
    // 经历里就是递出去的那几行
    expect(readExperience(h.a1.db, {}).map((l) => l.text)).toContain(next);
  });

  test("一起听：戴上 a2 的耳机后听到的是 a2 的；a2 那边知道有人戴上 / 摘下", async () => {
    const h = setup();
    await h.ok("a2", "/v1/play", { query: "夜曲" });
    await h.ok("a1", "/v1/listen/with", { host: "a2" });
    h.pass(9);
    const heard = (await deliverSound(h.a1, h.deps, "s1"))!;
    expect(heard).toContain("你戴着 a2 的一只耳机");
    expect(heard).toContain("正在放：《夜曲》周杰伦，0:09");
    expect(heard).toContain("一群嗜血的蚂蚁 / 被腐肉所吸引");
    expect(await deliverSound(h.a2, h.deps, "s2")).toContain("a1 戴上了你的一只耳机");
    await h.ok("a1", "/v1/listen/with", { host: null });
    expect(await deliverSound(h.a2, h.deps, "s2")).toContain("a1 摘下了耳机");
    expect((await h.call("a1", "/v1/listen/with", { host: "a1" })).json.error).toContain("你自己的");
    expect((await h.call("a1", "/v1/listen/with", { host: "zz" })).json.error).toContain("没有 zz");
  });

  test("Joy 在 Soma 分一只耳机：屋子记进 host 的库；能取到此刻的地址和位置", async () => {
    const h = setup();
    const house = openHouse(mkdtempSync(join(tmpdir(), "house-")), [{ id: "a1", store: h.a1 }], () => h.clock.t, fake);
    await h.ok("a1", "/v1/play", { query: "夜曲" });
    h.pass(5);
    await house.handle(new Request("http://x/v1/house/listen", { method: "POST", body: JSON.stringify({ host: "a1" }) }));
    const p = await (await house.handle(new Request("http://x/v1/house/playing/a1"))).json();
    expect([p.track.title, p.pos, p.url]).toEqual(["夜曲", 5, "https://example.invalid/2.mp3"]);
    expect(await deliverSound(h.a1, h.deps, "s1")).toContain("Joy 戴上了你的一只耳机");
  });

  test("放歌、停不走上报口", () => {
    const h = setup();
    expect(() => intake(h.a1, { kind: "played", source: "soma", payload: { tracks: [], startAt: 0 } })).toThrow("口子");
  });
});

describe("音频特征（本地算）", () => {
  test("响度分段、速度粗估、说成一行", () => {
    // 前 20 秒轻、后 20 秒响；后段带 120 BPM 的鼓点
    const pcm = new Float32Array(40 * RATE);
    for (let i = 0; i < pcm.length; i++) {
      const t = i / RATE;
      const amp = t < 20 ? 0.02 : 0.3;
      const kick = t >= 20 && t % 0.5 < 0.03 ? 0.6 : 0;
      pcm[i] = amp * Math.sin(2 * Math.PI * 220 * t) + kick * Math.sin(2 * Math.PI * 60 * t);
    }
    const f = analyzePcm(pcm);
    expect(f.sections).toEqual([0, 20]);
    expect(f.loud[0]).toBeLessThan(f.loud[5] - 10);
    expect(f.bpm === 120 || f.bpm === 60).toBe(true);
    expect(describeSection(f, 22)).toMatch(/^刚在 0:20 变响；整首里偏响/);
    expect(describeSection(f, 3)).toMatch(/^整首里偏安静/);
  });

  test("LRC：去掉作词作曲行、按时间排", () => {
    expect(parseLrc(LRC["1"]).map((l) => l.text)).toEqual(["故事的小黄花", "从出生那年就飘着", "童年的荡秋千", "随记忆一直晃到现在"]);
  });
});

test("搜歌：歌名对得上的优先；对不上要说", async () => {
  const { bestMatch, matches } = await import("../src/perception/sound.ts");
  const hits: Track[] = [
    { id: "a", title: "Foreign Time", artist: "Glass Towers", album: "Halcyon Days", duration: 200 },
    { id: "b", title: "Halcyon Days", artist: "Ellie Goulding", duration: 200 },
  ];
  expect(bestMatch("Halcyon Days", hits)!.id).toBe("b");
  expect(bestMatch("晴天 周杰伦", [{ id: "x", title: "晴天(深情版)", artist: "Lucky小爱", duration: 1 }, { id: "y", title: "晴天", artist: "周杰伦", duration: 1 }])!.id).toBe("y");
  expect(matches("Halcyon Days", hits[0])).toBe(false);
  expect(matches("Halcyon Days", hits[1])).toBe(true);
});
