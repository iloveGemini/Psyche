import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createPsycheMcp, parseTime, toolsFor, type McpOptions } from "../src/mcp.ts";
import { renderExperience } from "../src/archive/render.ts";
import { EventStore } from "../src/store/events.ts";
import { Projections } from "../src/store/projections.ts";
import { experienceProjector } from "../src/archive/experience.ts";
import { createApp } from "../src/server/app.ts";

const T = (s: string) => Date.parse(s);

async function connect(opts: McpOptions) {
  const server = createPsycheMcp(opts);
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

/** 假的 REST：记下收到的请求，按路径给预设的回应 */
function fakeRest(reply: (req: Request) => Response | Promise<Response>) {
  const seen: { method: string; url: URL; auth: string | null; body: any }[] = [];
  const fetch = async (req: Request) => {
    const raw = await req.text();
    seen.push({ method: req.method, url: new URL(req.url), auth: req.headers.get("authorization"), body: raw ? JSON.parse(raw) : undefined });
    return reply(req);
  };
  return { seen, fetch };
}

const textOf = (r: any) => (r.content as { type: string; text: string }[]).map((c) => c.text).join("\n");

describe("时间参数", () => {
  test("不带时区按给定时区的墙上时间；只给日期时 to 取次日零点", () => {
    expect(parseTime("2026-10-14", "Asia/Shanghai", "from")).toBe(T("2026-10-14T00:00:00+08:00"));
    expect(parseTime("2026-10-14", "Asia/Shanghai", "to")).toBe(T("2026-10-15T00:00:00+08:00"));
    expect(parseTime("2026-10-14T09:30", "Asia/Shanghai", "from")).toBe(T("2026-10-14T09:30:00+08:00"));
    expect(parseTime("2026-10-14 09:30:15", "Asia/Shanghai", "to")).toBe(T("2026-10-14T09:30:15+08:00"));
    expect(parseTime("2026-10-14T01:00:00Z", "Asia/Shanghai", "from")).toBe(T("2026-10-14T01:00:00Z"));
    // 月末进位、夏令时
    expect(parseTime("2026-10-31", "Asia/Shanghai", "to")).toBe(T("2026-11-01T00:00:00+08:00"));
    expect(parseTime("2026-07-01T12:00", "America/New_York", "from")).toBe(T("2026-07-01T12:00:00-04:00"));
    expect(parseTime("2026-12-01T12:00", "America/New_York", "from")).toBe(T("2026-12-01T12:00:00-05:00"));
    expect(() => parseTime("昨天", "Asia/Shanghai", "from")).toThrow(/看不懂/);
  });
});

describe("MCP 工具 → REST", () => {
  test("醒着挂的工具，描述是中文；不知道前世时三件都挂", async () => {
    const client = await connect({ fetch: async () => Response.json({}) });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["coldwrite", "detail", "hotwrite", "hotwrite_segment", "mail", "name_self", "recall", "revise_episode", "rewrite_self", "schedule", "self", "send_mail", "shelf", "stats", "threads", "write_diary", "look", "set_mood", "player", "playlist", "notice", "past_life", "claim_past", "past_catalog"].sort());
    expect(tools.find((t) => t.name === "hotwrite")!.description).toContain("情节是你自己写的记忆");
  });

  test("睡着只挂记忆整理用的；前世按有没有、认没认领挂", async () => {
    const asleep = await connect({ fetch: async () => Response.json({}), mode: "asleep", past: [] });
    expect((await asleep.listTools()).tools.map((t) => t.name).sort()).toEqual(["coldwrite", "detail", "gist", "hotwrite", "hotwrite_segment", "mail", "name_self", "recall", "revise_episode", "rewrite_self", "self", "shelf", "stats"].sort());
    expect(toolsFor("awake", [])).not.toContain("past_life");
    expect(toolsFor("awake", [])).toHaveLength(21);
    const claimed = toolsFor("awake", [{ fonds: "ROY", claimed: true }]);
    expect(claimed).toContain("past_catalog");
    expect(claimed).not.toContain("claim_past");
    const fresh = toolsFor("awake", [{ fonds: "ROY", claimed: false }]);
    expect(fresh).toContain("claim_past");
    expect(fresh).not.toContain("past_catalog");
  });

  test("合并的工具：op / 给不给参数分去对应的 REST", async () => {
    const rest = fakeRest((req) => {
      const u = new URL(req.url);
      if (u.pathname === "/v1/threads" && req.method === "GET") return Response.json({ open: [] });
      if (u.pathname === "/v1/listen") return Response.json({ text: "在放《晴天》" });
      if (u.pathname === "/v1/listen/with") return Response.json({ joined: "a2" });
      if (u.pathname === "/v1/coldwrite" && req.method === "GET") return Response.json({ upTo: null });
      if (u.pathname === "/v1/coldwrite") return Response.json({ written: [], unjudged: 0 });
      if (u.pathname === "/v1/gist" && req.method === "GET") return Response.json({ pending: [], limits: {}, prompt: "", promptVersion: 1 });
      if (u.pathname === "/v1/gist") return Response.json({ span: "day", key: "2026-10-17" });
      return Response.json({ archiveNo: "10-18#1" });
    });
    const client = await connect({ url: "http://psyche.test", fetch: rest.fetch });
    const call = async (name: string, args: Record<string, unknown>) => textOf(await client.callTool({ name, arguments: args }));
    expect(await call("threads", {})).toBe("没有开着的事。");
    expect(await call("threads", { op: "open", type: "matter", title: "瘦身" })).toBe("开了（10-18#1）。");
    expect(await call("threads", { op: "note", target: "10-18#1", text: "合完了" })).toBe("记下了（10-18#1）。");
    expect(await call("threads", { op: "close", target: "10-18#1", how: "done", why: "提交了" })).toBe("合上了（10-18#1）。");
    expect(await call("player", {})).toBe("在放《晴天》");
    expect(await call("player", { op: "with", host: "a2" })).toBe("戴上了 a2 的一只耳机。");
    expect(await call("player", { op: "stop" })).toBe("停了。");
    expect(await call("schedule", { schedule: { daily: [] } })).toContain("要写 why");
    expect(await call("schedule", { schedule: { daily: [] }, why: "先空着" })).toBe("排好了（10-18#1）。");
    expect(await call("coldwrite", {})).toContain("不用整理");
    expect(await call("coldwrite", { upTo: "U1" })).toContain("要带 entries");
    expect(await call("coldwrite", { upTo: "U1", entries: [] })).toBe("这次没写。");
    const posts = rest.seen.filter((s) => s.method === "POST").map((s) => [s.url.pathname, s.body]);
    expect(posts).toEqual([
      ["/v1/threads", { type: "matter", title: "瘦身" }],
      ["/v1/threads/note", { target: "10-18#1", text: "合完了" }],
      ["/v1/threads/close", { target: "10-18#1", how: "done", why: "提交了" }],
      ["/v1/listen/with", { host: "a2" }],
      ["/v1/stop", undefined],
      ["/v1/schedule", { schedule: { daily: [] }, why: "先空着" }],
      ["/v1/coldwrite", { upTo: "U1", entries: [] }],
    ]);
    const sleeper = await connect({ url: "http://psyche.test", fetch: rest.fetch, mode: "asleep" });
    expect(textOf(await sleeper.callTool({ name: "gist", arguments: {} }))).toContain("没有过完了");
    expect(textOf(await sleeper.callTool({ name: "gist", arguments: { span: "day" } }))).toContain("三个都给");
    expect(textOf(await sleeper.callTool({ name: "gist", arguments: { span: "day", key: "2026-10-17", text: "t" } }))).toContain("2026-10-17");
  });

  test("合并后的调用在经历里：取材料 / 看 / 改分开记，旧名照旧", () => {
    const r = (name: string, args?: unknown) => renderExperience({ kind: "tool.call", payload: { name: `mcp__psyche__${name}`, args } } as any);
    expect(r("coldwrite", {})).toBe("我翻出上次整理之后的经历，准备整理");
    expect(r("coldwrite", { upTo: "U", entries: [{}] })).toContain("往书架写了 1 条");
    expect(r("coldwrite_material", {})).toBe("我翻出上次整理之后的经历，准备整理");
    expect(r("schedule", {})).toBe("我看了看自己的作息");
    expect(r("schedule", { schedule: {}, why: "w" })).toContain("我调用了");
    expect(r("threads", { op: "note" })).toBeNull();
    expect(r("player", { op: "play" })).toBeNull();
    const res = (name: string, p: Record<string, unknown>) => renderExperience({ kind: "tool.result", payload: { name: `mcp__psyche__${name}`, ok: true, ...p } } as any);
    expect(res("coldwrite", { size: 90000 })).toBeNull();
    expect(res("coldwrite", { text: "写下了 1 条：10-18#3（propose）" })).toContain("写下了");
  });

  test("recall：from/to 换成毫秒，带上 token", async () => {
    const rest = fakeRest(() => Response.json({ lines: [{ archiveNo: "10-14#12", at: T("2026-10-14T09:00:00+08:00"), kind: "message.in", text: "Joy：早" }] }));
    const client = await connect({ url: "http://psyche.test/", token: "tk", fetch: rest.fetch, now: () => T("2026-10-14T20:00:00+08:00") });
    const r = await client.callTool({ name: "recall", arguments: { query: "早", from: "2026-10-14", to: "2026-10-14", limit: 5 } });
    const { url, method, auth } = rest.seen[0];
    expect(method).toBe("GET");
    expect(url.origin + url.pathname).toBe("http://psyche.test/v1/recall");
    expect(url.searchParams.get("q")).toBe("早");
    expect(Number(url.searchParams.get("from"))).toBe(T("2026-10-14T00:00:00+08:00"));
    expect(Number(url.searchParams.get("to"))).toBe(T("2026-10-15T00:00:00+08:00"));
    expect(url.searchParams.get("limit")).toBe("5");
    expect(auth).toBe("Bearer tk");
    expect(textOf(r)).toBe("[10-14#12] 今天上午 Joy：早"); // 回想只给大概（traces.md）
  });

  test("recall：时间看不懂，不发请求，告诉它怎么写", async () => {
    const rest = fakeRest(() => Response.json({ lines: [] }));
    const client = await connect({ fetch: rest.fetch });
    const r = await client.callTool({ name: "recall", arguments: { query: "早", from: "上周" } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("ISO");
    expect(rest.seen).toHaveLength(0);
  });

  test("detail：档号里的 # 要编码", async () => {
    const rest = fakeRest(() => Response.json({ event: { kind: "message.in", at: T("2026-10-14T09:00:07+08:00") }, links: [], referencedBy: [] }));
    const client = await connect({ fetch: rest.fetch });
    const r = await client.callTool({ name: "detail", arguments: { archiveNo: "10-14#12" } });
    expect(rest.seen[0].url.pathname).toBe("/v1/archive/10-14%2312");
    // 去查原件给确切时刻（traces.md）
    expect(textOf(r).split("\n")[0]).toBe("原件时刻：2026-10-14 09:00:07（周三）");
  });

  test("detail：对真的 REST，含全宗的档号也取得到", async () => {
    const store = new EventStore(":memory:", { now: () => T("2026-10-14T10:00:00+08:00") });
    const projections = new Projections(store);
    projections.register(experienceProjector);
    projections.live();
    store.append({ kind: "message.in", class: "experience", source: "import", fonds: "ROY", payload: { from: "Joy", text: "前世" }, at: T("2026-10-11T09:00:00+08:00") });
    store.append({ kind: "message.in", class: "experience", source: "cc", payload: { from: "Joy", text: "早" }, at: T("2026-10-14T09:00:00+08:00") });
    const app = createApp({ store, projections });
    const client = await connect({ url: "http://x", fetch: async (req) => app.fetch(req) });
    expect(textOf(await client.callTool({ name: "detail", arguments: { archiveNo: "10-14#1" } }))).toContain('"text": "早"');
    expect(textOf(await client.callTool({ name: "detail", arguments: { archiveNo: "ROY/2026-10-11#1" } }))).toContain('"text": "前世"');
    const miss = await client.callTool({ name: "detail", arguments: { archiveNo: "10-14#99" } });
    expect(miss.isError).toBe(true);
    expect(textOf(miss)).toBe("Psyche 拒绝了（404）：没有这个档号");
  });

  test("hotwrite_segment：给提示词、upTo 和带档号的行；眼前会话不带时刻，补写给时间流；空段直说", async () => {
    const seg = {
      session: "s1",
      upTo: "01J0000000000000000000000Z",
      prompt: "把这一段写成情节。",
      promptVersion: 1,
      lines: [
        { archiveNo: "10-14#12", at: T("2026-10-14T09:00:00+08:00"), text: "Joy：早" },
        { archiveNo: "10-14#13", at: T("2026-10-14T09:00:05+08:00"), text: "我说：早" },
      ],
    };
    const client = await connect({ fetch: async () => Response.json(seg), now: () => T("2026-10-15T08:00:00+08:00") });
    const out = textOf(await client.callTool({ name: "hotwrite_segment", arguments: {} }));
    expect(out).toContain("把这一段写成情节。");
    expect(out).toContain("upTo: 01J0000000000000000000000Z");
    expect(out).toContain("<segment>\n[10-14#12] Joy：早\n[10-14#13] 我说：早\n</segment>");
    const later = { ...seg, lines: [...seg.lines, { archiveNo: "10-14#14", at: T("2026-10-14T12:30:00+08:00"), kind: "notice", text: "我注意到：她今天起得早" }] };
    const full = await connect({ fetch: async () => Response.json(later), now: () => T("2026-10-15T08:00:00+08:00") });
    expect(textOf(await full.callTool({ name: "hotwrite_segment", arguments: { session: "s1" } }))).toContain(
      "<segment>\n── 昨天上午 ──\n[10-14#12] Joy：早\n[10-14#13] 我说：早\n（隔了约 3 小时）\n── 昨天中午 ──\n[10-14#14] 〔10-14 12:30〕我注意到：她今天起得早\n</segment>",
    );

    const empty = await connect({ fetch: async () => Response.json({ ...seg, upTo: null, lines: [] }) });
    expect(textOf(await empty.callTool({ name: "hotwrite_segment", arguments: {} }))).toContain("不用写");
  });

  test("hotwrite_segment：眼前这个会话只要开头；带 session 或 full 要全文", async () => {
    const rest = fakeRest(() => Response.json({ session: "s1", upTo: null, prompt: "", promptVersion: 1, lines: [] }));
    const client = await connect({ fetch: rest.fetch });
    await client.callTool({ name: "hotwrite_segment", arguments: {} });
    await client.callTool({ name: "hotwrite_segment", arguments: { full: true } });
    await client.callTool({ name: "hotwrite_segment", arguments: { session: "s0" } });
    expect(rest.seen.map((s) => new URL(s.url).search)).toEqual(["?brief=1", "", "?session=s0"]);
  });

  test("hotwrite：参数原样 POST；被拒时把理由原样交回", async () => {
    const entries = [{ text: "她早上来打了个招呼，我回了。", felt: "轻松", cites: ["10-14#12", "10-14#13"] }];
    const ok = fakeRest(() => Response.json({ episodes: [{ id: "e1", archiveNo: "10-14#20" }] }));
    let client = await connect({ fetch: ok.fetch });
    const r = await client.callTool({ name: "hotwrite", arguments: { upTo: "U1", entries } });
    expect(ok.seen[0].method).toBe("POST");
    expect(ok.seen[0].url.pathname).toBe("/v1/hotwrite");
    expect(ok.seen[0].body).toEqual({ upTo: "U1", entries });
    expect(textOf(r)).toContain("10-14#20");

    const bad = fakeRest(() => Response.json({ error: "档号 10-14#3 不在这一段里" }, { status: 400 }));
    client = await connect({ fetch: bad.fetch });
    const rej = await client.callTool({ name: "hotwrite", arguments: { upTo: "U1", entries } });
    expect(rej.isError).toBe(true);
    expect(textOf(rej)).toBe("Psyche 拒绝了（400）：档号 10-14#3 不在这一段里");
  });

  test("hotwrite：空 cites 在 MCP 层就挡下，不发请求", async () => {
    const rest = fakeRest(() => Response.json({ episodes: [] }));
    const client = await connect({ fetch: rest.fetch });
    const r = await client.callTool({ name: "hotwrite", arguments: { upTo: "U1", entries: [{ text: "x", cites: [] }] } });
    expect(r.isError).toBe(true);
    expect(rest.seen).toHaveLength(0);
  });

  test("连不上 Psyche：说清楚连的是哪", async () => {
    const client = await connect({ url: "http://127.0.0.1:1", fetch: async () => { throw new Error("ECONNREFUSED"); } });
    const r = await client.callTool({ name: "hotwrite_segment", arguments: {} });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("连不上 Psyche（http://127.0.0.1:1）");
  });

  test("self / rewrite_self / name_self：接真 REST", async () => {
    const store = new EventStore(":memory:");
    const projections = new Projections(store);
    projections.register(experienceProjector);
    projections.live();
    store.setSituation({ harness: "soma", session: "S1" });
    const ev = store.append({ kind: "message.in", class: "experience", source: "soma", payload: { from: "Joy", text: "你太客气了" } });
    const app = createApp({ store, projections });
    const client = await connect({ fetch: async (req) => app.fetch(req) });
    const no = ev.archiveNo.replace(/^\d{4}-/, "");
    expect(textOf(await client.callTool({ name: "self", arguments: {} }))).toContain("自述：第 0 版");
    const r = await client.callTool({ name: "rewrite_self", arguments: { text: "## 我\n直接。", why: "她说我太客气", cites: [no], baseVersion: 0 } });
    expect(textOf(r)).toContain("自述第 1 版");
    const rej = await client.callTool({ name: "rewrite_self", arguments: { text: "又改", why: "w", cites: [no], baseVersion: 0 } });
    expect([rej.isError, textOf(rej)]).toEqual([true, expect.stringContaining("现行是第 1 版")]);
    await client.callTool({ name: "name_self", arguments: { name: "阿一" } });
    const s = textOf(await client.callTool({ name: "self", arguments: {} }));
    expect(s).toContain("名字：阿一");
    expect(s).toContain("<self>\n## 我\n直接。\n</self>");
    expect(s).toContain("第 1 版");
  });
});
