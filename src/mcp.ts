/**
 * MCP 服务（stdio）：给 Agent 本人用的工具，全部转调 REST（notes/plan/m1.md §五）。
 *
 *   recall            按内容找记忆          → GET  /v1/recall
 *   detail            按档号看原件          → GET  /v1/archive/:no
 *   hotwrite_segment  取还没写进记忆的这一段 → GET  /v1/hotwrite
 *   hotwrite          把这一段写成情节       → POST /v1/hotwrite
 *   revise_episode    改写自己的一条情节     → POST /v1/episodes/revise
 *   coldwrite_material 睡前整理的材料        → GET  /v1/coldwrite
 *   coldwrite         写回书架               → POST /v1/coldwrite
 *   shelf             看书架                 → GET  /v1/shelf
 *
 * 这里只做参数转换和排版，不做判断：校验、拒收都在 Psyche 那边。
 * REST 出错时把错误信息原样交回给它——它要看得懂自己为什么被拒，改了再交。
 *
 * 环境变量：
 *   PSYCHE_URL    缺省 http://127.0.0.1:7450
 *   PSYCHE_TOKEN  REST 鉴权（Psyche 没配 token 就不用）
 *   PSYCHE_TZ     不带时区的日期/时间按哪个时区理解（缺省 Asia/Shanghai，与档号切日一致）
 */
import { parseTime as parseCoreTime } from "./core/time.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { renderStats, type Stats } from "./reading/stats.ts";

