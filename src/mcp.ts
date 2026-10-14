/**
 * MCP 服务（stdio）：给 Agent 本人用的四个工具，全部转调 REST（notes/plan/m1.md §五）。
 *
 *   recall            按内容找记忆          → GET  /v1/recall
 *   detail            按档号看原件          → GET  /v1/archive/:no
 *   hotwrite_segment  取还没写进记忆的这一段 → GET  /v1/hotwrite
 *   hotwrite          把这一段写成情节       → POST /v1/hotwrite
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
        "在你的记忆里按内容找。找得到的是你经历过的事（对话、工具调用和结果……），以及你自己写下的情节。",
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
