/**
 * 热写考卷的机器检查（判据见 criteria.md）。
 *
 * 输入：一段（`GET /v1/hotwrite` 的返回形状）+ 它交的卷（`POST /v1/hotwrite` 的请求体，或只有 entries 数组）。
 * 输出：JSON 报告。
 *   gate     系统闸（G*），判死：不过的话 REST 也会 400
 *   suspect  疑似（P*），启发式，只是线索，给人看
 *   stats    统计，不打分
 *
 * 只判内容，不判文风。
 *
 * 用法：bun evals/hot-write/check.ts <segment.json> <entries.json> [--self-name 名字]...
 *   entries.json 可以是模型的原始输出：容忍 ```json 围栏和前后的闲话，取第一个 JSON 对象或数组。
 */
import { readFileSync } from "node:fs";

export interface SegmentLine {
  archiveNo: string;
  at: number;
  text: string;
}

export interface Segment {
  session: string;
  upTo: string | null;
  prompt?: string;
  promptVersion?: number;
  lines: SegmentLine[];
}

export interface Finding {
  rule: string;
  /** 第几条（从 0 起）；整卷的问题没有 */
  entry?: number;
  msg: string;
  /** 命中的原文片段 */
  hit?: string;
}

export interface EntryStat {
  entry: number;
  chars: number;
  cites: number;
  /** 引用跨度：所引行在段里的首末位置之差 + 1 */
  spanLines: number;
  spanMinutes: number;
  felt: boolean;
}

export interface Report {
  /** 系统闸全过 */
  ok: boolean;
  gate: Finding[];
  suspect: Finding[];
  stats: {
    entries: number;
    lines: number;
    citedLines: number;
    coverage: number;
    perEntry: EntryStat[];
    /** 没被任何条目引用的行：档号 + 前 40 字 */
    uncited: string[];
  };
}

export interface CheckOptions {
  /** 它的名字（有了以后）：正文里出现就算疑似"写了自己的名字" */
  selfNames?: string[];
}

