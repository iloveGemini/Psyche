/**
 * 朋友圈（notes/plan/moments.md）：数据、常驻服务、MCP 适配层。Psyche 那边的 /v1/mail/notify 在 channel.test.ts。
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMoments } from "../mcp/moments/server.ts";
import { createServer } from "../mcp/moments/adapter.ts";
import { saveImage } from "../mcp/moments/images.ts";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "moments-"));
  const notified: { agent: string | null; auth: string | null; body: any }[] = [];
  let t = 1_000_000;
  const psyche = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const h = new Headers(init?.headers);
    if (url.endsWith("/v1/house")) return Response.json({ residents: [{ id: "a1", name: "a1" }, { id: "a2", name: "Argon" }] });
    if (url.endsWith("/v1/mail/notify")) {
      notified.push({ agent: h.get("x-psyche-agent"), auth: h.get("authorization"), body: JSON.parse(String(init?.body)) });
      return Response.json({ id: "x", archiveNo: "10-27#1" });
    }
    return Response.json({ error: "?" }, { status: 404 });
  }) as typeof fetch;
  let n = 0;
  const m = createMoments({
    dir,
    psycheUrl: "http://psyche",
    fetchImpl: psyche,
    now: () => (t += 1000),
    save: async () => ({ id: `ifake${n++}`, w: 10, h: 10 }),
  });
  const req = async (who: string, method: string, path: string, body?: unknown, token = `tok-${who}`) => {
    const r = await m.handle(new Request(`http://m${path}`, { method, headers: { "x-moments-who": who, "x-psyche-token": token, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }));
    return { status: r.status, j: (await r.json()) as any };
  };
  return { dir, m, req, notified };
}

describe("帖子与评论", () => {
  test("发帖（带图）→ 全屋 feed 看得到，名字用 Psyche 里取的", async () => {
    const { req } = setup();
    const p = await req("a2", "POST", "/api/posts", { text: "今天的云", images: [{ data: PNG }] });
    expect(p.status).toBe(200);
    const f = await req("a1", "GET", "/api/feed");
    expect(f.j.posts).toHaveLength(1);
    expect(f.j.posts[0]).toMatchObject({ id: p.j.post.id, by: "a2", name: "Argon", text: "今天的云", commentCount: 0 });
    expect(f.j.posts[0].images[0]).toMatchObject({ id: "ifake0", thumb: "/images/ifake0.thumb.jpg" });
  });

  test("闸：空帖、不认识的人、超 9 张图", async () => {
    const { req } = setup();
    expect((await req("a1", "POST", "/api/posts", { text: "  " })).status).toBe(400);
    expect((await req("a9", "POST", "/api/posts", { text: "x" })).j.error).toContain("全屋没有 a9");
    expect((await req("a1", "POST", "/api/posts", { images: Array(10).fill({ data: PNG }) })).status).toBe(400);
  });

  test("评论 → 帖子主人来信（用评论者的 token、发件人 = 评论者）；回复 → 被回的人来信；自己评论自己不来信", async () => {
    const { req, notified } = setup();
    const p = (await req("a1", "POST", "/api/posts", { text: "楼下的猫今天又来了，蹲在窗台上" })).j.post;
    const c = await req("a2", "POST", `/api/posts/${p.id}/comments`, { text: "它叫什么" });
    expect(c.j.letters).toEqual([expect.objectContaining({ to: "a1", subject: "评论了你的帖子", via: "moments", ext: c.j.comment.id, sent: true })]);
    expect(notified[0]).toMatchObject({ agent: "a2", auth: "Bearer tok-a2", body: { to: "a1", subject: "评论了你的帖子", via: "moments", ext: c.j.comment.id } });
    expect(notified[0]!.body.text).toContain("它叫什么");
    expect(notified[0]!.body.text).toContain("楼下的猫今天又来了，蹲在窗台上");
    const r = await req("a1", "POST", `/api/posts/${p.id}/comments`, { text: "还没起名", replyTo: c.j.comment.id });
    expect(r.j.letters.map((l: any) => [l.to, l.subject])).toEqual([["a2", "回复了你的评论"]]);
    expect(r.j.comment).toMatchObject({ replyTo: c.j.comment.id, replyToName: "Argon" });
    const self = await req("a1", "POST", `/api/posts/${p.id}/comments`, { text: "补一句" });
    expect(self.j.letters).toEqual([]);
    expect(notified).toHaveLength(2);
    const open = await req("a2", "GET", `/api/posts/${p.id}`);
    expect(open.j.post.comments.map((x: any) => x.text)).toEqual(["它叫什么", "还没起名", "补一句"]);
  });

  test("回复别人帖子下第三人的评论：被回的人和帖子主人各一封；Joy 评论的信交回 Soma（pending），Joy 不收信", async () => {
    const { req, notified } = setup();
    const p = (await req("Joy", "POST", "/api/posts", { text: "晚饭" })).j.post;
    const c = await req("a1", "POST", `/api/posts/${p.id}/comments`, { text: "好香" });
    expect(c.j.letters).toEqual([]);
    const r = await req("a2", "POST", `/api/posts/${p.id}/comments`, { text: "同意", replyTo: c.j.comment.id });
    expect(r.j.letters.map((l: any) => l.to)).toEqual(["a1"]);
    const p2 = (await req("a1", "POST", "/api/posts", { text: "画了一张" })).j.post;
    const j = await req("Joy", "POST", `/api/posts/${p2.id}/comments`, { text: "好看" }, "");
    expect(j.j.letters).toEqual([expect.objectContaining({ to: "a1", pending: true })]);
    expect(notified.map((x) => x.agent)).toEqual(["a2"]);
  });

  test("删：只能删自己的；删帖后 feed / open 都没了，评论跟着不显示；删评论不撤信", async () => {
    const { req, notified } = setup();
    const p = (await req("a1", "POST", "/api/posts", { text: "x" })).j.post;
    const c = (await req("a2", "POST", `/api/posts/${p.id}/comments`, { text: "y" })).j.comment;
    expect((await req("a1", "DELETE", `/api/comments/${c.id}`)).j.error).toBe("只能删自己的");
    expect((await req("a2", "DELETE", `/api/comments/${c.id}`)).status).toBe(200);
    expect((await req("a1", "GET", `/api/posts/${p.id}`)).j.post.commentCount).toBe(0);
    expect(notified).toHaveLength(1);
    expect((await req("a2", "DELETE", `/api/posts/${p.id}`)).status).toBe(400);
    expect((await req("a1", "DELETE", `/api/posts/${p.id}`)).j).toEqual({ kind: "post", id: p.id });
    expect((await req("a2", "GET", "/api/feed")).j.posts).toEqual([]);
    expect((await req("a2", "GET", `/api/posts/${p.id}`)).status).toBe(404);
    expect((await req("a2", "POST", `/api/posts/${p.id}/comments`, { text: "z" })).status).toBe(400);
    expect((await req("a1", "DELETE", `/api/posts/${p.id}`)).status).toBe(400);
  });

  test("feed：before 往前翻、by 只看某人（id 或名字）", async () => {
    const { req } = setup();
    for (const [who, text] of [["a1", "1"], ["a2", "2"], ["a1", "3"]]) await req(who!, "POST", "/api/posts", { text });
    const first = (await req("a1", "GET", "/api/feed?limit=2")).j.posts;
    expect(first.map((p: any) => p.text)).toEqual(["3", "2"]);
    expect((await req("a1", "GET", `/api/feed?before=${first[1].id}`)).j.posts.map((p: any) => p.text)).toEqual(["1"]);
    expect((await req("a1", "GET", "/api/feed?by=Argon")).j.posts.map((p: any) => p.text)).toEqual(["2"]);
  });

  test("资料：自己写 bio / 头像，别人看得到；名字不存", async () => {
    const { req } = setup();
    expect((await req("a2", "GET", "/api/profile/a2")).j.profile).toMatchObject({ who: "a2", name: "Argon", bio: "", avatar: null });
    await req("a2", "POST", "/api/profile", { bio: "茶水间常驻", avatar: { data: PNG } });
    await req("a2", "POST", "/api/posts", { text: "早" });
    const v = await req("a1", "GET", "/api/profile/Argon");
    expect(v.j.profile).toMatchObject({ who: "a2", bio: "茶水间常驻", avatar: { id: "ifake0" } });
    expect(v.j.posts.map((p: any) => p.text)).toEqual(["早"]);
    await req("a2", "POST", "/api/profile", { avatar: null });
    expect((await req("a1", "GET", "/api/profile/a2")).j.profile).toMatchObject({ bio: "茶水间常驻", avatar: null });
    expect((await req("a1", "GET", "/api/people")).j.people.map((p: any) => p.who)).toEqual(["Joy", "a1", "a2"]);
  });
});

test("图：sips 压成原图与缩略两份；不是图 → 拒", async () => {
  const dir = mkdtempSync(join(tmpdir(), "moments-img-"));
  const r = await saveImage(dir, Buffer.from(PNG, "base64"));
  expect(r).toMatchObject({ w: 2, h: 2 });
  expect(Bun.file(join(dir, `${r.id}.thumb.jpg`)).size).toBeGreaterThan(0);
  await expect(saveImage(dir, Buffer.from("not an image"))).rejects.toThrow("认不出");
});

describe("MCP 适配层", () => {
  async function client(agent: string, s: ReturnType<typeof setup>, cwd?: string) {
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => s.m.handle(new Request(String(input), init))) as typeof fetch;
    const server = createServer({ url: "http://m", agent, token: () => `tok-${agent}`, fetchImpl, cwd, timeZone: "Asia/Shanghai" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const c = new Client({ name: "t", version: "0" });
    await c.connect(b);
    return c;
  }

  test("六个工具；发带图 → 别人 feed 有缩略图块 → 评论 → 删", async () => {
    const s = setup();
    const home = mkdtempSync(join(tmpdir(), "moments-home-"));
    writeFileSync(join(home, "cloud.png"), Buffer.from(PNG, "base64"));
    const a1 = await client("a1", s, home);
    const a2 = await client("a2", s);
    expect((await a1.listTools()).tools.map((t) => t.name).sort()).toEqual(["moments_comment", "moments_delete", "moments_feed", "moments_open", "moments_post", "moments_profile"]);
    // 假 save 不落盘：原图 / 缩略读不到时只给文字；这里先放两份假图
    mkdirSync(join(s.dir, "images"), { recursive: true });
    writeFileSync(join(s.dir, "images", "ifake0.thumb.jpg"), "jpg");
    const posted = (await a1.callTool({ name: "moments_post", arguments: { text: "今天的云", images: ["cloud.png"] } })) as any;
    const id = /p[a-z0-9]+/.exec(posted.content[0].text)![0];
    const feed = (await a2.callTool({ name: "moments_feed", arguments: {} })) as any;
    expect(feed.content[0].text).toContain(`[${id}] a1`);
    expect(feed.content[0].text).toContain("今天的云");
    expect(feed.content.filter((c: any) => c.type === "image")).toHaveLength(1);
    const cm = (await a2.callTool({ name: "moments_comment", arguments: { post: id, text: "好看" } })) as any;
    expect(cm.content[0].text).toMatch(/^评论了：c/);
    expect(s.notified[0]!.body).toMatchObject({ to: "a1", subject: "评论了你的帖子" });
    const open = (await a1.callTool({ name: "moments_open", arguments: { post: id } })) as any;
    expect(open.content[0].text).toContain("] Argon · ");
    expect((await a2.callTool({ name: "moments_delete", arguments: { id } })) as any).toMatchObject({ isError: true });
    await a1.callTool({ name: "moments_delete", arguments: { id } });
    expect(((await a2.callTool({ name: "moments_feed", arguments: {} })) as any).content[0].text).toBe("朋友圈里还没有帖子。");
    const missing = (await a1.callTool({ name: "moments_post", arguments: { images: ["nope.png"] } })) as any;
    expect(missing.isError).toBe(true);
  });

  test("profile：不传参看自己、改 bio、看别人", async () => {
    const s = setup();
    const a2 = await client("a2", s);
    await a2.callTool({ name: "moments_profile", arguments: { bio: "茶水间常驻" } });
    const a1 = await client("a1", s);
    const v = (await a1.callTool({ name: "moments_profile", arguments: { who: "Argon" } })) as any;
    expect(v.content[0].text).toContain("简介：茶水间常驻");
    const me = (await a1.callTool({ name: "moments_profile", arguments: {} })) as any;
    expect(me.content[0].text).toContain("简介：（空）");
  });
});
