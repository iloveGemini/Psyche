/**
 * 热写考卷的样本：从 Claude Code 的会话记录（~/.claude/projects/<项目>/<会话>.jsonl）里抽真实对话，
 * 走入库口进一个临时库，再按"段"渲染成 `GET /v1/hotwrite` 的返回形状，存到 out/。
 *
 * out/ 里是 Joy 的私人对话，已在 .gitignore 里，不进仓库。
 *
 * 映射照 notes/design/soma.md §一：
 *   她的话 → message.in（from: Joy）；assistant 文本 → message.out；tool_use → tool.call；tool_result → tool.result
 *   thinking 不收（过程，不是经历）；子代理内部步骤、harness 注入的命令回显 / 任务通知 / 压缩摘要不收。
 * 每个会话开头报一次处境 {harness: "claude-code", model, session: 原会话 id}。
 *
 * 段：按 Joy 的话轮切，凑够 --min 行成一段（单个话轮超过 --max 行就从中间切开），
 * 每个会话在所有段里均匀挑 --per 段。真实的段（压缩前才写）会长得多，这里取短的，方便人看。
 *
 * 防线：不收 ~/.ascm、Roxy、Roy 的数据——
 *   输入文件路径命中 DENY_FILE 的直接拒绝；
 *   某次工具调用的参数碰到 Roy / Roxy / .ascm 的，它的返回内容在样本里略去（调用本身保留）。
 *
 * 用法：bun evals/hot-write/sample.ts [--per 2] [--min 40] [--max 120] <会话.jsonl>...
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { EventStore, displayArchiveNo, type PsycheEvent } from "../../src/store/events.ts";
import { intake, type IntakeItem } from "../../src/archive/intake.ts";
import { renderExperience } from "../../src/archive/render.ts";
import { localDay } from "../../src/core/time.ts";
import type { Segment } from "./check.ts";

const HERE = dirname(new URL(import.meta.url).pathname);
const OUT = join(HERE, "out");
const PROMPT = join(HERE, "../../prompts/hot-write.md");

const DENY_FILE = /\.ascm|roxy|Agent-Self-Continuity-Memory|Echore/i;
const DENY_ARGS = /\.ascm|roxy|\broy\b/i;
const REDACTED = "（样本里略去：这次调用涉及 Roy / Roxy 的数据）";
const SOURCE = "claude-code";

// ── 读提示词 ──

export function loadPrompt(path = PROMPT): { prompt: string; version: number } {
  const raw = readFileSync(path, "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  const version = Number(m?.[1].match(/^version:\s*(\d+)/m)?.[1]);
  if (!m || !Number.isFinite(version)) throw new Error(`${path} 缺 frontmatter 的 version`);
  return { prompt: raw.slice(m[0].length).trim(), version };
}

// ── jsonl → 入库项 ──

interface Parsed {
  session: string;
  model?: string;
  items: IntakeItem[];
}

const stripReminders = (s: string) => s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
const harnessEcho = (s: string) => /^(<command-|<local-command-|<task-notification>|Caveat:|\[Request interrupted)/.test(s.trim());

export function parseSession(raw: string, putImage: (b64: string, mime: string) => string): Parsed {
  const items: IntakeItem[] = [];
  const toolName = new Map<string, string>();
  const redacted = new Set<string>();
  let session = "";
  let model: string | undefined;

  for (const ln of raw.split("\n")) {
    if (!ln.trim()) continue;
    let r: any;
    try {
      r = JSON.parse(ln);
    } catch {
      continue;
    }
    if (r.type !== "user" && r.type !== "assistant") continue;
    if (r.isSidechain || r.isMeta || r.isCompactSummary) continue;
    session ||= r.sessionId;
    const at = Date.parse(r.timestamp);
    const content = r.message?.content;

    if (r.type === "assistant") {
      model ??= r.message?.model;
      (Array.isArray(content) ? content : []).forEach((b: any, i: number) => {
        if (b.type === "text" && b.text?.trim())
          items.push({ kind: "message.out", source: SOURCE, at, idem: `${r.uuid}:${i}`, payload: { text: b.text.trim(), session } });
        else if (b.type === "tool_use") {
          toolName.set(b.id, b.name);
          if (DENY_ARGS.test(JSON.stringify(b.input ?? {}))) redacted.add(b.id);
          items.push({ kind: "tool.call", source: SOURCE, at, idem: b.id, payload: { name: b.name, callId: b.id, args: b.input } });
        }
      });
      continue;
    }

    // user：她的话，或工具返回
    const human = !r.origin || r.origin.kind === "human";
    if (typeof content === "string") {
      const text = stripReminders(content);
      if (human && text && !harnessEcho(text)) items.push({ kind: "message.in", source: SOURCE, at, idem: r.uuid, payload: { from: "Joy", text, session } });
      continue;
    }
    if (!Array.isArray(content)) continue;
    const said: string[] = [];
    const attachments: { hash: string; mime: string }[] = [];
    for (const b of content) {
      if (b.type === "text") said.push(b.text);
      else if (b.type === "image" && b.source?.type === "base64") attachments.push({ hash: putImage(b.source.data, b.source.media_type), mime: b.source.media_type });
      else if (b.type === "tool_result") {
        const parts = typeof b.content === "string" ? [b.content] : (b.content ?? []).map((c: any) => (c.type === "text" ? c.text : `[${c.type}]`));
        const text = redacted.has(b.tool_use_id) ? REDACTED : stripReminders(parts.join("\n"));
        items.push({
          kind: "tool.result",
          source: SOURCE,
          at,
          idem: `${b.tool_use_id}:result`,
          payload: { callId: b.tool_use_id, name: toolName.get(b.tool_use_id) ?? "?", ok: !b.is_error, text },
        });
      }
    }
    const text = stripReminders(said.join("\n"));
    if (human && (text || attachments.length) && !harnessEcho(text))
      items.push({ kind: "message.in", source: SOURCE, at, idem: r.uuid, payload: { from: "Joy", text, session, ...(attachments.length ? { attachments } : {}) } });
  }
  return { session, model, items };
}

// ── 切段 ──

interface Row {
  ev: PsycheEvent;
  text: string | null;
}

/** 按话轮切成若干段；每段是 rows 的一个下标区间 [start, end) */
export function windows(rows: Row[], min: number, max: number): [number, number][] {
  const out: [number, number][] = [];
  let start = 0;
  let lines = 0;
  for (let i = 0; i < rows.length; i++) {
    const turnStart = rows[i].ev.kind === "message.in";
    if (turnStart && lines >= min) {
      out.push([start, i]);
      start = i;
      lines = 0;
    }
    if (rows[i].text !== null) lines++;
    if (lines >= max) {
      out.push([start, i + 1]);
      start = i + 1;
      lines = 0;
    }
  }
  if (lines >= Math.min(min, 10)) out.push([start, rows.length]);
  return out;
}

