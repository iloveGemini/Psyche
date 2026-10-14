/**
 * REST 入口（门户的最小一版）：harness 上报事实、取经历、查档号、存取资料；
 * 它自己用的：热写、recall、<now>、提示词（m1.md §二 §四，MCP 转调这里）。
 *
 * harness 只负责上报它独有的事实（对话发生了、调用了什么工具）；处境变化单独报。
 * 鉴权：配置了 token 就要求 Bearer。
 */
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { HTTPException } from "hono/http-exception";
import { displayArchiveNo, type EventStore } from "../store/events.ts";
import type { Projections } from "../store/projections.ts";
import { intake, type IntakeItem } from "../archive/intake.ts";
import { IntakeError } from "../archive/kinds.ts";
import { readExperience } from "../archive/experience.ts";
import { recall } from "../archive/recall.ts";
import { renderNow } from "../archive/now.ts";
import { HotwriteError, readSegment, reviseEpisode, writeEpisodes } from "../catalog/hotwrite.ts";
import { localDay, parseTime } from "../core/time.ts";
import { PROMPTS_DIR, readPrompt } from "../core/prompts.ts";

export interface AppDeps {
  store: EventStore;
  projections: Projections;
  token?: string;
  /** 提示词目录，缺省仓库里的 prompts/（测试换成临时目录） */
  promptsDir?: string;
}

const num = (v: string | undefined) => (v === undefined || v === "" ? undefined : Number(v));

export function createApp({ store, token, promptsDir = PROMPTS_DIR }: AppDeps) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));
  if (token) app.use("/v1/*", bearerAuth({ token }));

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    if (err instanceof IntakeError || err instanceof HotwriteError) return c.json({ error: err.message }, 400);
    console.error(err);
    return c.json({ error: String(err) }, 500);
  });

  // 上报事实：单条或 { items: [...] }。幂等键让 harness 放心重试
  app.post("/v1/events", async (c) => {
    const body = await c.req.json();
    const items: IntakeItem[] = Array.isArray(body?.items) ? body.items : [body];
    const out = store.db.transaction(() => items.map((it) => intake(store, it)))();
    return c.json({ events: out.map((e) => ({ id: e.id, archiveNo: e.archiveNo })) });
  });

  // 处境：只在变化时写
  app.post("/v1/situation", async (c) => {
    const body = await c.req.json();
    if (typeof body?.harness !== "string") throw new IntakeError("situation 缺字段 harness");
    // at：处境从何时起（缺省 = 收到时）；source 不进 payload
    const { at, source, ...payload } = body;
    const ev = store.setSituation(payload, typeof source === "string" ? source : body.harness, typeof at === "number" ? at : undefined);
    return c.json({ id: ev.id, archiveNo: ev.archiveNo });
  });

  app.get("/v1/events", (c) => {
    const q = c.req.query();
    const events = store.list({
      from: num(q.from),
      to: num(q.to),
      kinds: q.kinds?.split(","),
      afterId: q.after,
      fonds: q.fonds,
      limit: num(q.limit),
    });
    return c.json({ events });
  });

  // 档号里有 #，客户端要 URL 编码（10-13%23112）
  app.get("/v1/archive/:no", (c) => {
    const ev = store.byArchiveNo(decodeURIComponent(c.req.param("no")));
    return ev ? c.json({ event: ev, links: store.linksFrom(ev.id), referencedBy: store.linksTo(ev.id) }) : c.json({ error: "没有这个档号" }, 404);
  });

  app.get("/v1/experience", (c) => {
    const q = c.req.query();
    return c.json({ lines: readExperience(store.db, { from: num(q.from), to: num(q.to), limit: num(q.limit) }) });
  });

  // 热写：取本段清单 + 提示词；交回情节（m1.md §二）
  app.get("/v1/hotwrite", (c) => {
    const prompt = readPrompt("hot-write.md", promptsDir);
    const seg = readSegment(store, c.req.query("session") || undefined);
    return c.json({ session: seg.session, upTo: seg.upTo, prompt: prompt.text, promptVersion: prompt.version, lines: seg.lines });
  });

  app.post("/v1/hotwrite", async (c) => {
    const body = await c.req.json();
    if (!body || typeof body !== "object") throw new HotwriteError("body 必须是对象");
    // 版本以 GET 时拿到的为准（中间提示词改了版也记得对）；没带就取当前文件的
    const version = typeof body.promptVersion === "number" ? body.promptVersion : readPrompt("hot-write.md", promptsDir).version;
    return c.json(writeEpisodes(store, body, version));
  });

  // 改写一条情节：{ target: 档号, text, felt?, why? }
  app.post("/v1/episodes/revise", async (c) => {
    const body = await c.req.json();
    if (!body || typeof body !== "object") throw new HotwriteError("body 必须是对象");
    return c.json(reviseEpisode(store, body));
  });

  // 全文检索可见经历；from / to 收毫秒、日期或 ISO 时间
  app.get("/v1/recall", (c) => {
    const q = c.req.query();
    if (!q.q?.trim()) return c.json({ error: "缺 q" }, 400);
    const from = q.from ? parseTime(q.from, store.timeZone) : undefined;
    const to = q.to ? parseTime(q.to, store.timeZone, true) : undefined;
    if (from === null || to === null) return c.json({ error: `看不懂的时间：${from === null ? q.from : q.to}` }, 400);
    const lines = recall(store.db, { q: q.q, from, to, limit: num(q.limit) });
    const year = Number(localDay(store.now(), store.timeZone).slice(0, 4));
    return c.json({ lines: lines.map((l) => ({ archiveNo: displayArchiveNo(l.archiveNo, year), at: l.at, kind: l.kind, text: l.text })) });
  });

  app.get("/v1/now", (c) => c.json({ text: renderNow(store, c.req.query("session") || undefined) }));

  app.get("/v1/prompt", (c) => c.json(readPrompt("self-v0.md", promptsDir)));

  app.post("/v1/materials", async (c) => {
    const mime = c.req.header("content-type") ?? "text/plain";
    const hash = store.putMaterial(new Uint8Array(await c.req.arrayBuffer()), mime);
    return c.json({ hash });
  });

  app.get("/v1/materials/:hash", (c) => {
    const m = store.getMaterial(c.req.param("hash"));
    return m ? new Response(m.content as Uint8Array<ArrayBuffer>, { headers: { "content-type": m.mime } }) : c.json({ error: "没有这份资料" }, 404);
  });

  // 系统日志：可查、不推送
  app.get("/v1/syslog", (c) => c.json({ entries: store.readSyslog({ kind: c.req.query("kind"), limit: num(c.req.query("limit")) }) }));

  return app;
}
