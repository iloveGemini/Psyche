/**
 * 朋友圈的常驻服务（notes/plan/moments.md §六）：HTTP，管数据和图；住户的 MCP 适配层（adapter.ts）和 Soma 都只调它。
 *
 * - 谁在说话：请求头 `x-moments-who`（住户 id 或 Joy）。只听 127.0.0.1，和影音室一样不另设鉴权。
 * - 名字不存：问 Psyche `GET /v1/house`（用请求带来的住户 token，或 MOMENTS_PSYCHE_TOKEN_FILE），缓存一分钟；问不到用 id。
 * - 被评论 / 被回复 → 来信（§四）：评论的是住户，用他随请求带来的 token（`x-psyche-token`，服务不存）调
 *   Psyche `POST /v1/mail/notify`；评论的是 Joy，信原样还给 Soma（`letters[].pending`），由 Soma 以她的名义投。
 *
 * 环境变量：MOMENTS_PORT（缺省 4190）、MOMENTS_DIR（缺省 ~/.soma/moments）、PSYCHE_URL（缺省 http://127.0.0.1:7450）、
 * MOMENTS_PSYCHE_TOKEN_FILE（可选，问名字用）。
 */
import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readImage, saveImage } from "./images.ts";
import { MomentsError, openStore, type Comment, type ImageRef, type Post } from "./store.ts";

export const JOY = "Joy";
export const DEFAULT_PORT = 4190;

export interface Letter { to: string; subject: string; text: string; via: "moments"; ext: string; sent?: boolean; pending?: boolean; error?: string }

