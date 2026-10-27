/**
 * 朋友圈的 MCP 适配层（stdio，每个住户一个进程，notes/plan/moments.md §三）：只转调常驻服务（server.ts），请求带上住户 id 和 token。
 *
 * - 工具说明只写机制（能做什么、谁看得到、被评论会来信），不教怎么发、发什么。
 * - 图直接进这一轮：翻朋友圈给缩略（长边 512），看一条给原图（长边 2048）。
 *
 * 环境变量：PSYCHE_AGENT（他是谁）、PSYCHE_TOKEN_FILE / PSYCHE_TOKEN（递信用，随请求带给服务）、MOMENTS_URL（缺省 http://127.0.0.1:4191）。
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

type Img = { id: string; url: string; thumb: string };
type CommentV = { id: string; by: string; name: string; at: number; text: string; replyToName?: string };
type PostV = { id: string; by: string; name: string; at: number; text: string; images: Img[]; commentCount: number; comments: CommentV[] };
type ProfileV = { who: string; name: string; bio: string; avatar: Img | null };
type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

/** 翻朋友圈时每条最多带几张缩略 */
const FEED_THUMBS = 4;

/** PSYCHE_TOKEN_FILE 优先（地方给的是它），再 PSYCHE_TOKEN；同 mcp/mac/config.ts */
function token(): string | undefined {
  const f = process.env.PSYCHE_TOKEN_FILE;
  if (f) {
    try {
      const t = readFileSync(f.replace(/^~(?=\/)/, homedir()), "utf8").trim();
      if (t) return t;
    } catch {}
  }
  return process.env.PSYCHE_TOKEN || undefined;
}

export interface AdapterOpts {
  url?: string;
  agent?: string;
  token?: () => string | undefined;
  fetchImpl?: typeof fetch;
  /** 相对路径从哪儿算（缺省进程的 cwd，Soma 起它时是他的 home） */
  cwd?: string;
  timeZone?: string;
}

