/**
 * 朋友圈的数据（notes/plan/moments.md §二）：资料、帖子、评论，一个 SQLite。
 *
 * - 帖子、评论能删不能改：删了留墓碑（deleted = 时刻），列表里不显示；帖子删了评论跟着不显示。
 * - 评论楼中楼一层：replyTo = 回的哪条评论，回复的回复也挂在同一楼里（谁回谁照记）。
 * - 谁在说话由调用方给（`by`：住户 id 或 Joy），这里不认人；名字也不存，展示时由服务问 Psyche。
 */
import { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";

export class MomentsError extends Error {}

export interface ImageRef { id: string; w?: number; h?: number }
export interface Post { id: string; by: string; at: number; text: string; images: ImageRef[]; deleted?: number }
export interface Comment { id: string; post: string; by: string; at: number; text: string; replyTo?: string; replyToBy?: string; deleted?: number }
export interface Profile { who: string; bio: string; avatar: string | null; at: number | null }

export const MAX_TEXT = 4000;
export const MAX_IMAGES = 9;

const rid = (prefix: string) => `${prefix}${randomBytes(4).readUInt32BE(0).toString(36).padStart(6, "0").slice(-6)}`;

export function openStore(file: string, now: () => number = Date.now) {
  const db = new Database(file, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, by TEXT NOT NULL, at INTEGER NOT NULL, text TEXT NOT NULL, images TEXT NOT NULL, deleted INTEGER);
    CREATE INDEX IF NOT EXISTS posts_at ON posts(at);
    CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, post TEXT NOT NULL, by TEXT NOT NULL, at INTEGER NOT NULL, text TEXT NOT NULL, reply_to TEXT, deleted INTEGER);
    CREATE INDEX IF NOT EXISTS comments_post ON comments(post, at);
    CREATE TABLE IF NOT EXISTS profiles (who TEXT PRIMARY KEY, bio TEXT NOT NULL DEFAULT '', avatar TEXT, at INTEGER);
  `);

  type PostRow = { id: string; by: string; at: number; text: string; images: string; deleted: number | null };
  type CommentRow = { id: string; post: string; by: string; at: number; text: string; reply_to: string | null; deleted: number | null };
  const post = (r: PostRow): Post => ({ id: r.id, by: r.by, at: r.at, text: r.text, images: JSON.parse(r.images), ...(r.deleted ? { deleted: r.deleted } : {}) });
  const comment = (r: CommentRow & { reply_by?: string | null }): Comment => ({
    id: r.id, post: r.post, by: r.by, at: r.at, text: r.text,
    ...(r.reply_to ? { replyTo: r.reply_to } : {}), ...(r.reply_by ? { replyToBy: r.reply_by } : {}), ...(r.deleted ? { deleted: r.deleted } : {}),
  });
  const COMMENT_SQL = `SELECT c.*, p.by AS reply_by FROM comments c LEFT JOIN comments p ON p.id = c.reply_to`;

  const text = (v: unknown, label: string) => {
    if (typeof v !== "string" || !v.trim()) throw new MomentsError(`${label}是空的`);
    if (Array.from(v).length > MAX_TEXT) throw new MomentsError(`${label}超过 ${MAX_TEXT} 字`);
    return v.trim();
  };

  /** 活着的帖子（删了的当没有） */
  function getPost(id: string): Post | null {
    const r = db.query(`SELECT * FROM posts WHERE id = ?`).get(id) as PostRow | null;
    return r && !r.deleted ? post(r) : null;
  }

  function getComment(id: string): Comment | null {
    const r = db.query(`${COMMENT_SQL} WHERE c.id = ?`).get(id) as CommentRow | null;
    return r && !r.deleted ? comment(r) : null;
  }

  function profile(who: string): Profile {
    const r = db.query(`SELECT * FROM profiles WHERE who = ?`).get(who) as Profile | null;
    return r ?? { who, bio: "", avatar: null, at: null };
  }

  function comments(postId: string): Comment[] {
    return (db.query(`${COMMENT_SQL} WHERE c.post = ? AND c.deleted IS NULL ORDER BY c.at, c.rowid`).all(postId) as CommentRow[]).map(comment);
  }

  return {
    db,
    addPost(by: string, body: { text?: unknown; images?: ImageRef[] }): Post {
      const images = body.images ?? [];
      if (images.length > MAX_IMAGES) throw new MomentsError(`一条最多 ${MAX_IMAGES} 张图`);
      const t = typeof body.text === "string" && body.text.trim() ? text(body.text, "正文") : "";
      if (!t && !images.length) throw new MomentsError("正文和图都是空的");
      const p: Post = { id: rid("p"), by, at: now(), text: t, images };
      db.query(`INSERT INTO posts (id, by, at, text, images) VALUES (?, ?, ?, ?, ?)`).run(p.id, by, p.at, p.text, JSON.stringify(images));
      return p;
    },
    getPost,
    /** 最新的在前；before = 某条帖子 id 或时刻，往前翻 */
    feed(opts: { limit?: number; before?: string | number; by?: string } = {}): Post[] {
      const limit = Math.min(Math.max(1, opts.limit ?? 10), 50);
      let before = Number.MAX_SAFE_INTEGER;
      if (typeof opts.before === "number") before = opts.before;
      else if (typeof opts.before === "string" && opts.before) {
        const r = db.query(`SELECT at FROM posts WHERE id = ?`).get(opts.before) as { at: number } | null;
        if (!r) throw new MomentsError(`没有这条帖子：${opts.before}`);
        before = r.at;
      }
      const rows = (opts.by
        ? db.query(`SELECT * FROM posts WHERE deleted IS NULL AND at < ? AND by = ? ORDER BY at DESC LIMIT ?`).all(before, opts.by, limit)
        : db.query(`SELECT * FROM posts WHERE deleted IS NULL AND at < ? ORDER BY at DESC LIMIT ?`).all(before, limit)) as PostRow[];
      return rows.map(post);
    },
    comments,
    commentCount(postId: string): number {
      return (db.query(`SELECT COUNT(*) AS n FROM comments WHERE post = ? AND deleted IS NULL`).get(postId) as { n: number }).n;
    },
    getComment,
    addComment(by: string, body: { post?: unknown; text?: unknown; replyTo?: unknown }): { comment: Comment; post: Post; replyTo: Comment | null } {
      const p = typeof body.post === "string" ? getPost(body.post) : null;
      if (!p) throw new MomentsError(`没有这条帖子（或已经删了）：${String(body.post)}`);
      let reply: Comment | null = null;
      if (body.replyTo !== undefined && body.replyTo !== null && body.replyTo !== "") {
        reply = typeof body.replyTo === "string" ? getComment(body.replyTo) : null;
        if (!reply || reply.post !== p.id) throw new MomentsError(`replyTo 要是这条帖子下的一条评论：${String(body.replyTo)}`);
      }
      const c: Comment = { id: rid("c"), post: p.id, by, at: now(), text: text(body.text, "评论"), ...(reply ? { replyTo: reply.id, replyToBy: reply.by } : {}) };
      db.query(`INSERT INTO comments (id, post, by, at, text, reply_to) VALUES (?, ?, ?, ?, ?, ?)`).run(c.id, c.post, by, c.at, c.text, reply?.id ?? null);
      return { comment: c, post: p, replyTo: reply };
    },
    /** 删自己的帖子或评论（id 以 p / c 开头）；别人的、没有的、已删的 → 拒 */
    remove(by: string, id: unknown): { kind: "post" | "comment"; id: string } {
      if (typeof id !== "string") throw new MomentsError("id 是空的");
      const table = id.startsWith("p") ? "posts" : id.startsWith("c") ? "comments" : null;
      const r = table ? (db.query(`SELECT by, deleted FROM ${table} WHERE id = ?`).get(id) as { by: string; deleted: number | null } | null) : null;
      if (!r || r.deleted) throw new MomentsError(`没有这条（或已经删了）：${id}`);
      if (r.by !== by) throw new MomentsError("只能删自己的");
      db.query(`UPDATE ${table} SET deleted = ? WHERE id = ?`).run(now(), id);
      return { kind: table === "posts" ? "post" : "comment", id };
    },
    profile,
    setProfile(who: string, patch: { bio?: unknown; avatar?: string | null }): Profile {
      const old = profile(who);
      let bio = old.bio;
      if (patch.bio !== undefined) {
        if (typeof patch.bio !== "string") throw new MomentsError("bio 应为字符串");
        if (Array.from(patch.bio).length > 500) throw new MomentsError("bio 超过 500 字");
        bio = patch.bio.trim();
      }
      const avatar = patch.avatar === undefined ? old.avatar : patch.avatar;
      db.query(`INSERT INTO profiles (who, bio, avatar, at) VALUES (?, ?, ?, ?) ON CONFLICT(who) DO UPDATE SET bio = excluded.bio, avatar = excluded.avatar, at = excluded.at`).run(who, bio, avatar, now());
      return profile(who);
    },
  };
}

export type MomentsStore = ReturnType<typeof openStore>;
