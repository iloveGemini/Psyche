/**
 * 梗概与"接着往下过"的确定性考卷（10-16）：哪些段该写、材料对不对、闸、拼出来的次序和长度、调度。
 * 只考系统；它写了什么，不考。
 */
import { describe, expect, test } from "bun:test";
import { EventStore } from "../src/store/events.ts";
import { Projections } from "../src/store/projections.ts";
import { experienceProjector } from "../src/archive/experience.ts";
import { createApp } from "../src/server/app.ts";
import { pendingGists, weekOf, writeGist, GistError } from "../src/catalog/gist.ts";
import { renderContinuity } from "../src/archive/continuity.ts";
import { tick } from "../src/heartbeat/scheduler.ts";

const T = (s: string) => Date.parse(`${s}+08:00`);
const JSON_H = { "content-type": "application/json" };

function setup(start = "2026-10-16T09:00:00") {
  let clock = T(start);
  const store = new EventStore(":memory:", { now: () => clock });
  const projections = new Projections(store);
  projections.register(experienceProjector);
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
  test("月 → 周 → 天 → 最近的情节；天梗概之后的情节才放；同一段后写的算数", () => {
    const h = setup("2026-11-12T09:00:00");
    writeGist(h.store, { span: "month", key: "2026-09", text: "九月" });
    writeGist(h.store, { span: "week", key: "2026-W44", text: "W44" });
    writeGist(h.store, { span: "day", key: "2026-11-10", text: "十号旧" });
    writeGist(h.store, { span: "day", key: "2026-11-10", text: "十号" });
    h.episode("2026-11-10T10:00:00", "十号的情节（已在天梗概里）");
    h.episode("2026-11-11T10:00:00", "十一号的情节");
    h.episode("2026-11-12T08:00:00", "今天的情节");
    expect(renderContinuity(h.store)).toBe(
      ["【月】", "2026-09：九月", "", "【周】", "2026-W44：W44", "", "【天】", "11-10：十号", "", "【最近的情节】", "十一号的情节", "今天的情节"].join("\n"),
    );
  });

  test("情节从新往旧取到预算；说明少放了几条", () => {
    const h = setup();
    for (let i = 0; i < 5; i++) h.episode(`2026-10-16T0${i}:00:00`, `${i}`.repeat(10));
    expect(renderContinuity(h.store, { days: 7, weeks: 4, months: 12, episodeChars: 25 })).toBe(
      ["【最近的情节】", "（更早的 3 条没放进来，要找用 recall）", "3".repeat(10), "4".repeat(10)].join("\n"),
    );
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