export interface McpOptions {
  url?: string;
  token?: string;
  timeZone?: string;
  /** 测试时换成假的 */
  fetch?: (req: Request) => Promise<Response>;
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

// ── REST 客户端 ──

class RestError extends Error {}

const text = (s: string, isError = false): CallToolResult => ({ content: [{ type: "text", text: s }], ...(isError ? { isError } : {}) });

export function createPsycheMcp(opts: McpOptions = {}): McpServer {
  const base = (opts.url ?? "http://127.0.0.1:7450").replace(/\/+$/, "");
  const tz = opts.timeZone ?? "Asia/Shanghai";
  const doFetch = opts.fetch ?? ((req: Request) => fetch(req));

  async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
    const headers: Record<string, string> = {};
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
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

  const line = (l: { archiveNo: string; at: number; text: string }) => `[${l.archiveNo}] ${shortTime(l.at, tz)} ${l.text}`;

  const server = new McpServer({ name: "psyche", version: "0.1.0" });

  server.registerTool(
    "recall",
    {
      description: [
        "在你的记忆里按内容找。找得到的是你经历过的事（对话、工具调用和结果……）、你自己写下的情节，以及你书架上整理过的条目（排在前面）。",
        "每行带档号和时间；想看某一行的原件，用 detail。",
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

  server.registerTool(
    "detail",
    {
      description: [
        "按档号看原件：那件事当时被原样存下的记录（永不修改），以及和它有关联的条目（比如引用了它的情节）。",
        "档号形如 10-14#12（同一年可省年份），带全宗的形如 ROY/2026-10-11#40。",
      ].join("\n"),
      inputSchema: { archiveNo: z.string().min(1).describe("档号，如 10-14#12") },
    },
    guard(async ({ archiveNo }) => {
      const body = await call("GET", `/v1/archive/${encodeURIComponent(archiveNo.trim())}`);
      return text(JSON.stringify(body, null, 2));
    }),
  );

  server.registerTool(
    "hotwrite_segment",
    {
      description: [
        "取这一段还没写进记忆的经历：本会话里、从你上次写情节到现在发生的事，每行带档号。",
        "同时给你写法说明和 upTo（这一段到哪为止）。读完用 hotwrite 把它写成情节。",
      ].join("\n"),
      inputSchema: {
        session: z.string().optional().describe("会话 id；省略 = 你此刻所在的会话。只有事后补写别的会话时才需要"),
      },
    },
    guard(async ({ session }) => {
      const seg = (await call("GET", `/v1/hotwrite${session ? `?session=${encodeURIComponent(session)}` : ""}`)) as {
        session: string;
        upTo: string | null;
        prompt: string;
        promptVersion: number;
        lines: { archiveNo: string; at: number; text: string }[];
      };
      if (seg.upTo === null || !seg.lines.length) return text("这一段没有还没写进记忆的经历，不用写。");
      return text([seg.prompt.trim(), "", `session: ${seg.session}`, `upTo: ${seg.upTo}`, `promptVersion: ${seg.promptVersion}`, "", "<segment>", ...seg.lines.map(line), "</segment>"].join("\n"));
    }),
  );

  server.registerTool(
    "hotwrite",
    {
      description: [
        "把这一段写成情节，存进你的记忆。情节是你自己写的记忆：以后你想起这段，读到的就是这些话；没有别人替你写、替你改、替你补。",
        "一件事一条，用你自己的话。每条的 cites 挂上它依据的档号，必须是这一段里的；felt 可写当时的感受。",
        "upTo 用 hotwrite_segment 或收尾提示给的那个，原样传回。",
        "整批要么全收、要么全拒；被拒时会告诉你原因，改了再交。",
      ].join("\n"),
      inputSchema: {
        upTo: z.string().min(1).describe("这一段到哪为止，原样传回给你的那个"),
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
    guard(async ({ upTo, session, promptVersion, entries }) => {
      const { episodes } = (await call("POST", "/v1/hotwrite", { upTo, entries, ...(session ? { session } : {}), ...(promptVersion !== undefined ? { promptVersion } : {}) })) as { episodes: { id: string; archiveNo: string }[] };
      return text(`记下了 ${episodes.length} 条：${episodes.map((e) => e.archiveNo).join("、")}`);
    }),
  );

  server.registerTool(
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

  type Entry = { archiveNo: string; shelf: string; text: string; when?: string; then?: string; observe?: string; quote?: string; watch?: string[]; for: number; against: number; irrelevant: number; lastEvidenceAt: number | null };
  const SHELF_NAME: Record<string, string> = { fact: "事实", told: "明说的规矩", rule: "规律", mirror: "镜子" };
  const entryLine = (e: Entry) =>
    [
      `[${e.archiveNo}]（${SHELF_NAME[e.shelf] ?? e.shelf}）${e.text}`,
      e.quote && `  原话：「${e.quote}」`,
      e.when && `  条件：${e.when}`,
      e.then && `  结果：${e.then}`,
      e.observe && `  怎么观察：${e.observe}`,
      e.watch?.length && `  留意：${e.watch.join("、")}`,
      `  印证 ${e.for} · 反例 ${e.against}${e.irrelevant ? ` · 判无关 ${e.irrelevant}` : ""}${e.lastEvidenceAt ? ` · 最近一次 ${shortTime(e.lastEvidenceAt, tz)}` : ""}`,
    ]
      .filter(Boolean)
      .join("\n");

  server.registerTool(
    "coldwrite_material",
    {
      description: [
        "睡前整理用：取上次整理之后的经历（按会话分组，写过情节的给情节）、你书架上的现行条目、按你留意的词找到的候选证据，以及这段时间和之前的互动统计（系统数的，只有数，没有结论）。",
        "同时给你写法说明和 upTo。看完用 coldwrite 写回。",
      ].join("\n"),
      inputSchema: {},
    },
    guard(async () => {
      const m = (await call("GET", "/v1/coldwrite")) as {
        upTo: string | null;
        prompt: string;
        promptVersion: number;
        material: { session: string | null; lines: { archiveNo: string; at: number; text: string }[] }[];
        shelf: Entry[];
        candidates: { target: string; lines: { archiveNo: string; at: number; text: string; hit: string }[] }[];
        stats: Stats | null;
      };
      if (m.upTo === null) return text("上次整理之后没有新的经历，不用整理。");
      return text(
        [
          m.prompt.trim(),
          "",
          `upTo: ${m.upTo}`,
          `promptVersion: ${m.promptVersion}`,
          "",
          "<shelf>",
          ...(m.shelf.length ? m.shelf.map(entryLine) : ["（书架还是空的）"]),
          "</shelf>",
          "",
          "<stats>",
          ...(m.stats?.people.length ? renderStats(m.stats) : ["（这段没有对话）"]),
          "</stats>",
          "",
          "<candidates>",
          ...(m.candidates.length ? m.candidates.flatMap((c) => [`关于 ${c.target}：`, ...c.lines.map((l) => `${line(l)}　〔命中「${l.hit}」〕`)]) : ["（没有）"]),
          "</candidates>",
          "",
          "<material>",
          ...m.material.flatMap((g) => [`── 会话 ${g.session ?? "（不在会话里）"} ──`, ...g.lines.map(line)]),
          "</material>",
        ].join("\n"),
      );
    }),
  );

  const citesSchema = z.array(z.string().min(1)).describe("依据的档号：你的经历或情节，可以是以前的（recall 翻出来的）");
  server.registerTool(
    "coldwrite",
    {
      description: [
        "睡前整理，写回你的书架。书架上的字都是你写的；证据数、强弱由系统从你挂的档号数，不用自评。",
        "op：propose 新条目（shelf: fact 事实 / told 明说的规矩 / rule 规律 / mirror 镜子）· evidence 对现行条目判一条证据（for 印证 / against 反例 / irrelevant 无关）· revise 改写 · retire 作废。",
        "规律和镜子要写 when（条件）、then（结果）、observe（结果怎么观察），首批证据至少 2 条、来自不同会话；明说的规矩 quote 逐字照录她的原话。",
        "upTo 原样传回。entries 可以是空的（看过了，没什么要写）。整批要么全收、要么全拒；被拒时会告诉你原因，改了再交。",
      ].join("\n"),
      inputSchema: {
        upTo: z.string().min(1).describe("coldwrite_material 给的 upTo，原样传回"),
        promptVersion: z.number().int().optional().describe("给你的 promptVersion，原样传回"),
        entries: z
          .array(
            z.object({
              op: z.enum(["propose", "evidence", "revise", "retire"]),
              shelf: z.enum(["fact", "told", "rule", "mirror"]).optional().describe("propose 时必填"),
              target: z.string().optional().describe("evidence / revise / retire：书架条目的档号（最新版）"),
              stance: z.enum(["for", "against", "irrelevant"]).optional().describe("evidence 时必填"),
              text: z.string().optional().describe("这一条，用你自己的话"),
              when: z.string().optional(),
              then: z.string().optional(),
              observe: z.string().optional(),
              quote: z.string().optional().describe("明说的规矩：她的原话，逐字"),
              watch: z.array(z.string().min(1)).optional().describe("以后在新经历里留意哪些词，系统按这些词给你找候选证据"),
              why: z.string().optional().describe("revise / retire：为什么"),
              note: z.string().optional().describe("evidence：补一句判断理由（可选）"),
              cites: citesSchema,
            }),
          )
          .describe("要写的条目；可以为空"),
      },
    },
    guard(async ({ upTo, promptVersion, entries }) => {
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

  server.registerTool(
    "shelf",
    {
      description: "看你的书架：你整理过的事实、明说的规矩、规律、镜子（现行的），带证据计数。可以按书架或词筛。",
      inputSchema: {
        shelf: z.enum(["fact", "told", "rule", "mirror"]).optional(),
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

  return server;
}

if (import.meta.main) {
  const server = createPsycheMcp({
    url: process.env.PSYCHE_URL,
    token: process.env.PSYCHE_TOKEN,
    timeZone: process.env.PSYCHE_TZ,
  });
  await server.connect(new StdioServerTransport());
}
