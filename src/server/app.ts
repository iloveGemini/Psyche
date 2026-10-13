/**
 * REST 入口（门户的最小一版）：harness 上报事实、取经历、查档号、存取资料。
 *
 * harness 只负责上报它独有的事实（对话发生了、调用了什么工具）；处境变化单独报。
 * 鉴权：配置了 token 就要求 Bearer。
 */
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { HTTPException } from "hono/http-exception";
import type { EventStore } from "../store/events.ts";
import type { Projections } from "../store/projections.ts";
import { intake, type IntakeItem } from "../archive/intake.ts";
import { IntakeError } from "../archive/kinds.ts";
import { readExperience } from "../archive/experience.ts";

export interface AppDeps {
  store: EventStore;
  projections: Projections;
  token?: string;
}

const num = (v: string | undefined) => (v === undefined || v === "" ? undefined : Number(v));

export function createApp({ store, token }: AppDeps) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));
  if (token) app.use("/v1/*", bearerAuth({ token }));

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    if (err instanceof IntakeError) return c.json({ error: err.message }, 400);
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
    const ev = store.setSituation(body, body.source ?? body.harness);
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
