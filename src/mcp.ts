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
 *   gist_material     过完了还没写梗概的段     → GET  /v1/gist
 *   gist              交一段梗概             → POST /v1/gist
 *   shelf             看书架                 → GET  /v1/shelf
 *   stats             看互动统计（全表）      → GET  /v1/stats
 *   self              看自己：名字、自述      → GET  /v1/self
 *   rewrite_self      改自己那段提示词        → POST /v1/self/prompt
 *   name_self         取名 / 改名             → POST /v1/self/name
 *   schedule          看作息                  → GET  /v1/schedule
 *   set_schedule      排作息（全量替换）       → POST /v1/schedule
 *   write_diary       写日记                  → POST /v1/diary
 *   threads           看还开着的事             → GET  /v1/threads
 *   open_thread       开一卷                  → POST /v1/threads
 *   note_thread       在一卷上记一笔           → POST /v1/threads/note
 *   close_thread      合上一卷                → POST /v1/threads/close
 *   look              看一眼屋里              → GET  /v1/look
 *   set_mood          挂心情个签              → POST /v1/mood
 *   play / stop       放歌 / 停               → POST /v1/play、/v1/stop
 *   playlist          歌单（看 / 建 / 加 / 删） → GET/POST /v1/playlist
 *   listen            听一下此刻在放的         → GET  /v1/listen
 *   listen_with       戴上 / 摘下谁的一只耳机   → POST /v1/listen/with
 *   notice            注意到                  → POST /v1/notice
 *   mail              看信：来往的信 / 翻开    → GET  /v1/mail、POST /v1/mail/open
 *   send_mail         写信：给 Joy / 屋里的住户 / 交接信 → POST /v1/mail/out
 *
 * 这里只做参数转换和排版，不做判断：校验、拒收都在 Psyche 那边。
 * REST 出错时把错误信息原样交回给它——它要看得懂自己为什么被拒，改了再交。
 *
 * 环境变量：
 *   PSYCHE_URL    缺省 http://127.0.0.1:7450
 *   PSYCHE_AGENT  他是谁（Psyche 住着不止一个人时必须有，server/house.ts）
 *   PSYCHE_TOKEN  REST 鉴权（Psyche 没配 token 就不用）
 *   PSYCHE_TZ     不带时区的日期/时间按哪个时区理解（缺省 Asia/Shanghai，与档号切日一致）
 */
