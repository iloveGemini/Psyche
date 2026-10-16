/**
 * 一个进程住几个人（P1，notes/design/soma2.md §八.1）：谁住在这、请求分给谁、A 的 token 进不了 B 的门。
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "../src/store/events.ts";
import { Projections } from "../src/store/projections.ts";
import { createApp } from "../src/server/app.ts";
import { createHouse, AGENT_HEADER } from "../src/server/house.ts";
import { readResidents } from "../src/house/residents.ts";
import { createPsycheMcp } from "../src/mcp.ts";
import { experienceProjector } from "../src/archive/experience.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const tmp = () => mkdtempSync(join(tmpdir(), "psyche-house-"));
const touchDb = (dir: string) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "psyche.db"), "");
};

describe("谁住在这", () => {
  test("每人一个子目录；agents.json 里列了没目录的也建；不像 id 的目录不算", () => {
    const d = tmp();
    touchDb(join(d, "a1"));
    touchDb(join(d, "Not An Id"));
    mkdirSync(join(d, "empty"));
    writeFileSync(join(d, "agents.json"), JSON.stringify({ a2: { token: "t2", model: "gemini-4-argon" } }));
    const rs = readResidents(d, {});
    expect(rs.map((r) => [r.id, r.dir])).toEqual([["a1", join(d, "a1")], ["a2", join(d, "a2")]]);
    expect(rs[1].config).toMatchObject({ token: "t2", model: "gemini-4-argon" });
  });

  test("只住一个人：环境变量当缺省；住几个人：家、模型、邮箱不从环境变量拿，token 没设的才用 PSYCHE_TOKEN", () => {
    const env = { PSYCHE_TOKEN: "shared", SOMA_URL: "http://soma", PSYCHE_MODEL: "m", PSYCHE_EMAIL: "1" };
    const one = tmp();
    touchDb(join(one, "a1"));
    expect(readResidents(one, env)[0].config).toEqual({ token: "shared", soma: "http://soma", model: "m", email: true });

    const two = tmp();
    touchDb(join(two, "a1"));
    writeFileSync(join(two, "agents.json"), JSON.stringify({ a2: { token: "own" } }));
    expect(readResidents(two, env).map((r) => r.config)).toEqual([{ token: "shared" }, { token: "own" }]);
  });

  test("一代的布局（数据目录下直接是库）：一个人，id 取 PSYCHE_AGENT", () => {
    const d = tmp();
    touchDb(d);
    expect(readResidents(d, {}).map((r) => [r.id, r.dir])).toEqual([["default", d]]);
    expect(readResidents(d, { PSYCHE_AGENT: "a1" })[0].id).toBe("a1");
  });

  test("agents.json 里的 id 不对：拒", () => {
    const d = tmp();
    writeFileSync(join(d, "agents.json"), JSON.stringify({ "../x": {} }));
    expect(() => readResidents(d, {})).toThrow();
  });
});

function resident(token?: string) {
  const store = new EventStore(":memory:");
  const projections = new Projections(store);
  projections.register(experienceProjector);
  projections.live();
  return { store, app: createApp({ store, projections, token }) };
}

describe("门口", () => {
  const a = resident("ta");
  const b = resident("tb");
  const house = createHouse(new Map([["a", a.app.fetch], ["b", b.app.fetch]]));
  const req = (path: string, headers: Record<string, string> = {}, init: RequestInit = {}) =>
    house(new Request(`http://psyche${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } }));
  const post = (agent: string, token: string, text: string) =>
    req("/v1/events", { [AGENT_HEADER]: agent, authorization: `Bearer ${token}`, "content-type": "application/json" }, {
      method: "POST",
      body: JSON.stringify({ kind: "message.in", source: "soma", payload: { from: "Joy", text } }),
    });

  test("住着几个人又没说是谁：400；没这个人：404；/health 不问", async () => {
    expect((await req("/v1/now")).status).toBe(400);
    expect((await req("/v1/now?agent=c")).status).toBe(404);
    expect((await req("/health")).status).toBe(200);
  });

  test("各进各的库；头和 ?agent= 都认", async () => {
    expect((await post("a", "ta", "给 a 的")).status).toBe(200);
    expect((await post("b", "tb", "给 b 的")).status).toBe(200);
    const texts = (s: EventStore) => s.db.query("SELECT json_extract(payload,'$.text') AS t FROM events WHERE kind='message.in'").all().map((r: any) => r.t);
    expect(texts(a.store)).toEqual(["给 a 的"]);
    expect(texts(b.store)).toEqual(["给 b 的"]);
    expect((await req("/v1/now?agent=b", { authorization: "Bearer tb" })).status).toBe(200);
  });

  test("A 的 token 进不了 B 的门", async () => {
    expect((await post("b", "ta", "混进来")).status).toBe(401);
    expect((await req("/v1/now?agent=a", { authorization: "Bearer tb" })).status).toBe(401);
  });

  test("只住一个人：可以不说是谁", async () => {
    const solo = createHouse(new Map([["a", resident().app.fetch]]));
    expect((await solo(new Request("http://psyche/v1/now"))).status).toBe(200);
  });

  test("MCP 带着 PSYCHE_AGENT 说明是谁", async () => {
    const seen: (string | null)[] = [];
    const server = createPsycheMcp({
      agent: "b",
      fetch: async (r) => {
        seen.push(r.headers.get(AGENT_HEADER));
        return Response.json({ text: "x" });
      },
    });
    const client = new Client({ name: "t", version: "0" });
    const [x, y] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(x), client.connect(y)]);
    await client.callTool({ name: "detail", arguments: { archiveNo: "10-14#1" } });
    expect(seen[0]).toBe("b");
  });
});