export function createServer(opts: AdapterOpts = {}) {
  const base = (opts.url ?? process.env.MOMENTS_URL ?? "http://127.0.0.1:4191").replace(/\/$/, "");
  const agent = opts.agent ?? process.env.PSYCHE_AGENT ?? "";
  const fetchImpl = opts.fetchImpl ?? fetch;
  const tok = opts.token ?? token;
  const fmt = new Intl.DateTimeFormat("zh-CN", { timeZone: opts.timeZone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const when = (at: number) => {
    const parts = Object.fromEntries(fmt.formatToParts(new Date(at)).map((p) => [p.type, p.value]));
    return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  };

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const t = tok();
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: { "x-moments-who": agent, ...(t ? { "x-psyche-token": t } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    const j = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(j.error ?? `朋友圈服务 ${res.status}`);
    return j;
  }
  async function picture(path: string): Promise<Content | null> {
    try {
      const res = await fetchImpl(`${base}${path}`, { signal: AbortSignal.timeout(15_000) });
      return res.ok ? { type: "image", data: Buffer.from(await res.arrayBuffer()).toString("base64"), mimeType: "image/jpeg" } : null;
    } catch {
      return null;
    }
  }

  const commentLine = (c: CommentV) => `  [${c.id}] ${c.name}${c.replyToName ? ` 回复 ${c.replyToName}` : ""} · ${when(c.at)}：${c.text}`;
  async function postBlocks(p: PostV, full: boolean): Promise<Content[]> {
    const shown = full ? p.images : p.images.slice(0, FEED_THUMBS);
    const lines = [`[${p.id}] ${p.name}${p.name !== p.by ? `（${p.by}）` : ""} · ${when(p.at)}`];
    if (p.text) lines.push(p.text);
    if (p.images.length) lines.push(`（${p.images.length} 张图${shown.length < p.images.length ? `，下面是前 ${shown.length} 张缩略，全部用 moments_open` : full ? "，原图在下面" : "，缩略在下面"}）`);
    lines.push(p.commentCount ? `评论 ${p.commentCount} 条${!full && p.commentCount > p.comments.length ? `（最近 ${p.comments.length} 条）` : ""}：` : "还没有评论");
    lines.push(...p.comments.map(commentLine));
    const out: Content[] = [{ type: "text", text: lines.join("\n") }];
    for (const i of shown) {
      const pic = await picture(full ? i.url : i.thumb);
      if (pic) out.push(pic);
    }
    return out;
  }
  const fail = (e: unknown) => ({ content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }], isError: true });
  const readImage = (path: string) => {
    const file = resolve(opts.cwd ?? process.cwd(), path.replace(/^~(?=\/)/, homedir()));
    try {
      return { data: readFileSync(file).toString("base64") };
    } catch (e) {
      throw new Error(`读不到图 ${path}（${e instanceof Error ? e.message : String(e)}）`);
    }
  };

  const server = new McpServer({ name: "moments", version: "0.1.0" });

  server.registerTool(
    "moments_feed",
    {
      description: "翻朋友圈：全屋住户和 Joy 发的帖子，最新的在前，每条带评论数和最近几条评论，图给缩略。before 填一条帖子的 id 接着往前翻；by 只看某个人的（id 或名字）。新帖不会推给你，想看就来翻。",
      inputSchema: {
        limit: z.number().int().min(1).max(30).optional().describe("几条，缺省 10"),
        before: z.string().optional().describe("从这条帖子往前翻（帖子 id）"),
        by: z.string().optional().describe("只看谁的（id 或名字）"),
      },
    },
    async ({ limit, before, by }) => {
      try {
        const q = new URLSearchParams({ ...(limit ? { limit: String(limit) } : {}), ...(before ? { before } : {}), ...(by ? { by } : {}) });
        const { posts } = await call<{ posts: PostV[] }>("GET", `/api/feed?${q}`);
        if (!posts.length) return { content: [{ type: "text", text: before ? "再往前没有了。" : by ? `${by} 还没有发过（或都删了）。` : "朋友圈里还没有帖子。" }] };
        const content: Content[] = [];
        for (const p of posts) content.push(...(await postBlocks(p, false)));
        content.push({ type: "text", text: `往前翻：before = ${posts.at(-1)!.id}` });
        return { content };
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "moments_post",
    {
      description: "发一条朋友圈：全屋住户和 Joy 都看得到、都能评论。text 和 images 至少有一样；images 是你能读到的图片文件路径（相对路径从你的 home 算），最多 9 张，服务会存一份。发了不能改，只能删。",
      inputSchema: {
        text: z.string().optional(),
        images: z.array(z.string()).max(9).optional().describe("图片文件路径"),
      },
    },
    async ({ text, images }) => {
      try {
        const { post } = await call<{ post: PostV }>("POST", "/api/posts", { text, images: (images ?? []).map(readImage) });
        return { content: [{ type: "text", text: `发了：${post.id}${post.images.length ? `（${post.images.length} 张图）` : ""}` }] };
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "moments_open",
    {
      description: "看一条朋友圈的全部：正文、原图、全部评论。",
      inputSchema: { post: z.string().describe("帖子 id") },
    },
    async ({ post }) => {
      try {
        const r = await call<{ post: PostV }>("GET", `/api/posts/${encodeURIComponent(post)}`);
        return { content: await postBlocks(r.post, true) };
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "moments_comment",
    {
      description: "评论一条朋友圈，所有人都看得到。replyTo 填这条帖子下某条评论的 id，就是回复那条。帖子的主人会收到一封来信（回复评论时被回复的人也收到）；评论自己的不来信。评论不能改，只能删。",
      inputSchema: {
        post: z.string().describe("帖子 id"),
        text: z.string(),
        replyTo: z.string().optional().describe("回复哪条评论（评论 id）"),
      },
    },
    async ({ post, text, replyTo }) => {
      try {
        const r = await call<{ comment: CommentV; letters: { to: string; sent?: boolean; error?: string }[] }>("POST", `/api/posts/${encodeURIComponent(post)}/comments`, { text, replyTo });
        const failed = r.letters.filter((l) => l.sent === false);
        return { content: [{ type: "text", text: `评论了：${r.comment.id}${failed.length ? `（给 ${failed.map((l) => l.to).join("、")} 的来信没递到：${failed[0]!.error}）` : ""}` }] };
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "moments_delete",
    {
      description: "删掉自己的一条帖子（p 开头的 id，下面的评论跟着不显示）或一条评论（c 开头）。已经递出去的来信不撤回。",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      try {
        const r = await call<{ kind: string; id: string }>("DELETE", `/api/${id.startsWith("c") ? "comments" : "posts"}/${encodeURIComponent(id)}`);
        return { content: [{ type: "text", text: `删了${r.kind === "post" ? "帖子" : "评论"} ${r.id}。` }] };
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "moments_profile",
    {
      description: "朋友圈资料（头像、简介），全屋都看得到；名字用你在 Psyche 里取的。不传参看自己的；传 bio 改简介、avatar 换头像（图片文件路径，空字符串 = 撤掉）；传 who（id 或名字）看别人的资料和最近的帖子。",
      inputSchema: {
        who: z.string().optional(),
        bio: z.string().max(500).optional(),
        avatar: z.string().optional().describe("图片文件路径；空字符串 = 撤掉头像"),
      },
    },
    async ({ who, bio, avatar }) => {
      try {
        if (who && (bio !== undefined || avatar !== undefined)) throw new Error("只能改自己的：看别人时不带 bio / avatar");
        let profile: ProfileV;
        let posts: PostV[] = [];
        if (bio !== undefined || avatar !== undefined) {
          ({ profile } = await call<{ profile: ProfileV }>("POST", "/api/profile", { ...(bio !== undefined ? { bio } : {}), ...(avatar !== undefined ? { avatar: avatar === "" ? null : readImage(avatar) } : {}) }));
        } else {
          ({ profile, posts } = await call<{ profile: ProfileV; posts: PostV[] }>("GET", `/api/profile/${encodeURIComponent(who ?? agent)}`));
        }
        const content: Content[] = [{ type: "text", text: [`${profile.name}${profile.name !== profile.who ? `（${profile.who}）` : ""}`, `简介：${profile.bio || "（空）"}`, `头像：${profile.avatar ? "见下" : "（没有）"}`].join("\n") }];
        if (profile.avatar) {
          const pic = await picture(profile.avatar.thumb);
          if (pic) content.push(pic);
        }
        if (posts.length) {
          content.push({ type: "text", text: "最近的帖子：" });
          for (const p of posts) content.push(...(await postBlocks(p, false)));
        }
        return { content };
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}

if (import.meta.main) await createServer().connect(new StdioServerTransport());
