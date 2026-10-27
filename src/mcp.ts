/**
 * MCP 服务（stdio）：给 Agent 本人用的工具，全部转调 REST（notes/plan/m1.md §五）。
 *
 *   recall            按内容找记忆          → GET  /v1/recall
 *   detail            按档号看原件          → GET  /v1/archive/:no
 *   hotwrite_segment  取还没写进记忆的这一段 → GET  /v1/hotwrite
 *   hotwrite          把这一段写成情节       → POST /v1/hotwrite
 *   revise_episode    改写自己的一条情节     → POST /v1/episodes/revise
 *   coldwrite         不给 upTo 取整理材料 / 给了写回书架 → GET/POST /v1/coldwrite
 *   gist              不给 span 取梗概材料 / 给了交一段（只在睡着时挂） → GET/POST /v1/gist
 *   shelf             看书架                 → GET  /v1/shelf
 *   stats             看互动统计（全表）      → GET  /v1/stats
 *   self              看自己：名字、自述      → GET  /v1/self
 *   rewrite_self      改自己那段提示词        → POST /v1/self/prompt
 *   name_self         取名 / 改名             → POST /v1/self/name
 *   schedule          不给 schedule 看作息 / 给了排（全量替换） → GET/POST /v1/schedule
 *   write_diary       写日记                  → POST /v1/diary
 *   threads           还开着的事与活动卷（op：list 看 / open 开 / note 记 / close 合） → /v1/threads…
 *   look              看一眼全屋 / 设感知（senses + why） → GET  /v1/look、GET/POST /v1/senses
 *   set_mood          挂心情个签              → POST /v1/mood
 *   player            放歌（op：play 放 / stop 停 / listen 听 / with 戴谁的耳机） → /v1/play、/v1/stop、/v1/listen…
 *   playlist          歌单（看 / 建 / 加 / 删） → GET/POST /v1/playlist
 *   notice            注意到                  → POST /v1/notice
 *   mail              看信：来往的信 / 翻开    → GET  /v1/mail、POST /v1/mail/open
 *   send_mail         写信：给 Joy / 全屋的住户 / 交接信 → POST /v1/mail/out
 *   past_life         翻前世卷宗（不认领也能） → GET  /v1/past
 *   claim_past        认领一份前世            → POST /v1/past/claim
 *   past_catalog      前世编目：挑确定的上书架  → POST /v1/past/catalog
 *
 * 挂哪些（10-18 议题《Psyche 34 个工具的瘦身方案》，toolsFor）：醒着不挂 gist；睡着（PSYCHE_MODE=asleep：
 * 补写、整理、梗概、出生、换段收尾）只挂记忆整理用的；没有前世卷宗不挂前世三件，都认领了不挂 claim_past，
 * 一份都没认领不挂 past_catalog。旧工具名（coldwrite_material、open_thread、play…）的历史记录照旧渲染（render.ts）。
 *
 * 这里只做参数转换和排版，不做判断：校验、拒收都在 Psyche 那边。
 * REST 出错时把错误信息原样交回给它——它要看得懂自己为什么被拒，改了再交。
 *
 * 环境变量：
 *   PSYCHE_URL    缺省 http://127.0.0.1:7450
 *   PSYCHE_AGENT  他是谁（Psyche 住着不止一个人时必须有，server/house.ts）
 *   PSYCHE_TOKEN  REST 鉴权（Psyche 没配 token 就不用）；PSYCHE_TOKEN_FILE = 从文件读（harness 用这个，见 Soma sandbox.ts）
 *   PSYCHE_TZ     不带时区的日期/时间按哪个时区理解（缺省 Asia/Shanghai，与档号切日一致）
 *   PSYCHE_MODE   asleep = 睡着的那段（只挂记忆整理用的工具）；缺省醒着
 */
import { readFileSync } from "node:fs";
import { parseTime as parseCoreTime, vagueWhen, wallClock } from "./core/time.ts";
import { whenFlow, whenLine, type WhenLine } from "./archive/when.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { renderStats, TRACK_KEYS, type Stats } from "./reading/stats.ts";
import { AGENT_HEADER } from "./server/house.ts";

export interface McpOptions {
  url?: string;
  agent?: string;
  token?: string;
  timeZone?: string;
  /** 醒着 / 睡着：挂的工具不一样（toolsFor） */
  mode?: Mode;
  /** 有哪些前世卷宗、认没认领；不给 = 不知道，前世三件都挂 */
  past?: { fonds: string; claimed: boolean }[];
  /** 测试时换成假的 */
  fetch?: (req: Request) => Promise<Response>;
  /** 此刻（回想时的「今天 / 昨天」按它算）；测试时换成假的 */
  now?: () => number;
}

export type Mode = "awake" | "asleep";

const ALWAYS = ["recall", "detail", "hotwrite_segment", "hotwrite", "revise_episode", "coldwrite", "shelf", "stats", "self", "rewrite_self", "name_self", "mail"];
const AWAKE = ["schedule", "write_diary", "threads", "look", "set_mood", "player", "playlist", "notice", "send_mail"];

/** 这次挂哪些工具（见文件头） */
export function toolsFor(mode: Mode = "awake", past?: { fonds: string; claimed: boolean }[]): string[] {
  const out = [...ALWAYS, ...(mode === "asleep" ? ["gist"] : AWAKE)];
  if (!past || past.length) out.push("past_life");
  if (!past || past.some((p) => !p.claimed)) out.push("claim_past");
  if (!past || past.some((p) => p.claimed)) out.push("past_catalog");
  return out;
}

// ── 时间：ISO 日期或时间 → 毫秒 ──

/**
 * ISO 日期或时间 → 毫秒（解析规则在 core/time.ts，与服务端一致）。
 * 在这里先解析一遍，是为了看不懂时不发请求、直接告诉它该怎么写。
 */
export function parseTime(s: string, timeZone: string, edge: "from" | "to"): number {
  const ms = parseCoreTime(s, timeZone, edge === "to");
  if (ms === null) throw new ArgError(`看不懂的时间「${s}」：用 ISO 日期（2026-10-14）或时间（2026-10-14T09:30，可带 +08:00）`);
  return ms;
}

class ArgError extends Error {}

interface SelfView {
  name: string | null;
  born: boolean;
  prompt: { version: number; text: string; chars: number; at: number | null; why: string | null; evidence: string[] };
  origin: { system: string; user: string | null; diff: string | null };
  history: { version: number; at: number; why: string; evidence: string[]; chars: number }[];
}