import { parseTime as parseCoreTime } from "./core/time.ts";
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

  type Entry = { archiveNo: string; shelf: string; text: string; when?: string; then?: string; observe?: string; quote?: string; watch?: string[]; about?: string; track?: string[]; for: number; against: number; irrelevant: number; lastEvidenceAt: number | null };
  const SHELF_NAME: Record<string, string> = { fact: "事实", told: "明说的规矩", rule: "规律", mirror: "镜子", attend: "留意", relation: "关系" };
  const SHELF_ENUM = ["fact", "told", "rule", "mirror", "attend", "relation"] as const;
  const entryLine = (e: Entry) =>
    [
      `[${e.archiveNo}]（${SHELF_NAME[e.shelf] ?? e.shelf}${e.about ? ` · ${e.about}` : ""}）${e.text}`,
      e.quote && `  原话：「${e.quote}」`,
      e.when && `  条件：${e.when}`,
      e.then && `  结果：${e.then}`,
      e.observe && `  怎么观察：${e.observe}`,
      e.watch?.length && `  留意：${e.watch.join("、")}`,
      e.track?.length && `  盯着：${e.track.join("、")}`,
      `  印证 ${e.for} · 反例 ${e.against}${e.irrelevant ? ` · 判无关 ${e.irrelevant}` : ""}${e.lastEvidenceAt ? ` · 最近一次 ${shortTime(e.lastEvidenceAt, tz)}` : ""}`,
    ]
      .filter(Boolean)
      .join("\n");

  server.registerTool(
    "gist_material",
    {
      description: "睡着时写梗概用：过完了、还没写梗概的天 / 周 / 月，和写每一段要看的东西（天看那天的情节，周看那周的天，月看那月的周），附写法说明。写好一段用 gist 交一段。",
      inputSchema: {},
    },
    guard(async () => {
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

  server.registerTool(
    "gist",
    {
      description: "交一段梗概：span（day / week / month）、key（2026-10-15 / 2026-W42 / 2026-10）、text（第一人称，你自己的话；天 ≤300 字、周 ≤500、月 ≤800）。同一段可以重写，后写的算数。",
      inputSchema: {
        span: z.enum(["day", "week", "month"]),
        key: z.string().min(1),
        text: z.string().min(1),
        promptVersion: z.number().int().optional().describe("gist_material 给的 promptVersion，原样传回"),
      },
    },
    guard(async (args) => {
      const r = (await call("POST", "/v1/gist", args)) as { span: string; key: string };
      return text(`收下了：${r.key} 的梗概。`);
    }),
  );

  server.registerTool(
    "coldwrite_material",
    {
      description: [
        "睡前整理用：取上次整理之后的经历（按会话分组，写过情节的给情节）、你书架上的现行条目、按你留意的词找到的候选证据、反馈（你做了什么 → 之后对方的原话或工具出错，一律给），以及你 track 了的互动统计（系统数的，只有数，没有结论）。",
        "同时给你写法说明和 upTo。看完用 coldwrite 写回。",
      ].join("\n"),
      inputSchema: {},
    },
    guard(async () => {
      const m = (await call("GET", "/v1/coldwrite")) as {
        upTo: string | null;
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
          ...m.material.flatMap((g) => [`── 会话 ${g.session ?? "（不在会话里）"}${g.harness ? `（在 ${g.harness}）` : ""} ──`, ...g.lines.map(line)]),
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
        "op：propose 新条目（shelf: fact 事实 / told 明说的规矩 / rule 规律 / mirror 镜子 / attend 留意 / relation 关系）· evidence 对现行条目判一条证据（for 印证 / against 反例 / irrelevant 无关）· revise 改写 · retire 作废。",
        "规律和镜子要写 when（条件）、then（结果）、observe（结果怎么观察），首批证据至少 2 条、来自不同时间（不同会话、不同的天或相隔 6 小时以上）；明说的规矩 quote 逐字照录她的原话。",
        "留意是你想看下去的疑问，要写 watch，一件事就能写；关系是你和某个人现在怎么样，要写 about，一人一条，变了就 revise。",
        `留意和关系可以带 track（要写 about），系统以后只给你看你 track 的统计：${TRACK_KEYS.join(" / ")}；想看全表用 stats。`,
        "upTo 原样传回。entries 可以是空的（看过了，没什么要写）。整批要么全收、要么全拒；被拒时会告诉你原因，改了再交。",
      ].join("\n"),
      inputSchema: {
        upTo: z.string().min(1).describe("coldwrite_material 给的 upTo，原样传回"),
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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
  server.registerTool(
    "schedule",
    {
      description: "看你的作息：闹钟、每天定点、心跳间隔，下次会因什么醒，今天的唤醒额度用了几次，以及 Joy 的设置（暂停、额度、心跳开没开放）。",
      inputSchema: {},
    },
    guard(async () => {
      const s = (await call("GET", "/v1/schedule")) as {
        schedule: {
          heartbeat: { everyMin: number } | null;
          daily: { at: string; note?: string }[];
          alarms: { id: string; at: number; note: string }[];
          wakeOn: { mail: boolean };
          dnd: { when: Record<string, unknown>; except?: { from: string; urgent?: boolean }[] }[];
        } | null;
        why?: string;
        next: { by: string; due: number; note?: string } | null;
        budget: { used: number; of: number };
        settings: { paused: boolean; wakeBudget: number; heartbeat: boolean };
      };
      const out: string[] = [];
      if (!s.schedule) out.push("还没排过作息。");
      else {
        const sc = s.schedule;
        out.push(`心跳：${sc.heartbeat ? `每 ${sc.heartbeat.everyMin} 分钟${s.settings.heartbeat ? "" : "（暂未开放，写了不生效）"}` : "没写"}`);
        out.push(`每天定点：${sc.daily.length ? sc.daily.map((d) => `${d.at}${d.note ? ` ${d.note}` : ""}`).join("；") : "没有"}`);
        out.push(`闹钟：${sc.alarms.length ? sc.alarms.map((a) => `[${a.id}] ${shortTime(a.at, tz)} ${a.note}`).join("；") : "没有"}`);
        out.push(`来信能叫醒你：${sc.wakeOn.mail ? "能" : "不能（关了）"}`);
        out.push(`勿扰：${sc.dnd.length ? sc.dnd.map((r) => `${JSON.stringify(r.when)}${r.except?.length ? ` 例外 ${JSON.stringify(r.except)}` : ""}`).join("；") : "没有"}`);
        if (s.why) out.push(`上次这么排的理由：${s.why}`);
      }
      out.push(`下次醒：${s.next ? `${shortTime(s.next.due, tz)}（${BY[s.next.by] ?? s.next.by}${s.next.note ? `：${s.next.note}` : ""}）` : "没有排着的"}`);
      out.push(`今天唤醒额度：${s.budget.used}/${s.budget.of}（闹钟、定点、心跳在你没醒着时叫醒各花一次，主动写给 Joy 的信、写给屋里住户的信（回信也算）每封花一次；整理、补写、来信叫醒、回 Joy 的信不花；到点时你醒着（30 分钟内有动静）也不花。勿扰只挡信，不挡闹钟、定点、心跳）`);
      if (s.settings.paused) out.push("Joy 暂停了叫醒（整理、补写也不叫）；你自己的哪一轮里到点的事照样递给你。");
      return text(out.join("\n"));
    }),
  );

  server.registerTool(
    "set_schedule",
    {
      description: [
        "排你的作息：交一整份（全量替换，没写的就没了），写为什么这么排。",
        "alarms：一次性闹钟，at 用本地时间（如 2026-10-15T15:00），note 是到时告诉你的话；要保留已有的闹钟，带上它的 id 原样交回。",
        "daily：每天定点（HH:MM）。heartbeat：每隔多少分钟给自己留一段时间（everyMin ≥ 15）。",
        "到点就在你这条会话里叫醒你（推一轮进来，<now> 的「刚发生」里写着是什么）；你正忙着就排在这一轮后面。你自己的哪一轮先赶上了，就在那一轮的 <now> 里报，不另叫。",
        "到点时你醒着（30 分钟内有对话或工具调用）不花额度；没醒着的，闹钟、定点、心跳各花一次唤醒额度。",
        "wakeOn.mail：来信能不能在你没醒着时叫醒你（缺省能，不花额度）。",
        "dnd：勿扰，一条条规则；一条里的条件都满足才算。条件：time { from, to }（HH:MM，可跨零点）、awake（醒着）、in（在哪个地方，如 soma）、busy（最近 15 分钟用过记忆以外的工具，在做事）。",
        "勿扰挡住的信：不叫醒你，醒着时也不在 <now> 里报，攒着，规则不成立了再报。except 是例外：[{ from: \"Joy\" }] 她的信都放行，加 urgent: true 只放行她标了急的。闹钟、定点、心跳不受勿扰影响。Joy 的暂停盖过例外。",
      ].join("\n"),
      inputSchema: {
        schedule: z.object({
          heartbeat: z.object({ everyMin: z.number().int() }).nullable().optional(),
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
        }),
        why: z.string().min(1).describe("为什么这么排"),
      },
    },
    guard(async (args) => {
      const r = (await call("POST", "/v1/schedule", args)) as { archiveNo: string };
      return text(`排好了（${r.archiveNo}）。`);
    }),
  );

  server.registerTool(
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
  const cites = z.array(z.string()).optional().describe("证据档号（你的经历或情节），可不挂");
  server.registerTool(
    "threads",
    {
      description: "看还开着的事：你挂上的、答应过谁的、等后续的，每卷的进展。all: true 连合上的一起看。",
      inputSchema: { all: z.boolean().optional() },
    },
    guard(async (args) => {
      type T = { archiveNo: string; type: string; title: string; to?: string; openedAt: number; notes: { at: number; text: string }[]; closed?: { at: number; how: string; why: string } };
      const r = (await call("GET", `/v1/threads${args.all ? "?all=1" : ""}`)) as { open: T[]; closed?: T[] };
      const show = (t: T) =>
        [
          `[${t.archiveNo}] ${t.type === "promise" ? `答应 ${t.to}：` : ""}${t.title}（${shortTime(t.openedAt, tz)} 开）`,
          ...t.notes.map((n) => `  ${shortTime(n.at, tz)} ${n.text}`),
          ...(t.closed ? [`  ${shortTime(t.closed.at, tz)} 合上（${HOW[t.closed.how] ?? t.closed.how}）：${t.closed.why}`] : []),
        ].join("\n");
      const out = [r.open.length ? r.open.map(show).join("\n") : "没有开着的事。"];
      if (r.closed?.length) out.push("", "合上的：", r.closed.map(show).join("\n"));
      return text(out.join("\n"));
    }),
  );

  server.registerTool(
    "open_thread",
    {
      description: [
        "开一卷还开着的事：之后在 <now> 里看得到开着几件、最久没动的是哪件，换会话时全列在开头。系统不替你合、不催、不判做没做到。",
        "type：promise = 你答应了谁什么（要写 to）；matter = 挂着、等后续的事。",
      ].join("\n"),
      inputSchema: { type: z.enum(["promise", "matter"]), title: z.string().min(1), to: z.string().optional(), note: z.string().optional(), cites },
    },
    guard(async (args) => {
      const r = (await call("POST", "/v1/threads", args)) as { archiveNo: string };
      return text(`开了（${r.archiveNo}）。`);
    }),
  );

  server.registerTool(
    "note_thread",
    {
      description: "在一卷开着的事上记一笔进展（target 是开卷那条的档号）。",
      inputSchema: { target: z.string().min(1), text: z.string().min(1), cites },
    },
    guard(async (args) => {
      const r = (await call("POST", "/v1/threads/note", args)) as { archiveNo: string };
      return text(`记下了（${r.archiveNo}）。`);
    }),
  );

  server.registerTool(
    "close_thread",
    {
      description: "合上一卷（target 是开卷那条的档号）。how：done 做到了 / dropped 不做了 / moot 不用做了；写 why。合上的不能再记；同一件事再起，开新卷。",
      inputSchema: { target: z.string().min(1), how: z.enum(["done", "dropped", "moot"]), why: z.string().min(1), cites },
    },
    guard(async (args) => {
      const r = (await call("POST", "/v1/threads/close", args)) as { archiveNo: string };
      return text(`合上了（${r.archiveNo}）。`);
    }),
  );

  // 屋里有谁（m8.md §二）
  server.registerTool(
    "look",
    {
      description: "看一眼屋里此刻有谁：每个住户在线（忙 / 闲）、睡着还是离线、在哪、挂着什么个签；Joy 在不在家（在家能在 Soma 直接说，不在家要找她就写信）。平时屋里有变化会在 <now> 的「这段时间屋里」里报。",
      inputSchema: {},
    },
    guard(async () => text(((await call("GET", "/v1/look")) as { text: string }).text)),
  );

  server.registerTool(
    "set_mood",
    {
      description: "挂一行心情个签，屋里的人都看得到（最多 60 字）。写不写、写什么由你；空串 = 清空。",
      inputSchema: { text: z.string() },
    },
    guard(async (args) => {
      const r = (await call("POST", "/v1/mood", args)) as { mood: string | null };
      return text(r.mood ? `挂上了：「${r.mood}」` : "清空了。");
    }),
  );

  // 自己的声音（m8.md §三）
  server.registerTool(
    "play",
    {
      description: [
        "给自己放歌：query 搜一首放（取第一首），或 playlist 放你的一个歌单（shuffle 打乱）。放完就停；再放会顶掉正在放的。",
        "你听到的是：歌名歌手、随播放推进的歌词、这一段的响度 / 亮暗 / 速度（本地从音频算的，不是模型听的）。在放着时每轮 <now> 的「这段时间听到的」里报；也可以用 listen 随时听一下。",
        "屋里的人可以戴上你的一只耳机一起听（Joy 在 Soma 页面上，别的住户用 listen_with）；只有有人戴着时才真的出声。",
      ].join("\n"),
      inputSchema: { query: z.string().optional(), playlist: z.string().optional(), shuffle: z.boolean().optional() },
    },
    guard(async (args) => {
      const r = (await call("POST", "/v1/play", args)) as { playing: { title: string; artist: string; album?: string; duration: number }; of: number; mismatch?: boolean };
      const d = `${Math.floor(r.playing.duration / 60)}:${String(r.playing.duration % 60).padStart(2, "0")}`;
      if (r.mismatch) return text(`搜「${args.query}」没有歌名对得上的，放的是《${r.playing.title}》${r.playing.artist}${r.playing.album ? `（专辑《${r.playing.album}》）` : ""}，${d}。不是你要的就换个说法再搜（加上歌手名通常更准）。`);
      return text(`在放《${r.playing.title}》${r.playing.artist}（${d}）${r.of > 1 ? `，共 ${r.of} 首` : ""}。`);
    }),
  );
  server.registerTool(
    "stop",
    { description: "停掉你正在放的歌。", inputSchema: {} },
    guard(async () => {
      await call("POST", "/v1/stop");
      return text("停了。");
    }),
  );
  server.registerTool(
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
  server.registerTool(
    "listen",
    { description: "听一下此刻在放的（你自己的，或你戴着谁的耳机就是他的）：哪首、放到哪、最近唱的几行、这一段的样子。", inputSchema: {} },
    guard(async () => text(((await call("GET", "/v1/listen")) as { text: string }).text)),
  );
  server.registerTool(
    "listen_with",
    {
      description: "戴上屋里另一个住户的一只耳机，跟着他听（host = 他的 id，看 look）；他那边看得到你戴上了。host 给空串 = 摘下。",
      inputSchema: { host: z.string() },
    },
    guard(async (args) => {
      const r = (await call("POST", "/v1/listen/with", { host: args.host || null })) as { joined?: string; left?: string };
      return text(r.joined ? `戴上了 ${r.joined} 的一只耳机。` : `摘下了 ${r.left} 的耳机。`);
    }),
  );

  server.registerTool(
    "notice",
    {
      description: [
        "记下你此刻注意到的一件事：关于自己（听这首时有种平静）、关于别人（Argon 干活时爱放打鸡血的歌）、关于屋里。about：self / 住户 id / Joy，可不写。",
        "系统顺手把此刻的环境（在放什么、屋里有谁）记在旁边。以后环境像了，它可能自己冒出来；整理记忆时和后来的事摆在一起，攒够了你可以把它写成规律。",
      ].join("\n"),
      inputSchema: { text: z.string().min(1), about: z.string().optional(), cites: z.array(z.string()).optional().describe("证据档号，可不挂") },
    },
    guard(async (args) => {
      const r = (await call("POST", "/v1/notice", args)) as { archiveNo: string; env: { tracks: unknown[]; people: string[] } };
      return text(`记下了（${r.archiveNo}）。`);
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
  const VIA: Record<string, string> = { "soma-note": "Soma 留言", email: "邮件" };
  const head = (m: MailView) => {
    const t = shortTime(m.at, tz);
    if (m.dir === "in") return `[${m.archiveNo}] ${t} 来信 · ${m.from}，经${VIA[m.via ?? ""] ?? m.via}${m.urgent ? " · 急" : ""}${m.subject ? `《${m.subject}》` : ""}`;
    if (m.dir === "handoff") return `[${m.archiveNo}] ${t} 交接信${m.for ? `（给 ${m.for}）` : ""}`;
    const failed = m.delivery?.filter((d) => !d.ok) ?? [];
    return `[${m.archiveNo}] ${t} 我写给 ${m.to}${m.replyTo ? `（回 ${m.replyTo}）` : ""}${m.subject ? `《${m.subject}》` : ""}${failed.length ? ` · 没送出去：${failed.map((d) => d.error).join("；")}` : ""}`;
  };

  server.registerTool(
    "mail",
    {
      description: [
        "看信。不给 open：列出这几天来往的信（来信、你写给 Joy 的、你留给自己的交接信）；没看过的只显示谁、几时、多少字。",
        "给 open（档号数组）：翻开这几封，看全文——翻开就算读过，之后 <now> 不再提它。",
        "来信不会自动塞进你的上下文：<now> 只告诉你有信，什么时候看由你定。",
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

  server.registerTool(
    "send_mail",
    {
      description: [
        "写信。在哪都能写。",
        "to: \"Joy\"：经她设的通道送到她那里（邮件 / Soma 留言）。回她的某封信挂 replyTo（那封的档号），不算额度；没挂 replyTo 就是你主动找她，每封花一次唤醒额度，额度用完会被拒。subject 可选（邮件主题，不写就用正文第一行）。",
        "to: 屋里别的住户的 id（如 a2）：直接送到他那里，他醒着时下一轮看到，没醒着会被叫醒（他设了来信叫醒的话）。每封都花你一次唤醒额度，回信也算。做接力时，做完自己那棒告诉下一个人用这个。",
        "to: \"self\"：交接信，写给之后去了别处的自己（离开家：Soma 是家，别的 harness 才算别处）——不会送回你写信的这个地方（同一个地方换了会话也不送），到了别的地方 <now> 会告诉你有封交接信；写明 for（如 soma、roxy）就只送那里。不过期，不叫醒你。",
      ].join("\n"),
      inputSchema: {
        to: z.string().min(1).describe("Joy、屋里住户的 id，或 self（交接信）"),
        text: z.string().min(1),
        subject: z.string().optional(),
        replyTo: z.string().optional().describe("回哪封信（档号）"),
        for: z.string().optional().describe("交接信送到哪个地方"),
      },
    },
    guard(async (args) => {
      const r = (await call("POST", "/v1/mail/out", args)) as { archiveNo: string; budget: { used: number; of: number } };
      return text(`写好了（${r.archiveNo}）。${args.to === "self" ? "" : `今天额度 ${r.budget.used}/${r.budget.of}。`}`);
    }),
  );

  return server;
}

if (import.meta.main) {
  const server = createPsycheMcp({
    url: process.env.PSYCHE_URL,
    agent: process.env.PSYCHE_AGENT,
    token: process.env.PSYCHE_TOKEN,
    timeZone: process.env.PSYCHE_TZ,
  });
  await server.connect(new StdioServerTransport());
}
