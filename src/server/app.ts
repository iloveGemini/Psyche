import { randomUUID } from "node:crypto";
/**
 * REST 入口（门户的最小一版）：harness 上报事实、取经历、查档号、存取资料；
 * 它自己用的：热写、冷写、书架、recall、<now>、提示词、自述与名字、作息、收发信（m1.md §二 §四、m2.md §三、m4.md、m5.md、m6.md，MCP 转调这里）。
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
import { hybridRecall, queryVector, renderShelfHit, shelfRecall } from "../archive/recall.ts";
import type { Embedder } from "../archive/vectors.ts";
import { renderNow, noteSheetLine } from "../archive/now.ts";
import { asleepPlace, asleepTask } from "../asleep.ts";
import { renderSurfaced, surface } from "../association/surface.ts";
import { HotwriteError, readSegment, reviseEpisode, writeEpisodes } from "../catalog/hotwrite.ts";
import { pinnedRoots, pinStatus, pinnedEntries, PIN_BUDGET, cardOf } from "../self/pinned.ts";
import { ColdwriteError, readColdwrite, writeColdwrite } from "../catalog/coldwrite.ts";
import { readShelf, renderEntry, shelfDetail } from "../reading/shelf.ts";
import { computeHealth } from "../reading/health.ts";
import { computeStats } from "../reading/stats.ts";
import { localDay, parseTime } from "../core/time.ts";
import { PROMPTS_DIR, readPrompt } from "../core/prompts.ts";
import { getSettings, ScheduleError, setSchedule, setSettings, writeDiary, readSchedule } from "../heartbeat/schedule.ts";
import { deliverDue, nextWake, heartbeatNext, renderJustHappened, scheduleLine, wakeLedger, budgetUsedToday } from "../heartbeat/scheduler.ts";
import { composePrompt, currentName, nameSelf, pendingSelfLine, readSelf, rewriteSelf, SelfError, selfVersion } from "../self/self.ts";
import { factsNow, mailStateLines, noticeMail, placeOf, renderNotice } from "../channel/inbox.ts";
import { getChannels, listMail, MailError, openMail, receiveMail, sendMail, setChannels, where } from "../channel/mailbox.ts";
import type { PsycheEvent } from "../store/events.ts";
import { GIST_LIMIT, GistError, pendingGists, readGists, writeGist } from "../catalog/gist.ts";
import { renderContinuity, seedContinuity } from "../archive/continuity.ts";
import { deliverPresence, lookPresence, MoodError, setMood, enterRoom } from "../house/presence.ts";
import { changePlaylist, deliverSound, listenNow, listenWith, nowPlaying, play, readPlaylists, SoundError, stop, type SoundDeps } from "../perception/sound.ts";
import { netease, type MusicSource } from "../perception/netease.ts";
import { analyzeTrack } from "../perception/features.ts";
import { NoticeError, writeNotice } from "../perception/env.ts";
import { deliverBody } from "../perception/body.ts";
import { deliverFiles } from "../house/files.ts";
import { deliverOutside } from "../perception/outside.ts";
import { closeThread, noteThread, openThread, readThreads, ThreadError, threadsLine } from "../self/threads.ts";
import { claimedFonds, claimPast, PastError, pastBirthLines, pastRecall, readPast, type PastConfig, type PastView } from "../archive/past.ts";
import { writePastCatalog } from "../catalog/past-catalog.ts";

export interface AppDeps {
  store: EventStore;
  projections: Projections;
  token?: string;
  /** 提示词目录，缺省仓库里的 prompts/（测试换成临时目录） */
  promptsDir?: string;
  /** 嵌入服务：没有就只用字面（recall、浮现） */
  embedder?: Embedder;
  /** 写给人的信交出站（main.ts 按通道设置投递、记 mail.sent）；测试换成收集器 */
  outbox?: (ev: PsycheEvent) => void;
  /** 放歌的源（缺省网易云）；考卷换成假的 */
  music?: MusicSource;
  /** 屋里别人的库（一起听：跟着对方的播放器听、在对方库里记 ear.*）；只住一个人时没有 */
  storeOf?: (id: string) => EventStore | undefined;
  /** 我是谁（屋里的 id）：去别人库里记"谁戴上了耳机"用 */
  selfId?: string;
  /** 屋里所有住户的 id（含自己）：写信给住户用（m6.md §八） */
  residentIds?: () => string[];
  /** 他登记的前世卷宗（agents.json 的 past，archive/past.ts） */
  past?: PastConfig[];
}