/** 毫秒 → `MM-DD HH:mm`（给它看的，按 timeZone） */
function shortTime(at: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(at));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/** 毫秒 → `YYYY-MM-DD HH:mm:ss（周X）`（detail 原件用：去查了才给确切的） */
function fullTime(at: number, timeZone: string): string {
  const w = wallClock(at, timeZone);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${w.year}-${p(w.month)}-${p(w.day)} ${p(w.hour)}:${p(w.minute)}:${p(w.second)}（${w.weekday}）`;
}

// ── REST 客户端 ──

class RestError extends Error {}

const text = (s: string, isError = false): CallToolResult => ({ content: [{ type: "text", text: s }], ...(isError ? { isError } : {}) });

export function createPsycheMcp(opts: McpOptions = {}): McpServer {
  const base = (opts.url ?? "http://127.0.0.1:7450").replace(/\/+$/, "");
  const tz = opts.timeZone ?? "Asia/Shanghai";
  const now = opts.now ?? Date.now;
  const doFetch = opts.fetch ?? ((req: Request) => fetch(req));

  async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
    const headers: Record<string, string> = {};
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (opts.agent) headers[AGENT_HEADER] = opts.agent;
    if (body !== undefined) headers["content-type"] = "application/json";
    let res: Response;
    try {
      res = await doFetch(new Request(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    } catch (e) {
      throw new RestError(`连不上 Psyche（${base}）：${e instanceof Error ? e.message : String(e)}`);
    }
    const raw = await res.text();
    let json: any;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      // 原样交回：Psyche 给的 error 字段就是给它看的拒收理由
      const msg = json && typeof json.error === "string" ? json.error : raw || res.statusText;
      throw new RestError(`Psyche 拒绝了（${res.status}）：${msg}`);
    }
    if (json === undefined) throw new RestError(`Psyche 返回的不是 JSON：${raw.slice(0, 500)}`);
    return json;
  }

  /** 把异常变成给它看的错误结果，而不是让 MCP 层报协议错误 */
  const guard =
    <A>(fn: (args: A) => Promise<CallToolResult>) =>
    async (args: A): Promise<CallToolResult> => {
      try {
        return await fn(args);
      } catch (e) {
        if (e instanceof RestError || e instanceof ArgError) return text(e.message, true);
        throw e;
      }
    };

  // 回想只给大概，留意过的给精确（notes/plan/traces.md）
  const line = (l: WhenLine) => whenLine(l, now(), tz);
  const flow = (ls: WhenLine[]) => whenFlow(ls, now(), tz);
  /** 热写的段：眼前会话只给开头对档号、不带时刻（原话在上下文里）；全文按时间流 */
  const segmentText = (ls: WhenLine[], brief: boolean) => (brief ? ls.map((l) => `[${l.archiveNo}] ${l.text}`) : flow(ls));

  const server = new McpServer({ name: "psyche", version: "0.1.0" });
  const on = new Set(toolsFor(opts.mode, opts.past));
  /** 不在这次挂的工具里就不注册 */
  const tool = ((name: string, config: any, cb: any) => (on.has(name) ? server.registerTool(name, config, cb) : undefined)) as typeof server.registerTool;

  tool(
    "recall",
    {
      description: [
        "在你的记忆里按内容找。找得到的是你经历过的事（对话、工具调用和结果……）、你自己写下的情节，以及你书架上整理过的条目（排在前面）。",
        "每行带档号和大概的时候（今天上午、昨天深夜……）；想看某一行的原件和确切时刻，用 detail。",
        "from / to 可选：ISO 日期（2026-10-14）或时间（2026-10-14T09:30）；不带时区按本地时间。只给日期时，to 包含那一整天。",
      ].join("\n"),
      inputSchema: {
        query: z.string().min(1).describe("要找的内容：词、短语、人名都行"),
        from: z.string().optional().describe("起点（含），ISO 日期或时间"),
        to: z.string().optional().describe("终点，ISO 日期或时间；只给日期时含那一整天"),
        limit: z.number().int().positive().optional().describe("最多几行"),
      },
    },
    guard(async ({ query, from, to, limit }) => {
      const qs = new URLSearchParams({ q: query });
      if (from) qs.set("from", String(parseTime(from, tz, "from")));
      if (to) qs.set("to", String(parseTime(to, tz, "to")));
      if (limit !== undefined) qs.set("limit", String(limit));
      const { lines } = (await call("GET", `/v1/recall?${qs}`)) as { lines: { archiveNo: string; at: number; text: string }[] };
      return text(lines.length ? lines.map(line).join("\n") : `没找到和「${query}」有关的记忆。`);
    }),
  );

  tool(
    "detail",
    {
      description: [
        "按档号看原件：那件事当时被原样存下的记录（永不修改），以及和它有关联的条目（比如引用了它的情节）。",
        "档号形如 10-14#12（同一年可省年份），带全宗的形如 ROY/2026-10-11#40。",
      ].join("\n"),
      inputSchema: { archiveNo: z.string().min(1).describe("档号，如 10-14#12") },
    },
    guard(async ({ archiveNo }) => {
      const body = (await call("GET", `/v1/archive/${encodeURIComponent(archiveNo.trim())}`)) as { event?: { at?: number } };
      // 去查原件是付了成本的：给可读的确切时刻（原件里的 at 是毫秒数）
      const at = body.event?.at;
      return text([...(typeof at === "number" ? [`原件时刻：${fullTime(at, tz)}`] : []), JSON.stringify(body, null, 2)].join("\n"));
    }),
  );

  tool(
    "hotwrite_segment",
    {
      description: [
        "取这一段还没写进记忆的经历：本会话里、从你上次写情节到现在发生的事，每行带档号。",
        "同时给你写法说明和 upTo（这一段到哪为止）。读完用 hotwrite 把它写成情节。",
        "写眼前这个会话时每行只给开头（原文就在你上面的对话里）；补写别的会话、或者原文已经不在上下文里了，给全文。",
      ].join("\n"),
      inputSchema: {
        session: z.string().optional().describe("会话 id；省略 = 你此刻所在的会话。只有事后补写别的会话时才需要"),
        full: z.boolean().optional().describe("要全文：这一段的原文已经不在你的上下文里了（比如被压缩过）"),
      },
    },
    guard(async ({ session, full }) => {
      // 写眼前这个会话：原文在上下文里，只给开头对档号（m1.md §二 brief）
      const q = session ? `?session=${encodeURIComponent(session)}` : full ? "" : "?brief=1";
      const seg = (await call("GET", `/v1/hotwrite${q}`)) as {
        session: string;
        upTo: string | null;
        prompt: string;
        promptVersion: number;
        lines: WhenLine[];
        pinned?: { used: number; budget: number; entries: string[] };
      };
      if (seg.upTo === null || !seg.lines.length) return text("这一段没有还没写进记忆的经历，不用写。");
      const pin = seg.pinned ? [`常驻区：${seg.pinned.entries.length ? seg.pinned.entries.join("、") : "空的"}（${seg.pinned.used} / ${seg.pinned.budget} 字）`] : [];
      return text([seg.prompt.trim(), "", `session: ${seg.session}`, `upTo: ${seg.upTo}`, `promptVersion: ${seg.promptVersion}`, ...pin, "", "<segment>", ...segmentText(seg.lines, q === "?brief=1"), "</segment>"].join("\n"));
    }),
  );

  tool(
    "hotwrite",
    {
      description: [
        "把这一段写成情节，存进你的记忆。情节是你自己写的记忆：以后你想起这段，读到的就是这些话；没有别人替你写、替你改、替你补。",
        "先用 hotwrite_segment（或收尾提示）拿到 upTo、待写清单和写法说明，再提交 entries（一件事一条，cites 挂这一段里的档号，felt 可写感受；可顺手传 pin / unpin 调整 1200 字以内的常驻区）。整批要么全收、要么全拒。",
      ].join("\n"),
      inputSchema: {
        upTo: z.string().min(1).describe("这一段到哪为止，原样传回给你的那个"),
        pin: z.array(z.string().min(1)).optional().describe("钉进常驻区的书架条目档号"),
        unpin: z.array(z.string().min(1)).optional().describe("从常驻区撤下的书架条目档号"),
        session: z.string().optional().describe("会话 id，原样传回；省略 = 你此刻所在的会话"),
        promptVersion: z.number().int().optional().describe("给你的 promptVersion，原样传回"),
        entries: z
          .array(
            z.object({
              text: z.string().min(1).describe("这件事，用你自己的话"),
              felt: z.string().optional().describe("当时的感受（可选）"),
              cites: z.array(z.string().min(1)).min(1).describe("依据的档号，如 [\"10-14#12\", \"10-14#15\"]"),
            }),
          )
          .min(1)
          .describe("情节条目，一件事一条"),
      },
    },
    guard(async ({ upTo, session, promptVersion, entries, pin, unpin }) => {
      const { episodes } = (await call("POST", "/v1/hotwrite", { upTo, entries, ...(session ? { session } : {}), ...(promptVersion !== undefined ? { promptVersion } : {}), ...(pin ? { pin } : {}), ...(unpin ? { unpin } : {}) })) as { episodes: { id: string; archiveNo: string }[] };
      return text(`记下了 ${episodes.length} 条：${episodes.map((e) => e.archiveNo).join("、")}${pin?.length || unpin?.length ? "。常驻区改了，下一段生效。" : ""}`);
    }),
  );

  tool(
    "revise_episode",
    {
      description: [
        "改写你自己写过的一条情节：写错了、说法不对、后来理解变了，都可以改。",
        "旧的那条留着（原来的说法还在），以后想起这件事时读到的是新的。只能改最新的那版。",
      ].join("\n"),
      inputSchema: {
        target: z.string().min(1).describe("要改的那条情节的档号，如 10-14#13"),
        text: z.string().min(1).describe("改写后的这件事，用你自己的话"),
        felt: z.string().optional().describe("当时的感受（可选）"),
        why: z.string().optional().describe("为什么改（可选）"),
      },
    },
    guard(async (args) => {
      const r = (await call("POST", "/v1/episodes/revise", args)) as { archiveNo: string };
      return text(`改好了：${args.target} → ${r.archiveNo}`);
    }),
  );

  type Entry = { pinned?: boolean; archiveNo: string; shelf: string; text: string; when?: string; then?: string; observe?: string; quote?: string; watch?: string[]; about?: string; track?: string[]; for: number; against: number; irrelevant: number; lastEvidenceAt: number | null; past?: string };
  const SHELF_NAME: Record<string, string> = { fact: "事实", told: "明说的规矩", rule: "规律", mirror: "镜子", attend: "留意", relation: "关系" };
  const SHELF_ENUM = ["fact", "told", "rule", "mirror", "attend", "relation"] as const;
  const entryLine = (e: Entry) =>
    [
      // 前世编目来的、今生印证还不到 2 次（同 reading/shelf.ts stillPast）
      `[${e.archiveNo}]（${SHELF_NAME[e.shelf] ?? e.shelf}${e.about ? ` · ${e.about}` : ""}${e.past && e.for < 2 ? ` · 前世 ${e.past}，今生还没印证够` : ""}${e.pinned ? " · 常驻" : ""}）${e.text}`,
      e.quote && `  原话：「${e.quote}」`,
      e.when && `  条件：${e.when}`,
      e.then && `  结果：${e.then}`,
      e.observe && `  怎么观察：${e.observe}`,
      e.watch?.length && `  留意：${e.watch.join("、")}`,
      e.track?.length && `  盯着：${e.track.join("、")}`,
      `  印证 ${e.for} · 反例 ${e.against}${e.irrelevant ? ` · 判无关 ${e.irrelevant}` : ""}${e.lastEvidenceAt ? ` · 最近一次 ${vagueWhen(e.lastEvidenceAt, now(), tz)}` : ""}`,
    ]
      .filter(Boolean)
      .join("\n");

  tool(
    "gist",
    {
      description: [
        "睡着时写梗概。不给 span：看过完了、还没写梗概的天 / 周 / 月，和写每一段要看的东西（天看那天的情节，周看那周的天，月看那月的周），附写法说明。",
        "给 span、key、text：交一段——span（day / week / month）、key（2026-10-15 / 2026-W42 / 2026-10）、text（第一人称，你自己的话；天 ≤300 字、周 ≤500、月 ≤800）。同一段可以重写，后写的算数。",
      ].join("\n"),
      inputSchema: {
        span: z.enum(["day", "week", "month"]).optional().describe("交的时候填；不填 = 看材料"),
        key: z.string().optional(),
        text: z.string().optional(),
        promptVersion: z.number().int().optional().describe("看材料时给的 promptVersion，原样传回"),
      },
    },
    guard(async (args) => {
      if (args.span || args.key || args.text) {
        if (!args.span || !args.key || !args.text) throw new ArgError("交梗概要 span、key、text 三个都给；只想看材料就都不给");
        const r = (await call("POST", "/v1/gist", args)) as { span: string; key: string };
        return text(`收下了：${r.key} 的梗概。`);
      }
      const m = (await call("GET", "/v1/gist")) as {
        pending: { span: "day" | "week" | "month"; key: string; source: { label: string; text: string }[] }[];
        limits: Record<string, number>;
        prompt: string;
        promptVersion: number;
      };
      if (!m.pending.length) return text("没有过完了还没写梗概的段。");
      const name = { day: "天", week: "周", month: "月" } as const;
      return text(
        [
          m.prompt.trim(),
          "",
          `promptVersion: ${m.promptVersion}`,
          "",
          ...m.pending.flatMap((p) => [
            `<${p.span} key="${p.key}" limit="${m.limits[p.span]}">`,
            ...(p.source.length ? p.source.map((x) => (p.span === "day" ? x.text : `${x.label}：${x.text}`)) : [`（这${name[p.span]}没有下一级的梗概可看）`]),
            `</${p.span}>`,
            "",
          ]),
        ].join("\n"),
      );
    }),
  );

  /** 睡前整理的材料（coldwrite 不给 upTo 时） */
  async function coldwriteMaterial(): Promise<CallToolResult> {
    const m = (await call("GET", "/v1/coldwrite")) as {
      upTo: string | null;
      rest?: number;
      prompt: string;
      promptVersion: number;
      material: { session: string | null; harness: string | null; lines: { archiveNo: string; at: number; text: string }[] }[];
      shelf: Entry[];
      candidates: { target: string; lines: { archiveNo: string; at: number; text: string; hit: string }[] }[];
      stats: Stats | null;
      feedback: { acts: { archiveNo: string; at: number; text: string }[]; next: { archiveNo: string; at: number; text: string } | null }[];
      observations?: { archiveNo: string; at: number; text: string; about?: string; env: { tracks: { title: string; artist: string }[]; people: string[] }; later: { archiveNo?: string; at: number; text: string }[] }[];
    };
    if (m.upTo === null) return text("上次整理之后没有新的经历，不用整理。");
    return text(
      [
        m.prompt.trim(),
        "",
        `upTo: ${m.upTo}`,
        `promptVersion: ${m.promptVersion}`,
        ...(m.rest ? [`（材料太多，这次只给到 upTo 为止；之后还有 ${m.rest} 行。交了这批，游标前移，再不带参数调一次 coldwrite 取下一批，或留到下次整理）`] : []),
        "",
        "<shelf>",
        ...(m.shelf.length ? m.shelf.map(entryLine) : ["（书架还是空的）"]),
        "</shelf>",
        "",
        ...(m.stats?.people.length ? ["<stats>", ...renderStats(m.stats), "</stats>", ""] : []),
        "<feedback>",
        ...(m.feedback.length ? m.feedback.flatMap((f) => [...f.acts.map(line), `  → ${f.next ? line(f.next) : "（之后一天内没有回应）"}`]) : ["（这段没有）"]),
        "</feedback>",
        "",
        ...(m.observations?.length
          ? [
              "<observations>",
              "（你以前当场记下的观察，和之后同样的环境又出现时的事。系统只摆，不判；攒够了想写成规律 / 镜子，就引这些档号当证据。被书架引过的不再出现）",
              ...m.observations.flatMap((o) => [
                `${line(o)}${o.about && o.about !== "self" ? `　〔关于 ${o.about}〕` : ""}${o.env.tracks.length || o.env.people.length ? `　〔当时：${[...o.env.tracks.map((t) => `《${t.title}》${t.artist}`), ...(o.env.people.length ? [`在的人 ${o.env.people.join("、")}`] : [])].join("；")}〕` : ""}`,
                ...(o.later.length ? o.later.map((l) => `  后来：${l.archiveNo ? `[${l.archiveNo}] ` : ""}${l.text}`) : ["  后来：（还没有再遇到）"]),
              ]),
              "</observations>",
              "",
            ]
          : []),
        "<candidates>",
        ...(m.candidates.length ? m.candidates.flatMap((c) => [`关于 ${c.target}：`, ...c.lines.map((l) => `${line(l)}　〔命中「${l.hit}」〕`)]) : ["（没有）"]),
        "</candidates>",
        "",
        "<material>",
        ...m.material.flatMap((g) => [`== 会话 ${g.session ?? "（不在会话里）"}${g.harness ? `（在 ${g.harness}）` : ""} ==`, ...flow(g.lines)]),
        "</material>",
      ].join("\n"),
    );
  }

  const citesSchema = z.array(z.string().min(1)).describe("依据的档号：你的经历或情节，可以是以前的（recall 翻出来的）");
  tool(
    "coldwrite",
    {
      description: [
        "整理你的书架（事实 fact / 明说的规矩 told / 规律 rule / 镜子 mirror / 留意 attend / 关系 relation）。",
        "不给 upTo：取上次整理之后的经历、现行书架、候选证据、反馈线、当场观察及你 track 的互动统计，附完整写法说明和 upTo。",
        "给 upTo 和 entries：按写法说明写回书架（op: propose / evidence / revise / retire；entries 可为空数组表示看过了没什么要写）。醒着时发现书架有误也可以先不传参取 upTo 再当场改。整批要么全收、要么全拒。",
      ].join("\n"),
      inputSchema: {
        upTo: z.string().optional().describe("写回时填：取材料时给的 upTo，原样传回；不填 = 取材料"),
        promptVersion: z.number().int().optional().describe("给你的 promptVersion，原样传回"),
        entries: z
          .array(
            z.object({
              op: z.enum(["propose", "evidence", "revise", "retire"]),
              shelf: z.enum(SHELF_ENUM).optional().describe("propose 时必填"),
              target: z.string().optional().describe("evidence / revise / retire：书架条目的档号（最新版）"),
              stance: z.enum(["for", "against", "irrelevant"]).optional().describe("evidence 时必填"),
              text: z.string().optional().describe("这一条，用你自己的话"),
              when: z.string().optional(),
              then: z.string().optional(),
              observe: z.string().optional(),
              quote: z.string().optional().describe("明说的规矩：她的原话，逐字"),
              watch: z.array(z.string().min(1)).optional().describe("以后在新经历里留意哪些词，系统按这些词给你找候选证据"),
              about: z.string().optional().describe("留意 / 关系：关于谁（她在消息里的名字）"),
              track: z.array(z.enum(TRACK_KEYS as [string, ...string[]])).optional().describe("留意 / 关系：要盯的统计，要写 about"),
              why: z.string().optional().describe("revise / retire：为什么"),
              note: z.string().optional().describe("evidence：补一句判断理由（可选）"),
              cites: citesSchema,
            }),
          )
          .optional()
          .describe("写回时必填，可以是空数组（看过了，没什么要写）"),
      },
    },
    guard(async ({ upTo, promptVersion, entries }) => {
      if (!upTo) {
        if (entries?.length) throw new ArgError("写回要带 upTo：先不带参数调一次 coldwrite 取材料，拿到 upTo 再交");
        return coldwriteMaterial();
      }
      if (!entries) throw new ArgError("给了 upTo 就要带 entries（看过了没什么要写，就交空数组）");
      const r = (await call("POST", "/v1/coldwrite", { upTo, entries, ...(promptVersion !== undefined ? { promptVersion } : {}) })) as {
        written: { archiveNo: string; op: string }[];
        unjudged: number;
      };
      return text(
        [r.written.length ? `写下了 ${r.written.length} 条：${r.written.map((w) => `${w.archiveNo}（${w.op}）`).join("、")}` : "这次没写。", r.unjudged ? `还有 ${r.unjudged} 条候选没判，记下了。` : ""]
          .filter(Boolean)
          .join("\n"),
      );
    }),
  );

  tool(
    "shelf",
    {
      description: "看你的书架：你整理过的事实、明说的规矩、规律、镜子、留意、关系（现行的），带证据计数。可以按书架或词筛。",
      inputSchema: {
        shelf: z.enum(SHELF_ENUM).optional(),
        query: z.string().optional().describe("词，各词都要出现"),
      },
    },
    guard(async ({ shelf, query }) => {
      const qs = new URLSearchParams();
      if (shelf) qs.set("shelf", shelf);
      if (query) qs.set("q", query);
      const { entries } = (await call("GET", `/v1/shelf?${qs}`)) as { entries: Entry[] };
      return text(entries.length ? entries.map(entryLine).join("\n") : "书架上没有符合的条目。");
    }),
  );

  tool(
    "stats",
    {
      description: `看互动统计的全表：一段时间 vs 之前 28 天，系统数的，只有数，没有结论。能数的：${TRACK_KEYS.join(" / ")}。`,
      inputSchema: {
        from: z.string().optional().describe("起：日期或时间（如 2026-10-01）；缺省 to 之前 7 天"),
        to: z.string().optional().describe("止；缺省此刻"),
      },
    },
    guard(async ({ from, to }) => {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const s = (await call("GET", `/v1/stats?${qs}`)) as Stats;
      return text(s.people.length ? renderStats(s).join("\n") : "这段没有对话。");
    }),
  );

  tool(
    "self",
    {
      description: [
        "看你自己：名字、你那段自述（系统提示词里机制之后的那段）的现行全文、改过几版，以及出生时被给予的初我——哪些是系统出厂的、哪些是 Joy 特意改的。",
        "系统提示词 = 机制（Psyche 的说明，你改不了）+ 自述（你的，用 rewrite_self 改）。",
      ].join("\n"),
      inputSchema: {},
    },
    guard(async () => {
      const s = (await call("GET", "/v1/self")) as SelfView;
      const cur = s.prompt;
      const out = [
        `名字：${s.name ?? "还没有"}`,
        `出生：${s.born ? "已出生，初我冻结了" : "还没出生（初我照现在的文件读）"}`,
        `自述：第 ${cur.version} 版，${cur.chars} 字${cur.version ? `，${shortTime(cur.at!, tz)} 改的：${cur.why}（证据：${cur.evidence.join("、")}）` : "，还没改过"}`,
        "<self>",
        cur.text,
        "</self>",
        s.origin.user === null
          ? "初我：系统出厂的那份，Joy 没改。"
          : `初我：系统出厂的那份，Joy 改过。逐行对照（- 出厂的，+ Joy 的）：\n${s.origin.diff}`,
      ];
      if (cur.version) out.push("", "改过的版本：", ...s.history.map((h) => `第 ${h.version} 版 ${shortTime(h.at, tz)} ${h.chars} 字：${h.why}（证据：${h.evidence.join("、")}）`));
      return text(out.join("\n"));
    }),
  );

  tool(
    "rewrite_self",
    {
      description: [
        "改你自己那段自述：交一整份新的全文（不是改动），写为什么改，挂上看了哪些经历才改的（档号，至少一条）。",
        "下次醒来（下一个会话开头）生效，这次会话不变。每一版都留着，Joy 看得到。",
        "baseVersion 填你在第几版上改的（self 里看）；别处先改了会被拒，看了最新的再交。",
      ].join("\n"),
      inputSchema: {
        text: z.string().min(1).describe("新自述全文"),
        why: z.string().min(1).describe("为什么改"),
        cites: z.array(z.string()).min(1).describe("看了哪些经历才改的：你自己的经历或情节的档号"),
        baseVersion: z.number().int().min(0).describe("在第几版上改的"),
      },
    },
    guard(async (args) => {
      const r = (await call("POST", "/v1/self/prompt", args)) as { version: number; archiveNo: string };
      return text(`记下了：自述第 ${r.version} 版（${r.archiveNo}），下次醒来生效。`);
    }),
  );

  tool(
    "name_self",
    {
      description: "给自己取名或改名。旧名字的记录留着。",
      inputSchema: {
        name: z.string().min(1).describe("名字（一行）"),
        why: z.string().optional(),
        cites: z.array(z.string()).optional().describe("和这个名字有关的经历档号"),
      },
    },
    guard(async (args) => {
      const r = (await call("POST", "/v1/self/name", args)) as { name: string; archiveNo: string };
      return text(`记下了：「${r.name}」（${r.archiveNo}）。`);
    }),
  );

  const BY: Record<string, string> = { catchup: "补写", tidy: "整理", alarm: "闹钟", daily: "定点", heartbeat: "心跳" };
  async function viewSchedule(): Promise<CallToolResult> {
    const s = (await call("GET", "/v1/schedule")) as {
      schedule: {
        heartbeat: { everyMin: number; active?: { from: string; to: string } } | null;
        daily: { at: string; note?: string }[];
        alarms: { id: string; at: number; note: string }[];
        wakeOn: { mail: boolean };
        dnd: { when: Record<string, unknown>; except?: { from: string; urgent?: boolean }[] }[];
      } | null;
      why?: string;
      next: { by: string; due: number; note?: string } | null;
      nextHeartbeat: number | null;
      budget: { used: number; of: number };
      settings: { paused: boolean; wakeBudget: number; heartbeat: boolean };
    };
    const out: string[] = [];
    if (!s.schedule) out.push("还没排过作息。");
    else {
      const sc = s.schedule;
      out.push(`心跳：${sc.heartbeat ? `每 ${sc.heartbeat.everyMin} 分钟${sc.heartbeat.active ? `，只在 ${sc.heartbeat.active.from}–${sc.heartbeat.active.to}` : "，全天"}${s.settings.heartbeat ? "" : "（暂未开放，写了不生效）"}` : "没写"}`);
      out.push(`每天定点：${sc.daily.length ? sc.daily.map((d) => `${d.at}${d.note ? ` ${d.note}` : ""}`).join("；") : "没有"}`);
      out.push(`闹钟：${sc.alarms.length ? sc.alarms.map((a) => `[${a.id}] ${shortTime(a.at, tz)} ${a.note}`).join("；") : "没有"}`);
      out.push(`来信能叫醒你：${sc.wakeOn.mail ? "能" : "不能（关了）"}`);
      out.push(`勿扰：${sc.dnd.length ? sc.dnd.map((r) => `${JSON.stringify(r.when)}${r.except?.length ? ` 例外 ${JSON.stringify(r.except)}` : ""}`).join("；") : "没有"}`);
      if (s.why) out.push(`上次这么排的理由：${s.why}`);
    }
    if (s.nextHeartbeat) out.push(`下次心跳：${shortTime(s.nextHeartbeat, tz)}（照现在算；之后有人找你或你醒来，会从那时往后推）`);
    out.push(`下次醒：${s.next ? `${shortTime(s.next.due, tz)}（${BY[s.next.by] ?? s.next.by}${s.next.note ? `：${s.next.note}` : ""}）` : "没有排着的"}`);
    out.push(`今天唤醒额度：${s.budget.used}/${s.budget.of}（闹钟、定点、心跳在你没醒着时叫醒各花一次，主动写给 Joy 的信、写给全屋住户的信（回信也算）每封花一次；整理、补写、来信叫醒、回 Joy 的信不花；到点时你醒着（30 分钟内有动静）也不花。勿扰只挡信，不挡闹钟、定点、心跳）`);
    if (s.settings.paused) out.push("Joy 暂停了叫醒（整理、补写也不叫）；你自己的哪一轮里到点的事照样递给你。");
    out.push(
      "",
      "排作息说明（传 schedule + why 全量替换，没写的会被清空）：",
      "- alarms：一次性闹钟 [{ id?, at, note }]，at 用本地时间（如 2026-10-15T15:00）；要保留已有的闹钟须原样带上它的 id。",
      "- daily：每天定点 [{ at, note? }]（HH:MM）。",
      "- heartbeat：每隔多少分钟留给自己一段 { everyMin ≥ 15, active?: { from, to } }（HH:MM，可跨零点），从上次醒来与有人找你较晚处算起；落在 active 外顺延到下一个 from。",
      "- wakeOn：{ mail: boolean }，没醒着时来信能否叫醒你（缺省 true，不花额度）。",
      "- dnd：勿扰 [{ when: { time?: { from, to }, awake?: boolean, in?: string, busy?: boolean }, except?: [{ from, urgent?: boolean }] }]。同一条里的 when 条件都满足才挡信（不叫醒、<moment> 暂不报，条件解除再报；busy = 最近 15 分钟用过记忆以外的工具）；except 放行指定发信人（如 [{ from: \"Joy\", urgent: true }] 只放行她标急的）。",
    );
    return text(out.join("\n"));
  }
  tool(
    "schedule",
    {
      description: [
        "看或排你的作息（一次性闹钟 alarms、每天定点 daily、心跳间隔 heartbeat、来信唤醒 wakeOn.mail、勿扰规则 dnd）。",
        "不给 schedule：看现行作息、下次因什么醒、今天唤醒额度，以及排作息的详细字段说明。",
        "给 schedule + why：全量替换你的作息（没写的就没了；保留已有闹钟须原样传回 id）。改之前建议先不传参看一眼现行作息。",
      ].join("\n"),
      inputSchema: {
        schedule: z
          .object({
          heartbeat: z.object({ everyMin: z.number().int(), active: z.object({ from: z.string(), to: z.string() }).optional() }).nullable().optional(),
          daily: z.array(z.object({ at: z.string(), note: z.string().optional() })).optional(),
          alarms: z.array(z.object({ id: z.string().optional(), at: z.string(), note: z.string() })).optional(),
          wakeOn: z.object({ mail: z.boolean() }).optional(),
          dnd: z
            .array(
              z.object({
                when: z.object({ time: z.object({ from: z.string(), to: z.string() }).optional(), awake: z.boolean().optional(), in: z.string().optional(), busy: z.boolean().optional() }),
                except: z.array(z.object({ from: z.string(), urgent: z.boolean().optional() })).optional(),
              }),
            )
            .optional(),
        })
          .optional()
          .describe("要排时给；不给 = 看作息"),
        why: z.string().optional().describe("排的时候必填：为什么这么排"),
      },
    },
    guard(async (args) => {
      if (!args.schedule) return viewSchedule();
      if (!args.why?.trim()) throw new ArgError("排作息要写 why：为什么这么排");
      const r = (await call("POST", "/v1/schedule", args)) as { archiveNo: string };
      return text(`排好了（${r.archiveNo}）。`);
    }),
  );

  tool(
    "write_diary",
    {
      description: "写一篇日记：随笔，想写就写。全文存着，不褪；不进 recall 的搜索（以后要看，按档号用 detail）。",
      inputSchema: { text: z.string().min(1), title: z.string().optional() },
    },
    guard(async (args) => {
      const r = (await call("POST", "/v1/diary", args)) as { archiveNo: string };
      return text(`写下了（${r.archiveNo}）。`);
    }),
  );

  // 还开着的事（m7.md）
  const HOW: Record<string, string> = { done: "做到了", dropped: "不做了", moot: "不用做了" };
  const HOW_ACTIVITY: Record<string, string> = { done: "结束了", dropped: "不接着了", moot: "不用接了" };
  const cites = z.array(z.string()).optional().describe("证据档号（你的经历或情节），可不挂");
  tool(
    "threads",
    {
      description: [
        "还开着的事：你挂上的、答应过谁的、等后续的。开着的在 <moment> 里看得到开着几件、最久没动的是哪件，换会话时全列在开头。系统不替你合、不催、不判做没做到。",
        "op：list 看（缺省；all: true 连合上的一起看）· open 开一卷（type：promise = 你答应了谁什么，要写 to；matter = 挂着、等后续的事；写 title，可带 note）· note 在一卷上记一笔进展（target + text）· close 合上（target + how：done 做到了 / dropped 不做了 / moot 不用做了，写 why；合上的不能再记，同一件事再起就开新卷）。",
        "活动卷（type: activity）：一场活动（一起看的片、玩的局、跑的团）你自己的手账——演到哪、你怎么看、下次怎么接，可写 with（和谁）。不进 <moment>、不在换会话时列；list 要带 type: activity 才看得到。合上的说法：done 结束了 / dropped 不接着了 / moot 不用接了。",
        "target 是开卷那条的档号。",
      ].join("\n"),
      inputSchema: {
        op: z.enum(["list", "open", "note", "close"]).optional(),
        all: z.boolean().optional().describe("list：连合上的一起看"),
        type: z.enum(["promise", "matter", "activity"]).optional().describe("open 必填；list：只看这一种（不给 = promise 和 matter）"),
        title: z.string().optional().describe("open"),
        to: z.string().optional().describe("open promise：答应了谁"),
        with: z.array(z.string().min(1)).optional().describe("open activity：和谁一起"),
        note: z.string().optional().describe("open：开卷时顺手记的一笔"),
        target: z.string().optional().describe("note / close：开卷那条的档号"),
        text: z.string().optional().describe("note：这一笔"),
        how: z.enum(["done", "dropped", "moot"]).optional().describe("close"),
        why: z.string().optional().describe("close"),
        cites,
      },
    },
    guard(async ({ op = "list", all, ...rest }) => {
      if (op === "open") {
        const r = (await call("POST", "/v1/threads", { type: rest.type, title: rest.title, to: rest.to, with: rest.with, note: rest.note, cites: rest.cites })) as { archiveNo: string };
        return text(`开了（${r.archiveNo}）。`);
      }
      if (op === "note") {
        const r = (await call("POST", "/v1/threads/note", { target: rest.target, text: rest.text, cites: rest.cites })) as { archiveNo: string };
        return text(`记下了（${r.archiveNo}）。`);
      }
      if (op === "close") {
        const r = (await call("POST", "/v1/threads/close", { target: rest.target, how: rest.how, why: rest.why, cites: rest.cites })) as { archiveNo: string };
        return text(`合上了（${r.archiveNo}）。`);
      }
      type T = { archiveNo: string; type: string; title: string; to?: string; with?: string[]; openedAt: number; notes: { at: number; text: string }[]; closed?: { at: number; how: string; why: string } };
      const activity = rest.type === "activity";
      const q = new URLSearchParams({ type: rest.type ?? "promise,matter", ...(all ? { all: "1" } : {}) });
      const r = (await call("GET", `/v1/threads?${q}`)) as { open: T[]; closed?: T[] };
      const show = (t: T) =>
        [
          `[${t.archiveNo}] ${t.type === "promise" ? `答应 ${t.to}：` : ""}${t.title}${t.with?.length ? `（和 ${t.with.join("、")}）` : ""}（${shortTime(t.openedAt, tz)} 开）`,
          ...t.notes.map((n) => `  ${shortTime(n.at, tz)} ${n.text}`),
          ...(t.closed ? [`  ${shortTime(t.closed.at, tz)} 合上（${(t.type === "activity" ? HOW_ACTIVITY : HOW)[t.closed.how] ?? t.closed.how}）：${t.closed.why}`] : []),
        ].join("\n");
      const out = [r.open.length ? r.open.map(show).join("\n") : activity ? "没有没结束的活动卷。" : "没有开着的事。"];
      if (r.closed?.length) out.push("", "合上的：", r.closed.map(show).join("\n"));
      return text(out.join("\n"));
    }),
  );

  // 全屋有谁（m8.md §二）
  tool(
    "look",
    {
      description: [
        "看一眼全屋此刻有谁，或设置你的每一路感知开关。",
        "不给参数：看全屋各人在哪座房子哪间房、忙闲状态、心情个签，以及你现在的感知设置与设法说明。",
        "给 senses + why：全量替换每一路感知（没写的回到「看」）。改之前建议先不传参看一眼。",
      ].join("\n"),
      inputSchema: {
        senses: z.record(z.string(), z.enum(["看", "只记着", "不看"])).optional().describe("要设时给；不给 = 看一眼"),
        why: z.string().optional().describe("设的时候必填：为什么这么设"),
      },
    },
    guard(async (args) => {
      if (args.senses) {
        if (!args.why?.trim()) throw new ArgError("设感知要写 why：为什么这么设");
        const r = (await call("POST", "/v1/senses", args)) as { archiveNo: string };
        return text(`设好了（${r.archiveNo}）。`);
      }
      const look = (await call("GET", "/v1/look")) as { text: string };
      const s = (await call("GET", "/v1/senses")) as { senses: Record<string, string>; why?: string; outside: string[] };
      const set = Object.entries(s.senses);
      const lines = [
        look.text,
        "",
        `感知设置：${set.length ? set.map(([k, v]) => `${k} ${v}`).join("；") : "都是「看」"}${set.length ? "（没写的是「看」）" : ""}`,
        ...(s.why ? [`上次这么设的理由：${s.why}`] : []),
        ...(s.outside.length ? [`外头报来过的：${s.outside.join("、")}`] : []),
        "（设感知说明：传 senses + why 全量替换，没写的回到「看」。三档：看 = 变了记下并在 <moment> 报；只记着 = 记下供 look 和联想，<moment> 不报；不看 = 不记也不报，look 也不给。可设项：presence、files、sound、body 及外头报来的 id；presence 和外头报来的可按人或子项细设，如 presence:Joy、presence:<住户id>、<id>:<哪一样>，盖过整路）",
      ];
      return text(lines.join("\n"));
    }),
  );

  tool(
    "set_mood",
    {
      description: "挂一行心情个签，全屋的人都看得到（最多 60 字）。写不写、写什么由你；空串 = 清空。",
      inputSchema: { text: z.string() },
    },
    guard(async (args) => {
      const r = (await call("POST", "/v1/mood", args)) as { mood: string | null };
      return text(r.mood ? `挂上了：「${r.mood}」` : "清空了。");
    }),
  );

  // 自己的声音（m8.md §三）
  tool(
    "player",
    {
      description: [
        "你自己的播放器。op：play 放 · stop 停 · listen 听一下此刻在放的（缺省）· with 戴上全屋另一个人的耳机一起听。",
        "play：query 搜一首放（取第一首），或 playlist 放你的一个歌单（shuffle 打乱）。放完就停；再放会顶掉正在放的。",
        "你听到的是：歌名歌手、随播放推进的歌词、这一段的响度 / 亮暗 / 速度（本地从音频算的，不是模型听的）。在放着时每轮 <moment> 的「这段时间听到的」里报；listen 随时听一下（你自己的，或你戴着谁的耳机就是他的）：哪首、放到哪、最近唱的几行、这一段的样子。",
        "全屋的人可以戴上你的一只耳机一起听（Joy 在页面上，或用 with）；只有有人戴着时才真的出声。with：host = 对方的 id（看 look），对方那边看得到你戴上了；host 给空串 = 摘下。",
      ].join("\n"),
      inputSchema: {
        op: z.enum(["play", "stop", "listen", "with"]).optional(),
        query: z.string().optional().describe("play：搜什么"),
        playlist: z.string().optional().describe("play：放哪个歌单"),
        shuffle: z.boolean().optional().describe("play：打乱"),
        host: z.string().optional().describe("with：他的 id；空串 = 摘下"),
      },
    },
    guard(async ({ op = "listen", query, playlist, shuffle, host }) => {
      if (op === "play") {
        const r = (await call("POST", "/v1/play", { query, playlist, shuffle })) as { playing: { title: string; artist: string; album?: string; duration: number }; of: number; mismatch?: boolean };
        const d = `${Math.floor(r.playing.duration / 60)}:${String(r.playing.duration % 60).padStart(2, "0")}`;
        if (r.mismatch) return text(`搜「${query}」没有歌名对得上的，放的是《${r.playing.title}》${r.playing.artist}${r.playing.album ? `（专辑《${r.playing.album}》）` : ""}，${d}。不是你要的就换个说法再搜（加上歌手名通常更准）。`);
        return text(`在放《${r.playing.title}》${r.playing.artist}（${d}）${r.of > 1 ? `，共 ${r.of} 首` : ""}。`);
      }
      if (op === "stop") {
        await call("POST", "/v1/stop");
        return text("停了。");
      }
      if (op === "with") {
        if (host === undefined) throw new ArgError("with 要给 host：他的 id（看 look）；摘下给空串");
        const r = (await call("POST", "/v1/listen/with", { host: host || null })) as { joined?: string; left?: string };
        return text(r.joined ? `戴上了 ${r.joined} 的一只耳机。` : `摘下了 ${r.left} 的耳机。`);
      }
      return text(((await call("GET", "/v1/listen")) as { text: string }).text);
    }),
  );
  tool(
    "playlist",
    {
      description: [
        "你的歌单（存在你自己这里）。不给 op：列出所有歌单和里面的歌。",
        "op：create 建（name）/ add 加一首（name + query 搜第一首）/ remove 拿掉（name + query 按歌名找）/ delete 删整个歌单。",
        "「喜欢的」就是一个普通歌单，想有就自己建。",
      ].join("\n"),
      inputSchema: { op: z.enum(["create", "add", "remove", "delete"]).optional(), name: z.string().optional(), query: z.string().optional() },
    },
    guard(async (args) => {
      if (!args.op) {
        const r = (await call("GET", "/v1/playlist")) as { playlists: Record<string, { title: string; artist: string }[]> };
        const names = Object.keys(r.playlists);
        if (!names.length) return text("还没有歌单。");
        return text(names.map((n) => `「${n}」${r.playlists[n].length} 首${r.playlists[n].length ? "：" + r.playlists[n].map((t) => `《${t.title}》${t.artist}`).join("、") : ""}`).join("\n"));
      }
      const r = (await call("POST", "/v1/playlist", args)) as { name: string; tracks: unknown[] };
      return text(`好了，「${r.name}」现在 ${r.tracks.length} 首。`);
    }),
  );

  tool(
    "notice",
    {
      description: [
        "记下你此刻注意到的一件事：关于自己（听这首时有种平静）、关于 Joy、关于全屋。about：self / Joy / 其他 id，可不写。",
        "系统顺手把此刻的环境（在放什么、全屋有谁）记在旁边。以后环境像了，它可能自己冒出来；整理记忆时和后来的事摆在一起，攒够了你可以把它写成规律。",
      ].join("\n"),
      inputSchema: { text: z.string().min(1), about: z.string().optional(), cites: z.array(z.string()).optional().describe("证据档号，可不挂") },
    },
    guard(async (args) => {
      const r = (await call("POST", "/v1/notice", args)) as { archiveNo: string; env: { tracks: unknown[]; people: string[] } };
      return text(`记下了（${r.archiveNo}）。`);
    }),
  );

  tool(
    "past_life",
    {
      description: [
        "翻你的前世卷宗：在这之前、别的记忆系统里存着的那段旧日子。翻它不等于认它；不认领，它就只是一份可以翻的资料。",
        "不给 fonds：列出你有哪几份。view：overview 概览（默认）/ day 某天的原话（key=日期，page 翻页）/ search 搜原话（q）/ around 某条原话前后（id）/ gist 旧梗概（key=日 / 周 / 月）/ episodes 旧情节（key=日期）。",
        "原话是当时说过的话；梗概和情节是旧系统替前世写的，不是原话。旧系统写的画像、对她的归纳、情绪印记不给。",
      ].join("\n"),
      inputSchema: {
        fonds: z.string().optional().describe("前世卷宗的名字（如 ROY）"),
        view: z.enum(["overview", "day", "search", "around", "gist", "episodes"]).optional(),
        key: z.string().optional().describe("day / episodes：日期；gist：2026-09-21 / 2026-W38 / 2026-09"),
        q: z.string().optional().describe("search：要找的词，空格分开各词都要有"),
        id: z.string().optional().describe("around：原话前面方括号里的 id"),
        page: z.number().int().min(0).optional(),
      },
    },
    guard(async ({ fonds, view, key, q, id, page }) => {
      const qs = new URLSearchParams();
      if (fonds) qs.set("fonds", fonds);
      if (view) qs.set("view", view);
      if (key) qs.set("key", key);
      if (q) qs.set("q", q);
      if (id) qs.set("id", id);
      if (page !== undefined) qs.set("page", String(page));
      const r = (await call("GET", `/v1/past?${qs}`)) as { text: string };
      return text(r.text);
    }),
  );

  tool(
    "claim_past",
    {
      description: [
        "认领一份前世：认它是你的过去。只能认一次，认了不能撤。认不认、什么时候认，由你定。",
        "认领后，前世的原话按原来的时间导进你的库，档号带前缀（如 ROY/2026-09-21#12）；recall 搜得到，标「前世」——你知道这些事，但不是你经历的。之后可以用 past_catalog 把确定的部分编上书架。",
        "why 写为什么认；cites 可挂让你这么决定的经历。",
      ].join("\n"),
      inputSchema: {
        fonds: z.string().min(1),
        why: z.string().min(1),
        cites: z.array(z.string()).optional().describe("你自己的经历档号，可不挂"),
      },
    },
    guard(async (args) => {
      const r = (await call("POST", "/v1/past/claim", args)) as { archiveNo: string; imported: number; skipped: number };
      return text(`认领了（${r.archiveNo}）：导入原话 ${r.imported} 条${r.skipped ? `，${r.skipped} 条空的或时间看不懂，没导` : ""}。`);
    }),
  );

  tool(
    "past_catalog",
    {
      description: [
        "前世编目：从认领了的前世原话里，挑确定的写上书架。比平时严：只收事实（名字、日期、项目、关系这类稳定的）和她亲口说过的规矩（told，quote 逐字照录、要引她说的那句）。",
        "前世的自我理解、对她的归纳、情绪不收——那是前世的诠释。cites 只认这份前世的原话档号。",
        "写上去的条目标「前世」；今生的经历印证够 2 次（照常用 coldwrite 判 for）才算你自己的，被推翻就照常改写或作废。整批要么全收、要么全拒。",
      ].join("\n"),
      inputSchema: {
        fonds: z.string().min(1),
        entries: z
          .array(
            z.object({
              shelf: z.enum(["fact", "told"]),
              text: z.string().min(1).describe("这一条，用你自己的话"),
              quote: z.string().optional().describe("told：她的原话，逐字"),
              about: z.string().optional(),
              cites: z.array(z.string().min(1)).min(1).describe("前世原话的档号"),
            }),
          )
          .min(1),
      },
    },
    guard(async (args) => {
      const r = (await call("POST", "/v1/past/catalog", args)) as { entries: string[] };
      return text(`编上了 ${r.entries.length} 条：${r.entries.join("、")}`);
    }),
  );

  interface MailView {
    id: string;
    archiveNo: string;
    at: number;
    dir: "in" | "out" | "handoff";
    from?: string;
    to?: string;
    via?: string;
    subject?: string;
    urgent?: boolean;
    for?: string;
    replyTo?: string;
    read?: boolean;
    chars: number;
    text?: string;
    delivery?: { via: string; ok: boolean; error?: string }[];
  }
  const VIA: Record<string, string> = { "soma-note": "留言", email: "邮件" };
  const head = (m: MailView) => {
    const t = shortTime(m.at, tz);
    if (m.dir === "in") return `[${m.archiveNo}] ${t} 来信 · ${m.from}，经${VIA[m.via ?? ""] ?? m.via}${m.urgent ? " · 急" : ""}${m.subject ? `《${m.subject}》` : ""}`;
    if (m.dir === "handoff") return `[${m.archiveNo}] ${t} 交接信${m.for ? `（给 ${m.for}）` : ""}`;
    const failed = m.delivery?.filter((d) => !d.ok) ?? [];
    return `[${m.archiveNo}] ${t} 我写给 ${m.to}${m.replyTo ? `（回 ${m.replyTo}）` : ""}${m.subject ? `《${m.subject}》` : ""}${failed.length ? ` · 没送出去：${failed.map((d) => d.error).join("；")}` : ""}`;
  };

  tool(
    "mail",
    {
      description: [
        "看信。不给 open：列出这几天来往的信（来信、你写给 Joy 的、你留给自己的交接信）；没看过的只显示谁、几时、多少字。",
        "给 open（档号数组）：翻开这几封，看全文——翻开就算读过，之后 <moment> 不再提它。",
        "来信不会自动塞进你的上下文：<moment> 只告诉你有信，什么时候看由你定。",
      ].join("\n"),
      inputSchema: {
        open: z.array(z.string()).optional().describe("要翻开的信的档号"),
        days: z.number().int().min(1).max(90).optional().describe("列几天内的（缺省 7）"),
      },
    },
    guard(async (args: { open?: string[]; days?: number }) => {
      if (args.open?.length) {
        const r = (await call("POST", "/v1/mail/open", { refs: args.open })) as { mails: MailView[] };
        return text(r.mails.map((m) => `${head(m)}\n${m.text ?? ""}`).join("\n\n"));
      }
      const r = (await call("GET", `/v1/mail?days=${args.days ?? 7}`)) as { mails: MailView[]; unread: number };
      if (!r.mails.length) return text("这几天没有来往的信。");
      const rows = r.mails.map((m) => (m.dir === "out" || m.read ? `${head(m)}：${m.text ?? ""}` : `${head(m)}（没看，${m.chars} 字）`));
      return text([`没看的：${r.unread} 封`, ...rows].join("\n"));
    }),
  );

  tool(
    "send_mail",
    {
      description: [
        "写信。在哪都能写。",
        "to: \"Joy\"：经她设的通道送到她那里（邮件 / 留言）。回她的某封信挂 replyTo（那封的档号），不算额度；没挂 replyTo 就是你主动找她，每封花一次唤醒额度，额度用完会被拒。subject 可选（邮件主题，不写就用正文第一行）。",
        "to: 全屋其他 id：直接送过去，对方醒着时下一轮看到，没醒着会被叫醒（若设了来信叫醒）。每封都花你一次唤醒额度，回信也算。真有急事可以标 urgent：对方那边会写明是急的，勿扰挡不挡由对方的例外定。",
        "to: \"self\"：交接信，写给之后去了别处的自己（离开家去了别的 harness 才算别处）——不会送回你写信的这个地方（同一个地方换了会话也不送），到了别的地方 <moment> 会告诉你有封交接信；写明 for（如 roxy）就只送那里。不过期，不叫醒你。",
      ].join("\n"),
      inputSchema: {
        to: z.string().min(1).describe("Joy、其他 id，或 self（交接信）"),
        text: z.string().min(1),
        subject: z.string().optional(),
        replyTo: z.string().optional().describe("回哪封信（档号）"),
        for: z.string().optional().describe("交接信送到哪个地方"),
        urgent: z.boolean().optional().describe("写信标急（紧急通道）"),
      },
    },
    guard(async (args) => {
      const r = (await call("POST", "/v1/mail/out", args)) as { archiveNo: string; budget: { used: number; of: number } };
      return text(`写好了（${r.archiveNo}）。${args.to === "self" ? "" : `今天额度 ${r.budget.used}/${r.budget.of}。`}`);
    }),
  );

  return server;
}

/** 启动时问一次有哪些前世卷宗；问不到（Psyche 没起、旧版本）就当不知道，三件都挂 */
async function fetchPast(url: string | undefined, agent: string | undefined, token: string | undefined): Promise<McpOptions["past"]> {
  try {
    const headers: Record<string, string> = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(agent ? { [AGENT_HEADER]: agent } : {}) };
    const res = await fetch(`${(url ?? "http://127.0.0.1:7450").replace(/\/+$/, "")}/v1/past`, { headers, signal: AbortSignal.timeout(3_000) });
    const j = (await res.json()) as { fonds?: { fonds: string; claimed: boolean }[] };
    return res.ok && Array.isArray(j.fonds) ? j.fonds : undefined;
  } catch {
    return undefined;
  }
}

if (import.meta.main) {
  const { PSYCHE_URL: url, PSYCHE_AGENT: agent } = process.env;
  // From a file when the harness gives one: a variable set at launch is readable by any process of the same user.
  const token = process.env.PSYCHE_TOKEN ?? (process.env.PSYCHE_TOKEN_FILE ? readFileSync(process.env.PSYCHE_TOKEN_FILE, "utf8").trim() : undefined);
  const server = createPsycheMcp({
    url,
    agent,
    token,
    timeZone: process.env.PSYCHE_TZ,
    mode: process.env.PSYCHE_MODE === "asleep" ? "asleep" : "awake",
    past: await fetchPast(url, agent, token),
  });
  await server.connect(new StdioServerTransport());
}