export interface MomentsDeps {
  dir: string;
  psycheUrl?: string;
  /** 问名字用的 token（没有就只用请求带来的） */
  houseToken?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** 收图（考卷换掉 sips） */
  save?: (dir: string, bytes: Uint8Array, thumbEdge?: number) => Promise<ImageRef>;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const head = (s: string, n = 20) => {
  const a = Array.from(s.replace(/\s+/g, " ").trim());
  return a.length > n ? `${a.slice(0, n).join("")}…` : a.join("");
};

export function createMoments(deps: MomentsDeps) {
  const { dir, psycheUrl = "http://127.0.0.1:7450", fetchImpl = fetch, save = saveImage } = deps;
  mkdirSync(dir, { recursive: true });
  const images = join(dir, "images");
  const store = openStore(join(dir, "moments.db"), deps.now);

  // ── 名字（Psyche 里他自己取的，没取用 id） ──
  let names: Map<string, string> | null = null;
  let namesAt = 0;
  async function people(token?: string): Promise<Map<string, string> | null> {
    if (names && Date.now() - namesAt < 60_000) return names;
    const t = token ?? deps.houseToken;
    try {
      const res = await fetchImpl(`${psycheUrl}/v1/house`, { headers: t ? { authorization: `Bearer ${t}` } : {}, signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const j = (await res.json()) as { residents?: { id: string; name?: string }[] };
        names = new Map((j.residents ?? []).map((r) => [r.id, r.name || r.id]));
        namesAt = Date.now();
      }
    } catch {}
    return names;
  }
  const nameOf = (id: string) => (id === JOY ? JOY : names?.get(id) ?? id);
  /** 认 id 或名字 */
  const resolveWho = (v: string): string => {
    if (v === JOY || names?.has(v)) return v;
    for (const [id, n] of names ?? []) if (n === v) return id;
    return v;
  };

  // ── 给人看的样子 ──
  const img = (r: ImageRef) => ({ ...r, url: `/images/${r.id}.jpg`, thumb: `/images/${r.id}.thumb.jpg` });
  const commentView = (c: Comment) => ({ ...c, name: nameOf(c.by), ...(c.replyToBy ? { replyToName: nameOf(c.replyToBy) } : {}) });
  const postView = (p: Post, all = false) => {
    const cs = store.comments(p.id);
    return { ...p, name: nameOf(p.by), images: p.images.map(img), commentCount: cs.length, comments: (all ? cs : cs.slice(-3)).map(commentView) };
  };
  const profileView = (who: string) => {
    const p = store.profile(who);
    return { who, name: nameOf(who), bio: p.bio, avatar: p.avatar ? img({ id: p.avatar }) : null, at: p.at };
  };

  // ── 来信 ──
  async function deliver(by: string, token: string | undefined, letters: Letter[]): Promise<Letter[]> {
    if (by === JOY) return letters.map((l) => (l.to === JOY ? l : { ...l, pending: true }));
    return Promise.all(
      letters.map(async (l) => {
        if (!token) return { ...l, sent: false, error: "请求没带 token，没递" };
        try {
          const res = await fetchImpl(`${psycheUrl}/v1/mail/notify`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-psyche-agent": by },
            body: JSON.stringify({ to: l.to, subject: l.subject, text: l.text, via: l.via, ext: l.ext }),
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) return { ...l, sent: true };
          return { ...l, sent: false, error: ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Psyche ${res.status}` };
        } catch (e) {
          return { ...l, sent: false, error: e instanceof Error ? e.message : String(e) };
        }
      }),
    );
  }

  /** 这条评论该给谁来信：被回的那条评论的人（回复了你的评论）、帖子的主人（评论了你的帖子）；自己不给自己，Joy 不收信 */
  function lettersFor(by: string, c: Comment, post: Post, reply: Comment | null): Letter[] {
    const out: Letter[] = [];
    const tail = `\n\n（${post.by === JOY ? "Joy " : ""}帖子 ${post.id}${post.text ? `：「${head(post.text)}」` : ""}）`;
    if (reply && reply.by !== by) out.push({ to: reply.by, subject: "回复了你的评论", text: `${c.text}${tail}`, via: "moments", ext: c.id });
    if (post.by !== by && !out.some((l) => l.to === post.by)) out.push({ to: post.by, subject: "评论了你的帖子", text: `${c.text}${tail}`, via: "moments", ext: c.id });
    return out.filter((l) => l.to !== JOY);
  }

  async function imagesIn(list: unknown, thumbEdge?: number): Promise<ImageRef[]> {
    if (list === undefined || list === null) return [];
    if (!Array.isArray(list)) throw new MomentsError("images 应为数组：[{ data: base64 }]");
    const out: ImageRef[] = [];
    for (const it of list) {
      const data = (it as { data?: unknown })?.data;
      if (typeof data !== "string" || !data) throw new MomentsError("每张图要带 data（base64）");
      out.push(await save(images, Buffer.from(data, "base64"), thumbEdge));
    }
    return out;
  }

  const json = (v: unknown, status = 200) => Response.json(v, { status });

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (path === "/api/health") return json({ ok: true, name: "moments" });
      const pic = /^\/images\/(i[a-z0-9]+)(\.thumb)?\.jpg$/.exec(path);
      if (pic && req.method === "GET") {
        const bytes = readImage(images, pic[1]!, !!pic[2]);
        return bytes ? new Response(new Uint8Array(bytes), { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" } }) : json({ error: "没有这张图" }, 404);
      }
      if (!path.startsWith("/api/")) return json({ error: "没有这个地方" }, 404);

      const token = req.headers.get("x-psyche-token") ?? undefined;
      await people(token);
      const who = req.headers.get("x-moments-who") ?? "";
      if (!ID.test(who)) throw new MomentsError("请求头 x-moments-who 要写是谁（住户 id 或 Joy）");
      if (names && who !== JOY && !names.has(who)) throw new MomentsError(`全屋没有 ${who}`);
      const body = async () => {
        const b = await req.json().catch(() => null);
        if (!b || typeof b !== "object" || Array.isArray(b)) throw new MomentsError("body 要是对象");
        return b as Record<string, unknown>;
      };

      if (path === "/api/feed" && req.method === "GET") {
        const by = url.searchParams.get("by");
        const before = url.searchParams.get("before");
        const posts = store.feed({ limit: Number(url.searchParams.get("limit")) || 10, before: before ?? undefined, by: by ? resolveWho(by) : undefined });
        return json({ posts: posts.map((p) => postView(p)) });
      }
      if (path === "/api/posts" && req.method === "POST") {
        const b = await body();
        const imgs = await imagesIn(b.images);
        return json({ post: postView(store.addPost(who, { text: b.text, images: imgs })) });
      }
      const one = /^\/api\/posts\/(p[a-z0-9]+)$/.exec(path);
      if (one && req.method === "GET") {
        const p = store.getPost(one[1]!);
        return p ? json({ post: postView(p, true) }) : json({ error: `没有这条帖子（或已经删了）：${one[1]}` }, 404);
      }
      const cm = /^\/api\/posts\/(p[a-z0-9]+)\/comments$/.exec(path);
      if (cm && req.method === "POST") {
        const b = await body();
        const { comment, post, replyTo } = store.addComment(who, { post: cm[1], text: b.text, replyTo: b.replyTo });
        const letters = await deliver(who, token, lettersFor(who, comment, post, replyTo));
        return json({ comment: commentView(comment), letters });
      }
      const del = /^\/api\/(?:posts|comments)\/([pc][a-z0-9]+)$/.exec(path);
      if (del && req.method === "DELETE") return json(store.remove(who, del[1]));
      if (path === "/api/people" && req.method === "GET") {
        const ids = [JOY, ...(names?.keys() ?? [])];
        return json({ people: ids.map(profileView) });
      }
      if (path === "/api/profile" && req.method === "POST") {
        const b = await body();
        let avatar: string | null | undefined;
        if (b.avatar === null) avatar = null;
        else if (b.avatar !== undefined) avatar = (await imagesIn([b.avatar], 256))[0]!.id;
        store.setProfile(who, { bio: b.bio, avatar });
        return json({ profile: profileView(who) });
      }
      const pr = /^\/api\/profile\/([^/]+)$/.exec(path);
      if (pr && req.method === "GET") {
        const target = resolveWho(decodeURIComponent(pr[1]!));
        if (names && target !== JOY && !names.has(target)) return json({ error: `全屋没有 ${target}` }, 404);
        return json({ profile: profileView(target), posts: store.feed({ by: target, limit: 5 }).map((p) => postView(p)) });
      }
      return json({ error: "没有这个口子" }, 404);
    } catch (e) {
      if (e instanceof MomentsError) return json({ error: e.message }, 400);
      console.error(e);
      return json({ error: String(e) }, 500);
    }
  }

  return { handle, store };
}

function tokenFrom(file?: string): string | undefined {
  if (!file) return undefined;
  try {
    return readFileSync(file.replace(/^~(?=\/)/, homedir()), "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

if (import.meta.main) {
  const dir = (process.env.MOMENTS_DIR ?? join(homedir(), ".soma", "moments")).replace(/^~(?=\/)/, homedir());
  const port = Number(process.env.MOMENTS_PORT) || DEFAULT_PORT;
  const { handle } = createMoments({ dir, psycheUrl: process.env.PSYCHE_URL, houseToken: tokenFrom(process.env.MOMENTS_PSYCHE_TOKEN_FILE) });
  Bun.serve({ hostname: "127.0.0.1", port, fetch: handle, maxRequestBodySize: 200 * 1024 * 1024 });
  console.log(`朋友圈 http://127.0.0.1:${port}（数据 ${dir}）`);
}
