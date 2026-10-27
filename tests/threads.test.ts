/**
 * 还开着的事的确定性考卷（notes/plan/m7.md §五）：口子收什么拒什么、现行状态怎么算、<now> 和种子里怎么出现、经历里留什么痕。
 * 只考系统；它开不开卷、什么时候合，不考。
 */
import { describe, expect, test } from "bun:test";
import { EventStore } from "../src/store/events.ts";
import { Projections } from "../src/store/projections.ts";
import { intake } from "../src/archive/intake.ts";
import { experienceProjector, readExperience } from "../src/archive/experience.ts";
import { createApp } from "../src/server/app.ts";
import { birth } from "../src/self/self.ts";
import { renderContinuity } from "../src/archive/continuity.ts";

const T = (s: string) => Date.parse(`${s}+08:00`);
const DAY = 86_400_000;
const JSON_H = { "content-type": "application/json" };

function setup() {
  let clock = T("2026-10-16T09:00:00");
  const store = new EventStore(":memory:", { now: () => clock });
  const projections = new Projections(store);
  projections.register(experienceProjector);
  projections.live();
  const app = createApp({ store, projections });
  const get = async (path: string) => (await app.request(path)).json();
  const post = async (path: string, body: unknown) => {
    const r = await app.request(path, { method: "POST", headers: JSON_H, body: JSON.stringify(body) });
    return { status: r.status, json: await r.json() };
  };
  const ok = async (path: string, body: unknown) => {
    const r = await post(path, body);
    if (r.status !== 200) throw new Error(`${path} 被拒：${r.json.error}`);
    return r.json as { archiveNo: string };
  };
  const her = (text: string) => intake(store, { kind: "message.in", source: "soma", payload: { from: "Joy", text } });
  const pass = (ms: number) => (clock += ms);
  const now = async () => ((await get("/v1/now")) as { text: string }).text;
  return { store, get, post, ok, her, pass, now };
}

describe("开、记、合", () => {
  test("正常路径：投影对得上，合上的只在 all 里", async () => {
    const h = setup();
    const msg = h.her("周末前把契约写完给我看");
    const a = await h.ok("/v1/threads", { type: "promise", title: "周末前写完契约", to: "Joy", cites: [msg.archiveNo] });
    const b = await h.ok("/v1/threads", { type: "matter", title: "等猫的检查结果" });
    h.pass(DAY);
    await h.ok("/v1/threads/note", { target: a.archiveNo, text: "写了一半" });
    await h.ok("/v1/threads/close", { target: b.archiveNo, how: "moot", why: "她说不用等了" });
    const r = (await h.get("/v1/threads?all=1")) as any;
    expect(r.open.map((t: any) => t.title)).toEqual(["周末前写完契约"]);
    expect(r.open[0].notes.map((n: any) => n.text)).toEqual(["写了一半"]);
    expect(r.open[0].to).toBe("Joy");
    expect(r.closed.map((t: any) => [t.title, t.closed.how, t.closed.why])).toEqual([["等猫的检查结果", "moot", "她说不用等了"]]);
    expect((await h.get("/v1/threads")).closed).toBeUndefined();
    const ev = h.store.byArchiveNo(a.archiveNo)!;
    expect(h.store.linksFrom(ev.id).map((l) => [l.rel, l.to])).toEqual([["evidence", msg.id]]);
  });

  test("口子拒收", async () => {
    const h = setup();
    const a = await h.ok("/v1/threads", { type: "matter", title: "x" });
    await h.ok("/v1/threads/close", { target: a.archiveNo, how: "done", why: "好了" });
    const msg = h.her("hi");
    const bad: [string, unknown, string][] = [
      ["/v1/threads", { type: "todo", title: "x" }, "type"],
      ["/v1/threads", { type: "matter", title: " " }, "title"],
      ["/v1/threads", { type: "promise", title: "x" }, "to"],
      ["/v1/threads", { type: "matter", title: "x", cites: ["10-16#999"] }, "查不到"],
      ["/v1/threads", { type: "matter", title: "x", cites: [a.archiveNo] }, "不是你的经历"],
      ["/v1/threads/note", { target: msg.archiveNo, text: "y" }, "不是一卷"],
      ["/v1/threads/note", { target: a.archiveNo, text: "y" }, "已经合上"],
      ["/v1/threads/close", { target: a.archiveNo, how: "done", why: "z" }, "已经合上"],
      ["/v1/threads/note", { text: "y" }, "target"],
    ];
    for (const [path, body, why] of bad) {
      const r = await h.post(path, body);
      expect([path, r.status, r.json.error]).toEqual([path, 400, expect.stringContaining(why)]);
    }
    const b = await h.ok("/v1/threads", { type: "matter", title: "y" });
    expect((await h.post("/v1/threads/close", { target: b.archiveNo, how: "later", why: "z" })).json.error).toContain("how");
    expect((await h.post("/v1/threads/close", { target: b.archiveNo, how: "done" })).json.error).toContain("why");
  });

  test("出生前的卷不带过去", async () => {
    const h = setup();
    const old = await h.ok("/v1/threads", { type: "matter", title: "前世的事" });
    birth(h.store);
    expect((await h.get("/v1/threads")).open).toEqual([]);
    expect((await h.post("/v1/threads/note", { target: old.archiveNo, text: "y" })).json.error).toContain("出生前");
  });
});

