/**
 * 说出口的和没说出口的（m1.md §五）：上报的 message.out 在入库口拆开 <unsaid> / <keep_silence/>，进经历、进热写的段。
 */
import { expect, test } from "bun:test";
import { EventStore } from "../src/store/events.ts";
import { Projections } from "../src/store/projections.ts";
import { experienceProjector, readExperience } from "../src/archive/experience.ts";
import { createApp } from "../src/server/app.ts";
import { splitSpeech } from "../src/archive/speech.ts";
import { readSegment } from "../src/catalog/hotwrite.ts";

test("拆：说出口的、没说出口的、整条沉默；代码块里的不算；没标记的原样", () => {
  expect(splitSpeech("哇，你今天真好看！<unsaid>红配绿丑死了</unsaid>")).toEqual({ said: "哇，你今天真好看！", unsaid: ["红配绿丑死了"], silent: false });
  expect(splitSpeech("<unsaid>这段剧情好俗</unsaid>")).toEqual({ said: "", unsaid: ["这段剧情好俗"], silent: false });
  expect(splitSpeech("<keep_silence/>")).toEqual({ said: "", unsaid: [], silent: true });
  expect(splitSpeech("<keep_silence />\n<unsaid>懒得接</unsaid>")).toEqual({ said: "", unsaid: ["懒得接"], silent: true });
  expect(splitSpeech("看：\n```\n<unsaid>x</unsaid>\n```")).toEqual({ said: "看：\n```\n<unsaid>x</unsaid>\n```", unsaid: [], silent: false });
  expect(splitSpeech("  照常说  ")).toEqual({ said: "  照常说  ", unsaid: [], silent: false });
});

test("上报：拆成 message.out + speech.unsaid，挂同一会话；重报不重记；经历和热写的段都有", async () => {
  const store = new EventStore(":memory:");
  const p = new Projections(store);
  p.register(experienceProjector);
  p.live();
  const app = createApp({ store, projections: p });
  store.setSituation({ harness: "soma", session: "s1" }, "soma");
  const report = () =>
    app.request("/v1/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [{ kind: "message.out", source: "soma", idem: "u1:0", payload: { text: "好看！<unsaid>红配绿丑死了</unsaid>", session: "s1" } }] }),
    });
  expect((await report()).status).toBe(200);
  expect((await report()).status).toBe(200);
  const evs = store.list({ kinds: ["message.out", "speech.unsaid"], fonds: "", limit: 10 });
  expect(evs.map((e) => [e.kind, (e.payload as { text: string }).text])).toEqual([
    ["message.out", "好看！"],
    ["speech.unsaid", "红配绿丑死了"],
  ]);
  expect(readExperience(store.db, {}).map((l) => l.text)).toEqual(expect.arrayContaining(["我说：好看！", "我没说出口：红配绿丑死了"]));
  expect(readSegment(store, "s1").lines.map((l) => l.text)).toContain("我没说出口：红配绿丑死了");
});