/** 在 n 段里均匀挑 k 段 */
const spread = (n: number, k: number) => (k >= n ? [...Array(n).keys()] : [...new Set(Array.from({ length: k }, (_, i) => Math.round((i * (n - 1)) / Math.max(1, k - 1))))]);

// ── 主程序 ──

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt = { per: 2, min: 40, max: 120 };
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const m = args[i].match(/^--(per|min|max)$/);
    if (m) opt[m[1] as keyof typeof opt] = Number(args[++i]);
    else files.push(args[i]);
  }
  if (!files.length) {
    console.error("用法：bun evals/hot-write/sample.ts [--per 2] [--min 40] [--max 120] <会话.jsonl>...");
    process.exit(2);
  }
  for (const f of files) if (DENY_FILE.test(f)) throw new Error(`不收这个文件（Roy / Roxy / ASCM）：${f}`);

  const { prompt, version } = loadPrompt();
  mkdirSync(OUT, { recursive: true });
  const dbPath = join(OUT, "samples.db");
  for (const suf of ["", "-wal", "-shm"]) rmSync(dbPath + suf, { force: true });
  const store = new EventStore(dbPath);
  const refYear = Number(localDay(Date.now(), store.timeZone).slice(0, 4));

  // 按会话开始时间入库：处境靠发生时间对上
  const parsed = files
    .map((f) => ({ file: f, ...parseSession(readFileSync(f, "utf8"), (b64, mime) => store.putMaterial(Buffer.from(b64, "base64"), mime)) }))
    .filter((p) => p.items.length)
    .sort((a, b) => (a.items[0].at ?? 0) - (b.items[0].at ?? 0));

  const index: { file: string; project: string; session: string; windows: number; picked: { out: string; lines: number; from: string; to: string }[] }[] = [];
  for (const p of parsed) {
    store.append({
      kind: "situation",
      class: "situation",
      source: SOURCE,
      at: p.items[0].at,
      payload: { harness: "claude-code", session: p.session, ...(p.model ? { model: p.model } : {}) },
    });
    const evs = store.db.transaction(() => p.items.map((it) => intake(store, it)))();
    const rows: Row[] = evs.filter((e) => e.class !== "situation" && e.kind !== "episode").map((ev) => ({ ev, text: renderExperience(ev) }));
    const ws = windows(rows, opt.min, opt.max);
    const project = basename(dirname(p.file));
    const entry = { file: p.file, project, session: p.session, windows: ws.length, picked: [] as (typeof index)[number]["picked"] };
    for (const k of spread(ws.length, opt.per)) {
      const [s, e] = ws[k];
      const seg = rows.slice(s, e);
      const out: Segment & { sample: unknown } = {
        session: p.session,
        upTo: seg[seg.length - 1].ev.id,
        prompt,
        promptVersion: version,
        lines: seg.filter((r) => r.text !== null).map((r) => ({ archiveNo: displayArchiveNo(r.ev.archiveNo, refYear), at: r.ev.at, text: r.text! })),
        sample: { project, window: k, of: ws.length },
      };
      const name = `${project.replace(/^-Users-joy-?/, "") || "home"}-${p.session.slice(0, 8)}-${k}.json`;
      writeFileSync(join(OUT, name), JSON.stringify(out, null, 2));
      entry.picked.push({ out: name, lines: out.lines.length, from: out.lines[0].archiveNo, to: out.lines[out.lines.length - 1].archiveNo });
    }
    index.push(entry);
  }
  writeFileSync(join(OUT, "index.json"), JSON.stringify(index, null, 2));
  store.close();
  for (const e of index) console.log(`${e.project} ${e.session.slice(0, 8)}：${e.windows} 段，取了 ${e.picked.map((x) => `${x.out}（${x.lines} 行）`).join("、")}`);
}