describe("<moment> 与种子", () => {
  test("<moment>：没有开着的就没这一行；有的话报件数、答应的件数、最久没动的", async () => {
    const h = setup();
    h.her("在吗");
    expect(await h.now()).not.toContain("还开着的事");
    const a = await h.ok("/v1/threads", { type: "matter", title: "老的那件" });
    h.pass(DAY);
    await h.ok("/v1/threads", { type: "promise", title: "答应的那件", to: "Joy" });
    h.pass(2 * DAY);
    expect(await h.now()).toContain("还开着的事：2 件（答应别人的 1 件）；最久没动：「老的那件」，3 天前");
    await h.ok("/v1/threads/note", { target: a.archiveNo, text: "动了一下" });
    expect(await h.now()).toContain("最久没动：「答应的那件」，2 天前");
    const b = (await h.get("/v1/threads")).open.find((t: any) => t.type === "promise");
    await h.ok("/v1/threads/close", { target: b.archiveNo, how: "done", why: "写完了" });
    expect(await h.now()).toContain("还开着的事：1 件；最久没动：「老的那件」");
  });

  test("种子：全列、从旧到新、带最近一笔；只有开着的事也出", async () => {
    const h = setup();
    expect(renderContinuity(h.store)).toBeNull();
    const a = await h.ok("/v1/threads", { type: "promise", title: "写完契约", to: "Joy" });
    h.pass(DAY);
    await h.ok("/v1/threads", { type: "matter", title: "等猫的结果" });
    await h.ok("/v1/threads/note", { target: a.archiveNo, text: "写了一半" });
    const text = renderContinuity(h.store)!;
    const lines = text.split("\n");
    expect(lines[0]).toBe("【还开着的事】");
    expect(lines[1]).toBe(`[${a.archiveNo}] 答应 Joy：写完契约（10-16 起；最近 10-17：写了一半）`);
    expect(lines[2]).toMatch(/^\[10-17#\d+\] 等猫的结果（10-17 起）$/);
    // 有情节时排在最近的情节之后
    h.store.append({ kind: "episode", class: "self", source: "agent", payload: { text: "一件事" } });
    const withEp = renderContinuity(h.store)!;
    expect(withEp.indexOf("【最近的情节】")).toBeLessThan(withEp.indexOf("【还开着的事】"));
  });
});

test("经历里的痕：三种事件各一行，工具调用不重抄", async () => {
  const h = setup();
  const a = await h.ok("/v1/threads", { type: "promise", title: "写完契约", to: "Joy", note: "她周五要看" });
  await h.ok("/v1/threads/note", { target: a.archiveNo, text: "写了一半" });
  await h.ok("/v1/threads/close", { target: a.archiveNo, how: "done", why: "交了" });
  intake(h.store, { kind: "tool.call", source: "soma", payload: { name: "mcp__psyche__open_thread", callId: "c1", args: { title: "写完契约" } } });
  intake(h.store, { kind: "tool.call", source: "soma", payload: { name: "mcp__psyche__threads", callId: "c3", args: { op: "close", target: a.archiveNo, how: "done", why: "交了" } } });
  intake(h.store, { kind: "tool.call", source: "soma", payload: { name: "mcp__psyche__threads", callId: "c2" } });
  const lines = readExperience(h.store.db, {}).map((l) => l.text);
  expect(lines).toEqual([
    "我开了一卷（答应 Joy）：写完契约——她周五要看",
    "我在「写完契约」上记了一笔：写了一半",
    "我合上了「写完契约」（做到了）：交了",
    "我看了看还开着的事",
  ]);
});

test("thread.* 不走上报口", () => {
  const h = setup();
  expect(() => intake(h.store, { kind: "thread.opened", source: "soma", payload: { type: "matter", title: "x" } })).toThrow("口子");
});

describe("活动卷（m7.md §六）", () => {
  test("with 的收与拒；按 type 筛", async () => {
    const h = setup();
    const a = await h.ok("/v1/threads", { type: "activity", title: "看《星际穿越》", with: ["Joy", " a2 "], note: "看到米勒星球" });
    await h.ok("/v1/threads", { type: "matter", title: "等猫的结果" });
    const bad: [unknown, string][] = [
      [{ type: "matter", title: "x", with: ["Joy"] }, "with 只给 activity"],
      [{ type: "activity", title: "x", with: [] }, "with 应为"],
      [{ type: "activity", title: "x", with: "Joy" }, "with 应为"],
      [{ type: "activity", title: "x", with: [" "] }, "with 应为"],
    ];
    for (const [body, why] of bad) expect((await h.post("/v1/threads", body)).json.error).toContain(why);
    const acts = (await h.get("/v1/threads?type=activity")).open;
    expect(acts.map((t: any) => [t.archiveNo, t.title, t.with])).toEqual([[a.archiveNo, "看《星际穿越》", ["Joy", "a2"]]]);
    expect((await h.get("/v1/threads?type=promise,matter")).open.map((t: any) => t.title)).toEqual(["等猫的结果"]);
    expect((await h.get("/v1/threads")).open).toHaveLength(2);
  });

  test("不进 <now> 那一行、不进种子", async () => {
    const h = setup();
    h.her("在吗");
    await h.ok("/v1/threads", { type: "activity", title: "跑团《雾港》" });
    expect(await h.now()).not.toContain("还开着的事");
    expect(renderContinuity(h.store) ?? "").not.toContain("还开着的事");
    await h.ok("/v1/threads", { type: "matter", title: "等猫的结果" });
    expect(await h.now()).toContain("还开着的事：1 件；");
    expect(renderContinuity(h.store)!).not.toContain("雾港");
  });

  test("经历里的痕：开卷带同伴，合上换说法；合上的照旧不能再记", async () => {
    const h = setup();
    const a = await h.ok("/v1/threads", { type: "activity", title: "看《星际穿越》", with: ["Joy"], note: "看了一半" });
    await h.ok("/v1/threads/note", { target: a.archiveNo, text: "看完后半截" });
    await h.ok("/v1/threads/close", { target: a.archiveNo, how: "done", why: "片尾那段她哭了" });
    const texts = readExperience(h.store.db, {}).map((l) => l.text);
    expect(texts).toContain("我开了一卷活动（和 Joy）：看《星际穿越》——看了一半");
    expect(texts).toContain("我在「看《星际穿越》」上记了一笔：看完后半截");
    expect(texts).toContain("我合上了「看《星际穿越》」（结束了）：片尾那段她哭了");
    expect((await h.post("/v1/threads/note", { target: a.archiveNo, text: "二刷" })).json.error).toContain("开新卷");
  });
});

test("翻活动卷的工具调用留一行", () => {
  const h = setup();
  intake(h.store, { kind: "tool.call", source: "soma", payload: { name: "mcp__psyche__threads", callId: "c1", args: { op: "list", type: "activity" } } });
  expect(readExperience(h.store.db, {}).map((l) => l.text)).toEqual(["我翻了翻活动卷"]);
});
