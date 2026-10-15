import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createPsycheMcp, parseTime, type McpOptions } from "../src/mcp.ts";
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
  test("列出全部工具，描述是中文", async () => {
    const client = await connect({ fetch: async () => Response.json({}) });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["coldwrite", "coldwrite_material", "detail", "hotwrite", "hotwrite_segment", "recall", "revise_episode", "shelf", "stats"]);
    expect(tools.find((t) => t.name === "hotwrite")!.description).toContain("情节是你自己写的记忆");
  });

  test("recall：from/to 换成毫秒，带上 token", async () => {
    const rest = fakeRest(() => Response.json({ lines: [{ archiveNo: "10-14#12", at: T("2026-10-14T09:00:00+08:00"), kind: "message.in", text: "Joy：早" }] }));
    const client = await connect({ url: "http://psyche.test/", token: "tk", fetch: rest.fetch });
    const r = await client.callTool({ name: "recall", arguments: { query: "早", from: "2026-10-14", to: "2026-10-14", limit: 5 } });
    const { url, method, auth } = rest.seen[0];
    expect(method).toBe("GET");
    expect(url.origin + url.pathname).toBe("http://psyche.test/v1/recall");
    expect(url.searchParams.get("q")).toBe("早");
    expect(Number(url.searchParams.get("from"))).toBe(T("2026-10-14T00:00:00+08:00"));
    expect(Number(url.searchParams.get("to"))).toBe(T("2026-10-15T00:00:00+08:00"));
    expect(url.searchParams.get("limit")).toBe("5");
    expect(auth).toBe("Bearer tk");
    expect(textOf(r)).toBe("[10-14#12] 10-14 09:00 Joy：早");
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
    const rest = fakeRest(() => Response.json({ event: { kind: "message.in" }, links: [], referencedBy: [] }));
    const client = await connect({ fetch: rest.fetch });
    await client.callTool({ name: "detail", arguments: { archiveNo: "10-14#12" } });
    expect(rest.seen[0].url.pathname).toBe("/v1/archive/10-14%2312");
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

  test("hotwrite_segment：给提示词、upTo 和带档号的行；空段直说", async () => {
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
    const client = await connect({ fetch: async () => Response.json(seg) });
    const out = textOf(await client.callTool({ name: "hotwrite_segment", arguments: {} }));
    expect(out).toContain("把这一段写成情节。");
    expect(out).toContain("upTo: 01J0000000000000000000000Z");
    expect(out).toContain("[10-14#12] 10-14 09:00 Joy：早");

    const empty = await connect({ fetch: async () => Response.json({ ...seg, upTo: null, lines: [] }) });
    expect(textOf(await empty.callTool({ name: "hotwrite_segment", arguments: {} }))).toContain("不用写");
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
});
