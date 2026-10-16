/**
 * 冷写里的观察（m8.md §4.2）：以前的 notice 和后来同样环境又出现时的事摆在一起；引去写规律后不再摆。
 */
import { expect, test } from "bun:test";
import { EventStore } from "../src/store/events.ts";
import { Projections } from "../src/store/projections.ts";
import { intake } from "../src/archive/intake.ts";
import { experienceProjector } from "../src/archive/experience.ts";
import { createApp } from "../src/server/app.ts";
import { houseTick } from "../src/house/presence.ts";
import type { MusicSource, Track } from "../src/perception/netease.ts";

const T = (s: string) => Date.parse(`${s}+08:00`);
const MIN = 60_000;
const DAY = 86_400_000;
const JSON_H = { "content-type": "application/json" };
const SONGS: Track[] = [
  { id: "3", title: "Halcyon Days", artist: "Ellie Goulding", duration: 240 },
  { id: "9", title: "燃起来", artist: "某乐队", duration: 180 },
];
const fake: MusicSource = { search: async (q) => SONGS.filter((s) => `${s.title} ${s.artist}`.includes(q)), url: async () => undefined, lyric: async () => undefined };

test("观察 + 后来：同一首又响时写下的、观察的人后来放的歌；引去写规律后不再摆", async () => {
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
  const app1 = createApp({ store: a1.store, projections: a1.p, music: fake, storeOf, selfId: "a1" });
  const app2 = createApp({ store: a2.store, projections: a2.p, music: fake, storeOf, selfId: "a2" });
  const req = async (app: typeof app1, path: string, body?: unknown) => {
    const r = await app.request(path, body === undefined ? undefined : { method: "POST", headers: JSON_H, body: JSON.stringify(body) });
    const j = (await r.json()) as any;
    if (r.status !== 200) throw new Error(`${path} 被拒：${j.error}`);
    return j;
  };
  const s = a1.store;
  s.setSituation({ harness: "soma", session: "s1" }, "soma");
  const tick = () => houseTick([{ id: "a1", store: a1.store }, { id: "a2", store: a2.store }], {}, clock.t);

  await req(app1, "/v1/play", { query: "Halcyon" });
  const n1 = await req(app1, "/v1/notice", { text: "听这首的时候有种平静", about: "self" });
  const n2 = await req(app1, "/v1/notice", { text: "Argon 干活时爱放打鸡血的歌", about: "a2" });

  // 两天后又放这首，那时写了一条情节
  clock.t += 2 * DAY;
  await req(app1, "/v1/play", { query: "Halcyon" });
  const m = intake(s, { kind: "message.in", source: "soma", payload: { from: "Joy", text: "今天好累" } });
  clock.t += MIN;
  s.append({ kind: "episode", class: "self", source: "agent", at: m.at, payload: { text: "她说累，我没多说，歌一直放着", session: "s1" }, links: [{ to: m.id, rel: "cites" }] });
  // a2 后来干活时放了燃起来
  a2.store.setSituation({ harness: "pi", session: "s2" }, "pi");
  intake(a2.store, { kind: "tool.call", source: "pi", payload: { name: "Bash", callId: "x" } });
  await req(app2, "/v1/play", { query: "燃起来" });
  tick();

  const mat = await req(app1, "/v1/coldwrite");
  const obs = mat.observations as { archiveNo: string; text: string; later: { text: string }[] }[];
  expect(obs.map((o) => o.text)).toEqual(["听这首的时候有种平静", "Argon 干活时爱放打鸡血的歌"]);
  expect(obs[0].later.map((l) => l.text)).toEqual([expect.stringMatching(/^又听到《Halcyon Days》Ellie Goulding（10-12 21:00–/), "  那时：她说累，我没多说，歌一直放着"]);
  // 关于 a2 的：当时也在放 Halcyon，所以也摆那首又响的；再加 a2 后来的样子和他放的歌
  expect(obs[1].later.map((l) => l.text).slice(-2)).toEqual(["10-12 21:01 a2：在 pi，忙", "10-12 21:01 a2 放了《燃起来》某乐队"]);

  // 引观察和后来那条情节写成规律 → 这条观察不再摆
  const ep = s.list({ kinds: ["episode"], fonds: "", limit: 10 })[0];
  const epNo = mat.material.flatMap((g: any) => g.lines).find((l: any) => l.text.includes("歌一直放着")).archiveNo;
  await req(app1, "/v1/coldwrite", {
    upTo: mat.upTo,
    entries: [{ op: "propose", shelf: "mirror", text: "放 Halcyon Days 时我会安静下来", when: "放 Halcyon Days", then: "我话少、不急着接话", observe: "那时的情节和回复长短", watch: ["Halcyon"], cites: [n1.archiveNo, epNo] }],
  });
  expect(ep).toBeTruthy();
  clock.t += MIN;
  intake(s, { kind: "message.in", source: "soma", payload: { from: "Joy", text: "嗯" } });
  const after = await req(app1, "/v1/coldwrite");
  expect(after.observations.map((o: { text: string }) => o.text)).toEqual(["Argon 干活时爱放打鸡血的歌"]);
  expect(n2.archiveNo).toBeTruthy();
});