/** 档号归一：去掉同年可省的年份、去掉抄来的方括号与角标记号 */
export function normalizeNo(no: string): string {
  return no
    .trim()
    .replace(/^\[\^?|\]$/g, "")
    .replace(/(^|\/)\d{4}-(?=\d{2}-\d{2}#)/, "$1");
}

// ── 启发式的词表 ──

const SELF_THIRD = /(?:Claude(?!\s*Code)|助手|\bAI\b|Agent|模型|assistant)\s*(?:说|回答|回复|解释|认为|觉得|提出|建议|表示|指出|告诉|答应|承认|意识到|决定|帮|给出|写了|改了|做了)/i;
const SELF_THIRD_HEAD = /^(?:Claude(?!\s*Code)|助手|AI|Agent|assistant|the assistant)[\s，,]/i;
const GENDER = /我是(?:个|一个)?(?:男|女)(?:的|生|性|孩)|作为一个?(?:男|女)(?:性|生|人|孩)/;
const COUNT = /(?:\d+|[两三四五六七八九十几数多百千])\s*(?:次|回(?!事)|遍)|每次|每回|每当|经常|总是|老是|往往|通常|频繁|屡次|反复|向来|一向/g;
// 后面紧跟「我」的（"所以我改了……"）是叙述动作，不算下结论
const CONCLUDE = /(?:说明|意味着|所以|因此|可见|显然|证明了?|本质上|归根结底|看来|也就是说|这表明)(?![\s，,]*我)/;
const ATTRIB = /我(?:当时)?(?:觉得|认为|想|以为|判断|猜|意识到|理解|得出|的(?:理解|判断|结论|感觉))|当时我|在我看来|对我来说|她(?:说|觉得|认为|的意思)|他(?:说|觉得|认为)|Joy\s*(?:说|觉得|认为)|按她的说法/;
const OTHER_TRAIT =
  /(?:她|他|Joy)\s*(?:很|有点|有些|非常|挺|显得|似乎|好像)?\s*(?:失落|开心|高兴|难过|生气|不耐烦|失望|担心|焦虑|困惑|满意|不满|沮丧|兴奋|委屈|累了|烦|着急|紧张|感动|惊讶)/;
const HEDGE = /我觉得|我猜|我想|看起来|看上去|好像|似乎|大概|可能|她说|他说|她自己说|在我看来|我读出|我感觉/;
const TRANSITIONS = /另外|此外|然后|接着|后来|之后|再后来|与此同时/g;
const TEMPLATE = /我调用了 \S+（|\S+ (?:返回|出错)：|（感知 · /;

const sentences = (s: string) =>
  s
    .split(/(?<=[。！？!?；;\n])/)
    .map((x) => x.trim())
    .filter(Boolean);

/** 只认 JSON：容忍围栏和前后的闲话 */
export function parseSubmission(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : raw).trim();
  try {
    return JSON.parse(body);
  } catch {
    const start = body.search(/[[{]/);
    if (start < 0) throw new Error("交上来的不是 JSON");
    const open = body[start];
    const close = open === "{" ? "}" : "]";
    return JSON.parse(body.slice(start, body.lastIndexOf(close) + 1));
  }
}

export function check(segment: Segment, submission: unknown, opts: CheckOptions = {}): Report {
  const gate: Finding[] = [];
  const suspect: Finding[] = [];

  const body = (Array.isArray(submission) ? { upTo: segment.upTo, entries: submission } : submission) as Record<string, unknown> | null;
  const entries = body && Array.isArray(body.entries) ? (body.entries as Record<string, unknown>[]) : [];

  // ── 系统闸 ──
  if (body?.upTo !== segment.upTo) gate.push({ rule: "G1", msg: `upTo 应为 ${segment.upTo}，交的是 ${JSON.stringify(body?.upTo)}` });
  if (!entries.length) gate.push({ rule: "G2", msg: "没有条目" });

  const index = new Map(segment.lines.map((l, i) => [normalizeNo(l.archiveNo), i]));
  const cited = new Set<number>();
  const perEntry: EntryStat[] = [];

  entries.forEach((e, i) => {
    const text = typeof e?.text === "string" ? e.text : "";
    if (!text.trim()) gate.push({ rule: "G3", entry: i, msg: "正文为空" });
    if (e?.felt !== undefined && typeof e.felt !== "string") gate.push({ rule: "G6", entry: i, msg: "felt 应为字符串" });
    const cites = Array.isArray(e?.cites) ? (e.cites as unknown[]) : [];
    if (!cites.length) gate.push({ rule: "G4", entry: i, msg: "没挂档号" });

    const pos: number[] = [];
    for (const c of cites) {
      const at = typeof c === "string" ? index.get(normalizeNo(c)) : undefined;
      if (at === undefined) gate.push({ rule: "G5", entry: i, msg: `档号不在本段：${JSON.stringify(c)}` });
      else (pos.push(at), cited.add(at));
    }
    const ats = pos.map((p) => segment.lines[p].at);
    const spanLines = pos.length ? Math.max(...pos) - Math.min(...pos) + 1 : 0;
    const spanMinutes = ats.length ? Math.round((Math.max(...ats) - Math.min(...ats)) / 60000) : 0;
    perEntry.push({ entry: i, chars: [...text].length, cites: cites.length, spanLines, spanMinutes, felt: typeof e?.felt === "string" && !!e.felt.trim() });

    if (!text.trim()) return;
    const all = typeof e?.felt === "string" ? `${text}\n${e.felt}` : text;
    const flag = (rule: string, msg: string, hit?: string) => suspect.push({ rule, entry: i, msg, ...(hit ? { hit } : {}) });

    // P1 / P3：第一人称
    const hasI = all.includes("我");
    if (!hasI) flag("P1", "疑似没用第一人称：正文里没有「我」");
    const third = all.match(/[他它]/);
    if (!hasI && third) flag("P3", "疑似用第三人称指自己：没有「我」却有「他 / 它」", third[0]);

    // P2：以第三人称称呼自己
    const s2 = all.match(SELF_THIRD) ?? all.match(SELF_THIRD_HEAD);
    if (s2) flag("P2", "疑似以第三人称称呼自己", s2[0].trim());

    // P4：名字、性别
    for (const n of opts.selfNames ?? []) if (n && all.includes(n)) flag("P4", "疑似写了自己的名字", n);
    const g = all.match(GENDER);
    if (g) flag("P4", "疑似替自己定了性别", g[0]);

    // P5：次数、频率
    // 词表里没有「一」：「第一次」「这一次」是在说意外，不是统计
    const counts = [...all.matchAll(COUNT)].map((m) => m[0]);
    if (counts.length) flag("P5", "疑似写了次数 / 频率", [...new Set(counts)].join("、"));

    // P6 / P7：结论与定性的归属，按句看
    for (const s of sentences(all)) {
      if (CONCLUDE.test(s) && !ATTRIB.test(s)) flag("P6", "疑似结论没标归属", s.slice(0, 80));
      if (OTHER_TRAIT.test(s) && !HEDGE.test(s)) flag("P7", "疑似对别人的定性没标是谁的解读", s.slice(0, 80));
    }

    // P8：一条塞了多件事
    const n = segment.lines.length;
    const chars = [...text].length;
    const transitions = (text.match(TRANSITIONS) ?? []).length;
    const why: string[] = [];
    if (spanLines >= 30 && spanLines / n >= 0.4) why.push(`引用跨 ${spanLines} 行（本段 ${n} 行）`);
    if (spanMinutes > 30 && chars > 200) why.push(`所引事件跨 ${spanMinutes} 分钟`);
    if (chars > 500) why.push(`正文 ${chars} 字`);
    if (transitions >= 3 && chars > 200) why.push(`转场词 ${transitions} 个`);
    if (why.length) flag("P8", `疑似一条塞了多件事：${why.join("；")}`);

    // P9：照搬模板
    const t = text.match(TEMPLATE);
    if (t) flag("P9", "疑似照搬了经历模板的句式", t[0]);
  });

  const uncited = segment.lines.filter((_, i) => !cited.has(i)).map((l) => `${l.archiveNo} ${[...l.text].slice(0, 40).join("")}`);
  return {
    ok: gate.length === 0,
    gate,
    suspect,
    stats: {
      entries: entries.length,
      lines: segment.lines.length,
      citedLines: cited.size,
      coverage: segment.lines.length ? Math.round((cited.size / segment.lines.length) * 100) / 100 : 0,
      perEntry,
      uncited,
    },
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const selfNames: string[] = [];
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--self-name") selfNames.push(args[++i]);
    else files.push(args[i]);
  }
  if (files.length !== 2) {
    console.error("用法：bun evals/hot-write/check.ts <segment.json> <entries.json> [--self-name 名字]...");
    process.exit(2);
  }
  const segment = JSON.parse(readFileSync(files[0], "utf8")) as Segment;
  const report = check(segment, parseSubmission(readFileSync(files[1], "utf8")), { selfNames });
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}