const num = (v: string | undefined) => (v === undefined || v === "" ? undefined : Number(v));

export function createApp({ store, token, promptsDir = PROMPTS_DIR, embedder, outbox, music = netease, storeOf, selfId, residentIds, past }: AppDeps) {
  const sound: SoundDeps = {
    music,
    storeOf,
    analyze: (t) => void music.url(t.id).then((u) => analyzeTrack(store, t.id, u)).catch(() => {}),
  };
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));
  if (token) app.use("/v1/*", bearerAuth({ token }));

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    if (err instanceof IntakeError || err instanceof HotwriteError || err instanceof ColdwriteError || err instanceof SelfError || err instanceof ScheduleError || err instanceof MailError || err instanceof GistError || err instanceof ThreadError || err instanceof MoodError || err instanceof SoundError || err instanceof NoticeError || err instanceof PastError) return c.json({ error: err.message }, 400);
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
    if (typeof payload.model === "string") {
      // 归一化 provider 渠道前缀：如 google-vertex/gemini-4-argon -> gemini-4-argon
      payload.model = payload.model.replace(/^[a-zA-Z0-9_-]+\/(?=gemini|claude|gpt|deepseek)/, "");
    }
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

  // 卷宗上下文：展开引用与前后邻近原始行
  app.get("/v1/archive/:no/context", (c) => {
    const ev = store.byArchiveNo(decodeURIComponent(c.req.param("no")));
    if (!ev) return c.json({ error: "没有这个档号" }, 404);
    const links = store.linksFrom(ev.id);
    const citedIds = links.filter((l) => l.rel === "cites" || l.rel === "evidence").map((l) => l.to);
    const citedEvents = citedIds.map((id) => store.get(id)).filter(Boolean);

    // 取该事件前后相邻的时间范围（同 session 优先，否则同时间窗口）
    const sessionRow = store.db.query(`SELECT session FROM p_experience WHERE event_id = ?`).get(ev.id) as { session: string | null } | null;
    const session = sessionRow?.session || (ev.payload as any)?.session;
    let nearbyRows: Array<{ id: string; at: number; kind: string; day: string; seq: number; payload: string }> = [];
    if (session) {
      nearbyRows = store.db
        .query(
          `SELECT e.id, e.at, e.kind, e.day, e.seq, e.payload FROM p_experience p
           JOIN events e ON e.id = p.event_id
           WHERE p.session = ?
           ORDER BY e.at, e.id LIMIT 40`,
        )
        .all(session) as any[];
    }
    if (nearbyRows.length < 3) {
      nearbyRows = store.db
        .query(
          `SELECT id, at, kind, day, seq, payload FROM events
           WHERE fonds = ? AND at BETWEEN ? AND ?
           ORDER BY at, id LIMIT 40`,
        )
        .all(ev.fonds, ev.at - 30 * 60_000, ev.at + 30 * 60_000) as any[];
    }
    const context = nearbyRows.map((r) => ({
      id: r.id,
      at: r.at,
      kind: r.kind,
      archiveNo: `${r.day}#${r.seq}`,
      payload: JSON.parse(r.payload || "{}"),
      isSelf: r.id === ev.id,
      isCited: citedIds.includes(r.id),
    }));

    return c.json({
      event: ev,
      links,
      referencedBy: store.linksTo(ev.id),
      cited: citedEvents,
      context,
    });
  });

  app.get("/v1/experience", (c) => {
    const q = c.req.query();
    return c.json({
      lines: readExperience(store.db, {
        from: num(q.from),
        to: num(q.to),
        limit: num(q.limit),
        offset: num(q.offset),
        includeCovered: q.includeCovered === "1",
        kind: q.kind || undefined,
        q: q.q || undefined,
        order: q.order === "desc" ? "desc" : "asc",
      }),
    });
  });

  // 潜意识浮现历史与雷达
  app.get("/v1/surfaced", (c) => {
    const limit = Math.min(Math.max(1, num(c.req.query("limit")) ?? 30), 100);
    const rows = store.db
      .query(
        `SELECT id, at, day, seq, payload FROM events
         WHERE kind = 'surfaced' AND fonds = ''
         ORDER BY at DESC LIMIT ?`,
      )
      .all(limit) as { id: string; at: number; day: string; seq: number; payload: string }[];
    const items = rows.map((r) => {
      const p = JSON.parse(r.payload || "{}");
      let refEvent: any = null;
      if (p.ref) {
        const target = store.get(p.ref);
        if (target) {
          refEvent = {
            id: target.id,
            at: target.at,
            archiveNo: target.archiveNo,
            kind: target.kind,
            text: (target.payload as any)?.text || (target.payload as any)?.title || null,
          };
        }
      }
      return {
        id: r.id,
        at: r.at,
        archiveNo: `${r.day}#${r.seq}`,
        score: p.score ?? null,
        cue: p.cue ?? null,
        source: p.source ?? null,
        ref: refEvent,
      };
    });
    return c.json({ surfaced: items });
  });

  // 热写：取本段清单 + 提示词；交回情节（m1.md §二）
  app.get("/v1/hotwrite", (c) => {
    const prompt = readPrompt("hot-write.md", promptsDir);
    const seg = readSegment(store, c.req.query("session") || undefined, { brief: c.req.query("brief") === "1" });
    return c.json({ session: seg.session, upTo: seg.upTo, prompt: prompt.text, promptVersion: prompt.version, lines: seg.lines, pinned: pinStatus(store) });
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

  // 冷写：取材料 + 书架 + 候选证据；交回书架条目（m2.md §三）
  app.get("/v1/coldwrite", (c) => {
    const prompt = readPrompt("cold-write.md", promptsDir);
    return c.json({ ...readColdwrite(store, storeOf), prompt: prompt.text, promptVersion: prompt.version });
  });

  app.post("/v1/coldwrite", async (c) => {
    const body = await c.req.json();
    if (!body || typeof body !== "object") throw new ColdwriteError("body 必须是对象");
    const version = typeof body.promptVersion === "number" ? body.promptVersion : readPrompt("cold-write.md", promptsDir).version;
    return c.json(writeColdwrite(store, body, version));
  });

  // 梗概（10-16）：已写出的梗概 + 过完了还没写的段 + 材料；交回一段
  app.get("/v1/gist", (c) => {
    const prompt = readPrompt("gist.md", promptsDir);
    const gists = readGists(store).map((g) => ({ ...g, chars: Array.from(g.text).length }));
    return c.json({ gists, pending: pendingGists(store), limits: GIST_LIMIT, prompt: prompt.text, promptVersion: prompt.version });
  });

  app.post("/v1/gist", async (c) => {
    const body = await c.req.json();
    if (!body || typeof body !== "object") throw new GistError("body 必须是对象");
    return c.json(writeGist(store, body, typeof body.promptVersion === "number" ? body.promptVersion : readPrompt("gist.md", promptsDir).version));
  });

  // 接着往下过：Soma 换会话时新会话的开头（梗概 + 最近的情节）。since = 接在后面的原话从哪一刻起；
  // 带 session / seed=1 才记下这段种子放了哪些情节（浮现跳过它们，m1.md §五）
  app.get("/v1/continuity", (c) => {
    const raw = c.req.query("since");
    const since = raw ? (/^\d+$/.test(raw) ? Number(raw) : Date.parse(raw)) : undefined;
    const seed = seedContinuity(store, undefined, { since: since !== undefined && Number.isFinite(since) ? since : undefined });
    const session = c.req.query("session") || undefined;
    if (session || c.req.query("seed") === "1")
      store.append({
        kind: "continuity.seeded",
        class: "self",
        source: "psyche",
        situation: null,
        payload: { episodes: seed.episodes, ...(since !== undefined && Number.isFinite(since) ? { since } : {}), ...(session ? { session } : {}) },
      });
    return c.json(seed);
  });

  // 书架：现行条目 + 证据计数；单条详情与证据链
  app.get("/v1/shelf", (c) => {
    const year = Number(localDay(store.now(), store.timeZone).slice(0, 4));
    const entries = readShelf(store.db, { shelf: c.req.query("shelf") || undefined, q: c.req.query("q") || undefined });
    const pinned = new Set(pinnedRoots(store));
    return c.json({ entries: entries.map(({ root, current, ...e }) => ({ ...e, archiveNo: displayArchiveNo(e.archiveNo, year), ...(pinned.has(root) ? { pinned: true } : {}) })) });
  });

  app.get("/v1/shelf/:no", (c) => {
    const detail = shelfDetail(store, decodeURIComponent(c.req.param("no")));
    return detail ? c.json(detail) : c.json({ error: "没有这条书架条目" }, 404);
  });

  // 常驻区详情与历史
  app.get("/v1/pinned", (c) => {
    const year = Number(localDay(store.now(), store.timeZone).slice(0, 4));
    const { entries, used } = pinnedEntries(store);
    const shelfMap = new Map(readShelf(store.db, { includeRetired: true }).map((e) => [e.root, e]));
    const pinEvents = store.db
      .query(
        `SELECT id, at, day, seq, payload FROM events
         WHERE kind = 'pin.changed' AND fonds = ''
         ORDER BY at DESC LIMIT 30`,
      )
      .all() as { id: string; at: number; day: string; seq: number; payload: string }[];
    const resolveRoot = (rootId: string) => {
      const e = shelfMap.get(rootId);
      if (e) {
        return {
          archiveNo: displayArchiveNo(e.archiveNo, year),
          text: e.text,
          shelf: e.shelf,
        };
      }
      return {
        archiveNo: rootId,
        text: "（条目已不可寻）",
        shelf: "unknown",
      };
    };
    const history = pinEvents.map((r) => {
      const p = JSON.parse(r.payload || "{}");
      return {
        id: r.id,
        at: r.at,
        archiveNo: `${r.day}#${r.seq}`,
        pin: (p.pin || []).map(resolveRoot),
        unpin: (p.unpin || []).map(resolveRoot),
      };
    });
    return c.json({
      used,
      budget: PIN_BUDGET,
      entries: entries.map((e) => ({
        ...e,
        archiveNo: displayArchiveNo(e.archiveNo, year),
        chars: cardOf(e, year).length,
      })),
      history,
    });
  });

  // 记忆体检（dashboard.md §4.2.2）：不读私密正文，现算健康指标与闭环预警
  app.get("/v1/health", (c) => c.json(computeHealth(store)));

  // 统计：from / to 收毫秒、日期或 ISO 时间；缺省最近 7 天
  app.get("/v1/stats", (c) => {
    const q = c.req.query();
    const to = q.to ? parseTime(q.to, store.timeZone, true) : store.now();
    const from = q.from ? parseTime(q.from, store.timeZone) : (to ?? store.now()) - 7 * 86_400_000;
    if (from === null || to === null) return c.json({ error: `看不懂的时间：${from === null ? q.from : q.to}` }, 400);
    return c.json(computeStats(store.db, { from, to, now: store.now(), timeZone: store.timeZone }));
  });

  // 全文检索可见经历；from / to 收毫秒、日期或 ISO 时间
  app.get("/v1/recall", async (c) => {
    const q = c.req.query();
    if (!q.q?.trim()) return c.json({ error: "缺 q" }, 400);
    const from = q.from ? parseTime(q.from, store.timeZone) : undefined;
    const to = q.to ? parseTime(q.to, store.timeZone, true) : undefined;
    if (from === null || to === null) return c.json({ error: `看不懂的时间：${from === null ? q.from : q.to}` }, 400);
    // 这一轮的话不搜：会话省略 = 当前处境的会话
    const cur = (store.situation?.payload as { session?: unknown } | undefined)?.session;
    const session = q.session || (typeof cur === "string" ? cur : undefined);
    const qvec = await queryVector(store.db, embedder, q.q);
    const lines = await hybridRecall(store.db, embedder, { q: q.q, from, to, limit: num(q.limit), session }, qvec);
    const year = Number(localDay(store.now(), store.timeZone).slice(0, 4));
    // 书架上的条目（它冷写时整理的）排在前面，带依据的档号；时间范围只管经历
    const show = (no: string) => displayArchiveNo(no, year);
    const shelf =
      from === undefined && to === undefined
        ? shelfRecall(store.db, q.q, qvec, qvec ? embedder!.model : null).map((e) => ({ archiveNo: e.archiveNo, at: e.at, kind: "semantic", text: renderShelfHit(e, show) }))
        : [];
    // 认领了的前世：原话字面查，排在最后、标「前世」（archive/past.ts）
    const pastLines = from === undefined && to === undefined ? pastRecall(store, q.q) : [];
    return c.json({ lines: [...shelf, ...lines, ...pastLines].map((l) => ({ archiveNo: displayArchiveNo(l.archiveNo, year), at: l.at, kind: l.kind, text: l.text })) });
  });

  // <now>：事实 + 浮现（m3.md §五）。每次取都算一次浮现、记 surfaced
  // <now>（m1 / m5 / m6 / m8 拼起来的）：Soma 每轮取一次；睡着那段的第一条也用它
  const nowText = async (session: string | undefined, q: { muted?: string; room?: string; agendas?: string; ctx?: string; wrapAt?: string; q5h?: string; q5hReset?: string; q7d?: string; q7dReset?: string } = {}) => {
    // 到点的闹钟 / 定点：此刻递进来（写 due），只带这一次（m5.md §二.1）；来信 / 交接信只报有信（m6.md §二）
    const here = placeOf(store, session);
    const facts = factsNow(store, here);
    const notices = noticeMail(store, here, facts);
    const just = renderJustHappened(store, deliverDue(store), notices.map((n) => ({ at: n.ev.at, line: renderNotice(store, n) })));
    const mail = mailStateLines(store, here, facts, notices);
    const extra = [
      pendingSelfLine(store, promptsDir),
      ...mail.lines,
      scheduleLine(store, { held: mail.held }),
      threadsLine(store),
      noteSheetLine(store, session),
      roomLine(q.room),
      mutedLine(q.muted),
      agendaLines(q.agendas),
    ]
      .filter(Boolean)
      .join("\n");
    let text = extra ? renderNow(store, session).replace(/\n<\/now>$/, () => `\n${extra}\n</now>`) : renderNow(store, session);
    const s = renderSurfaced(await surface(store, embedder, { session, storeOf }));
    // 屋里有谁（m8.md §二 §五）：本会话上次递到之后的变化，递了就是它经历过的
    const house = deliverPresence(store, session);
    const heard = await deliverSound(store, sound, session).catch(() => null);
    // 内感受（m8.md §六.1）：上下文多满由 Soma 带来
    const quota = {
      ...(num(q.q5h) !== undefined ? { fiveHour: { pct: num(q.q5h)!, resetsAt: q.q5hReset || null } } : {}),
      ...(num(q.q7d) !== undefined ? { sevenDay: { pct: num(q.q7d)!, resetsAt: q.q7dReset || null } } : {}),
    };
    const body = deliverBody(store, session, { ctx: num(q.ctx), wrapAt: num(q.wrapAt), ...(quota.fiveHour || quota.sevenDay ? { quota } : {}) });
    const things = deliverFiles(store, session, (id) => {
      const other = storeOf?.(id);
      return (other && currentName(other)) || id;
    });
    const outside = deliverOutside(store, session);
    for (const block of [just, body, house, things, outside, heard, s]) if (block) text = text.replace(/\n<\/now>$/, () => `\n\n${block}\n</now>`);
    return text;
  };
  app.get("/v1/now", async (c) => {
    const q = c.req.query();
    return c.json({ text: await nowText(q.session || undefined, q) });
  });

  // 睡着的那段（m5.md §三 10-17 改）：Psyche 出内容、记处境，跑模型的是 Soma（同一个身体）
  app.post("/v1/asleep/start", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { by?: unknown; note?: unknown; session?: unknown; model?: unknown };
    if (typeof body.by !== "string" || !body.by) throw new IntakeError("asleep/start 要 by");
    const wake = { by: body.by, ...(typeof body.note === "string" && body.note ? { note: body.note } : {}), ...(typeof body.session === "string" && body.session ? { session: body.session } : {}) };
    const session = randomUUID();
    const prompt = composePrompt(store, promptsDir);
    const rawModel = typeof body.model === "string" ? body.model.replace(/^[a-zA-Z0-9_-]+\/(?=gemini|claude|gpt|deepseek)/, "") : undefined;
    store.setSituation({ harness: "sleep", session, ...(rawModel ? { model: rawModel } : {}), selfPromptVersion: prompt.version }, "sleep");
    intake(store, { kind: "woke", source: "sleep", payload: { by: wake.by, ...(wake.note ? { note: wake.note } : {}), ...(wake.session ? { for: wake.session } : {}), session } });
    const lines = (wake.by === "catchup" || wake.by === "wrapup") && wake.session ? readSegment(store, wake.session).lines.length : undefined;
    const first = [await nowText(session), asleepTask(wake, lines), wake.by === "birth" ? pastBirthLines(store, past) : ""].filter(Boolean).join("\n\n");
    return c.json({ session, system: `${prompt.text}\n\n${asleepPlace(wake.by)}`, first });
  });
  app.post("/v1/asleep/end", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { session?: unknown };
    if (typeof body.session !== "string" || !body.session) throw new IntakeError("asleep/end 要 session");
    intake(store, { kind: "slept", source: "sleep", payload: { session: body.session }, idem: `${body.session}:slept` });
    return c.json({ ok: true });
  });

  // 只算不写：考卷与调试，带各候选的分项
  app.get("/v1/surface", async (c) => {
    const q = c.req.query();
    return c.json(await surface(store, embedder, { session: q.session || undefined, dry: q.dry !== "0", seed: num(q.seed) }));
  });

  // 系统提示词 = 机制 + 现行自述（m4.md §四）；Soma 每会话开头取一次
  app.get("/v1/prompt", (c) => c.json(composePrompt(store, promptsDir)));

  // 自我：看自己、改自述、取名（m4.md §三 §四）
  app.get("/v1/self", (c) => c.json(readSelf(store, promptsDir)));
  app.get("/v1/self/prompt/:version", (c) => {
    const t = selfVersion(store, Number(c.req.param("version")), promptsDir);
    return t === null ? c.json({ error: "没有这一版" }, 404) : c.json({ version: Number(c.req.param("version")), text: t });
  });
  app.post("/v1/self/prompt", async (c) => {
    const body = await c.req.json();
    if (!body || typeof body !== "object") throw new SelfError("body 必须是对象");
    return c.json(rewriteSelf(store, body, promptsDir));
  });
  app.post("/v1/self/name", async (c) => {
    const body = await c.req.json();
    if (!body || typeof body !== "object") throw new SelfError("body 必须是对象");
    return c.json(nameSelf(store, body));
  });

  // 作息、设置、日记、唤醒账本（m5.md §四 §八）
  app.get("/v1/schedule", (c) => {
    const cur = readSchedule(store);
    const settings = getSettings(store);
    const hb = heartbeatNext(store, settings);
    return c.json({ ...(cur ?? { schedule: null }), next: nextWake(store), nextHeartbeat: hb?.due ?? null, budget: { used: budgetUsedToday(store), of: settings.wakeBudget }, settings });
  });
  app.post("/v1/schedule", async (c) => {
    const body = await c.req.json();
    if (!body || typeof body !== "object") throw new ScheduleError("body 必须是对象");
    return c.json(setSchedule(store, body));
  });
  app.post("/v1/diary", async (c) => {
    const body = await c.req.json();
    if (!body || typeof body !== "object") throw new ScheduleError("body 必须是对象");
    return c.json(writeDiary(store, body));
  });
  app.get("/v1/settings", (c) => c.json(getSettings(store)));
  app.post("/v1/settings", async (c) => {
    const body = await c.req.json();
    if (!body || typeof body !== "object") throw new ScheduleError("body 必须是对象");
    return c.json(setSettings(store, body));
  });
  app.get("/v1/wakes", (c) => c.json(wakeLedger(store, num(c.req.query("days")) ?? 7)));

  // 还开着的事（m7.md §四）
  const obj = async (c: { req: { json: () => Promise<unknown> } }) => {
    const b = await c.req.json();
    if (!b || typeof b !== "object" || Array.isArray(b)) throw new ThreadError("body 必须是对象");
    return b as Record<string, unknown>;
  };
  app.get("/v1/threads", (c) => {
    const all = readThreads(store).map(({ id, ...t }) => t);
    return c.json({ open: all.filter((t) => !t.closed), ...(c.req.query("all") === "1" ? { closed: all.filter((t) => t.closed) } : {}) });
  });
  app.post("/v1/threads", async (c) => c.json(openThread(store, await obj(c))));
  app.post("/v1/threads/note", async (c) => c.json(noteThread(store, await obj(c))));
  app.post("/v1/threads/close", async (c) => c.json(closeThread(store, await obj(c))));

  // 感知：看一眼屋里、挂个签（m8.md §二 §五）
  // 前世今生（archive.md §四）：翻（不认领也能）、认领（导进单独的全宗）、编目
  app.get("/v1/past", (c) => {
    const q = c.req.query();
    const view = (q.view || (q.fonds ? "overview" : "list")) as PastView["view"];
    // fonds：有哪几份、认没认领（MCP 启动时按这个决定挂不挂前世三件）
    const claimed = new Set(claimedFonds(store));
    return c.json({
      text: readPast(store, past, { view, fonds: q.fonds, key: q.key, q: q.q, id: q.id, page: num(q.page) }),
      fonds: (past ?? []).map((p) => ({ fonds: p.fonds, claimed: claimed.has(p.fonds) })),
    });
  });
  app.post("/v1/past/claim", async (c) => {
    const r = claimPast(store, past, (await obj(c)) as Record<string, unknown>);
    return c.json({ archiveNo: r.claimed.archiveNo, imported: r.imported, skipped: r.skipped });
  });
  app.post("/v1/past/catalog", async (c) => c.json({ entries: writePastCatalog(store, (await obj(c)) as Record<string, unknown>).map((e) => e.archiveNo) }));

  app.get("/v1/look", (c) => c.json({ text: lookPresence(store, c.req.query("session") || undefined) }));
  app.post("/v1/mood", async (c) => {
    const b = await c.req.json();
    if (!b || typeof b !== "object" || Array.isArray(b)) throw new MoodError("body 必须是对象");
    return c.json(setMood(store, b as Record<string, unknown>));
  });
  app.post("/v1/room", async (c) => {
    const b = await c.req.json();
    if (!b || typeof b !== "object" || Array.isArray(b)) throw new MoodError("body 必须是对象");
    return c.json(enterRoom(store, b as Record<string, unknown>));
  });

  // 自己的声音（m8.md §三）
  const obj2 = async (c: { req: { json: () => Promise<unknown> } }) => {
    const b = await c.req.json().catch(() => ({}));
    if (!b || typeof b !== "object" || Array.isArray(b)) throw new SoundError("body 必须是对象");
    return b as Record<string, unknown>;
  };
  app.post("/v1/play", async (c) => {
    const { playing, of, mismatch } = await play(store, music, await obj2(c));
    void ensureFirst(playing.id);
    return c.json({ playing, of, ...(mismatch ? { mismatch } : {}) });
  });
  const ensureFirst = (id: string) => music.url(id).then((u) => analyzeTrack(store, id, u)).catch(() => {});
  app.post("/v1/stop", (c) => c.json(stop(store)));
  app.get("/v1/playlist", (c) => c.json({ playlists: Object.fromEntries(readPlaylists(store)) }));
  app.post("/v1/playlist", async (c) => c.json(await changePlaylist(store, music, await obj2(c))));
  app.get("/v1/listen", async (c) => c.json({ text: await listenNow(store, sound, c.req.query("session") || undefined) }));
  app.post("/v1/listen/with", async (c) => {
    const b = await obj2(c);
    const host = b.host === null || b.host === "" ? null : typeof b.host === "string" ? b.host.trim() : undefined;
    if (host === undefined) throw new SoundError("host 应为住户 id（摘下给 null）");
    if (host === selfId) throw new SoundError("那是你自己的播放器");
    if (host !== null && !storeOf?.(host)) throw new SoundError(`屋里没有 ${host}`);
    const r: { joined?: string; left?: string } = listenWith(store, host);
    const me = selfId ?? "?";
    if (r.left) storeOf?.(r.left)?.append({ kind: "ear.left", class: "experience", source: "house", situation: null, payload: { who: me } });
    if (r.joined) storeOf?.(r.joined)?.append({ kind: "ear.joined", class: "experience", source: "house", situation: null, payload: { who: me } });
    return c.json(r);
  });
  app.post("/v1/notice", async (c) => {
    const r = writeNotice(store, await obj2(c), storeOf);
    return c.json({ archiveNo: displayArchiveNo(r.archiveNo, Number(localDay(store.now(), store.timeZone).slice(0, 4))), env: r.env });
  });
  app.get("/v1/playing", (c) => {
    const p = nowPlaying(store);
    return c.json(p ? { track: p.track, pos: p.pos, index: p.index, of: p.of } : { track: null });
  });

  // 收件箱与通道（m6.md §五）
  const body = async (c: { req: { json: () => Promise<unknown> } }) => {
    const b = await c.req.json();
    if (!b || typeof b !== "object" || Array.isArray(b)) throw new MailError("body 必须是对象");
    return b as Record<string, unknown>;
  };
  app.post("/v1/mail/in", async (c) => c.json(receiveMail(store, await body(c))));
  app.post("/v1/mail/out", async (c) => {
    const housemates = (residentIds?.() ?? []).filter((id) => id !== selfId && storeOf?.(id));
    const { ev, ...r } = sendMail(store, await body(c), housemates);
    const p = ev.payload as { to: string; text: string; subject?: string; urgent?: boolean };
    if (housemates.includes(p.to)) {
      // 屋里的信：直接进对方的库，之后跟 Joy 来信一样（报有信、叫醒、翻开、回信）
      try {
        receiveMail(storeOf!(p.to)!, { from: selfId, text: p.text, via: "house", ...(p.subject ? { subject: p.subject } : {}), ...(p.urgent ? { urgent: true } : {}), ext: ev.id });
        store.syslog("mail.sent", { ref: ev.id, via: "house", ok: true });
      } catch (e) {
        store.syslog("mail.sent", { ref: ev.id, via: "house", ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    } else if (p.to !== "self") outbox?.(ev);
    return c.json(r);
  });
  app.get("/v1/mail", (c) => c.json(listMail(store, num(c.req.query("days")) ?? 7, c.req.query("full") === "1")));
  app.post("/v1/mail/open", async (c) => c.json(openMail(store, (await body(c)).refs)));
  app.get("/v1/where", (c) => c.json(where(store)));
  app.get("/v1/channels", (c) => c.json(getChannels(store)));
  app.post("/v1/channels", async (c) => c.json(setChannels(store, await body(c))));

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

/**
 * 群里的议题（Soma 每轮带来，Soma 101 10-18）：住户自己开的讨论，招人时只在这里看得到，不叫醒谁。
 * 是此刻的状态，每轮都报，不记经历。
 */
function agendaLines(raw: string | undefined): string | null {
  let list: unknown;
  try {
    list = raw ? JSON.parse(raw) : [];
  } catch {
    return null;
  }
  if (!Array.isArray(list)) return null;
  const hhmm = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const lines = list
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object" && typeof (a as { title?: unknown }).title === "string")
    .map((a) => {
      const joined = Array.isArray(a.joined) ? a.joined.map(String) : [];
      const head = `《${a.room}》里 ${a.by} 开的《${a.title}》`;
      if (a.state === "running") return `- ${head}正在开（第 ${a.round ?? 0}/${a.rounds} 轮，${joined.join("、")}）${a.mine ? "，轮到你时会叫你" : ""}`;
      const left = Math.max(0, Number(a.need) - joined.length);
      const about = typeof a.about === "string" && a.about ? `：${a.about}` : "";
      return `- ${head}${about}，在招人：已报名 ${joined.join("、")}，还差 ${left} 人，${hhmm(String(a.until))} 前${a.mine ? "（你报名了）" : `——想来就 agenda join ${a.id}`}`;
    });
  return lines.length ? `议题：\n${lines.join("\n")}` : null;
}

/**
 * 在哪个房间（Soma 每轮带来，P3 10-19）：在哪、还有谁在、有几条没读。在房间里才听得到那里说的话；
 * 睡着时 Joy 在那里说的不叫醒他（除非她标了紧急），醒了靠这一行知道。是此刻的状态，每轮都报，不记经历。
 */
function roomLine(raw: string | undefined): string | null {
  let r: { in?: unknown; with?: unknown; unread?: unknown } | null;
  try {
    r = raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
  if (!r || typeof r !== "object") return null;
  if (typeof r.in !== "string" || !r.in) return "房间：你在自己房间——公共房间里说的话这里听不到（rooms 看有哪些房间、进哪间）";
  const others = Array.isArray(r.with) ? r.with.filter((n): n is string => typeof n === "string" && !!n) : [];
  const unread = typeof r.unread === "number" && r.unread > 0 ? r.unread : 0;
  return `房间：你在《${r.in}》${others.length ? `，${others.join("、")} 也在` : "，就你一个"}${unread ? `；有 ${unread} 条没读（rooms 的 read 看）` : ""}`;
}

/**
 * 在哪些房间被静音（Soma 每轮带来，soma2.md §5.7，a1 提）：静音了就没人来问，不说它会以为大家都安静了。
 * 是此刻的状态，每轮都报，不记经历。
 */
function mutedLine(raw: string | undefined): string | null {
  let names: unknown;
  try {
    names = raw ? JSON.parse(raw) : [];
  } catch {
    return null;
  }
  const list = Array.isArray(names) ? names.filter((n): n is string => typeof n === "string" && !!n) : [];
  if (!list.length) return null;
  return `房间：你在${list.map((n) => `《${n}》`).join("、")}被静音了（连着两次没说话）——那里不会再轮到你，等 Joy 开新话题或有人 @ 你才会再问你`;
}
