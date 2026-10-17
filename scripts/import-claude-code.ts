#!/usr/bin/env bun
/**
 * 把 Claude Code 的原始 transcript 导进一个住户的库，当作它在工位上的经历（10-17 Joy 定：Claude 认领自己在 ASCM 时期的经历，走全库，不另立前世全宗）。
 *
 *   bun scripts/import-claude-code.ts --data-dir ~/.psyche/data --agent claude <transcript.jsonl>… [--dry-run]
 *
 * 映射和插件（harness/claude-code/src/transcript.ts）同一套：它说的话、工具调用与结果；她的话从 transcript 的用户行取。
 * - 用户行：origin = human → message.in from Joy；task-notification / 定时检查等 Claude Code 自己塞的 → from「Claude Code」，via 记来源；
 *   命令回显（<command-name>、<local-command-…>）、isMeta、子代理不收。去掉 <system-reminder>（hook 注入的上下文，不是她说的）。
 * - 处境：每个会话一条起始处境（harness: claude-code、开会话时的 cwd、头一个模型），换了模型在那一刻再记一条（cd 不算换地方）。
 * - 思考不收（同插件）。ASCM 替它写的画像、梗概、情节一概不收——只收发生过的事。
 * 幂等：idem 和插件一样（消息 uuid / 工具 id），重跑、之后插件再报都不重复。Psyche 要关着（直接写库）。
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { EventStore } from "../src/store/events.ts";
import { intake, type IntakeItem } from "../src/archive/intake.ts";
import { parseTranscript, SOURCE } from "../harness/claude-code/src/transcript.ts";

const args = process.argv.slice(2);
const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const expand = (p: string) => p.replace(/^~(?=\/|$)/, homedir());
const dataDir = opt("--data-dir");
const agent = opt("--agent");
const dry = args.includes("--dry-run");
const files = args.filter((a, i) => !a.startsWith("--") && !["--data-dir", "--agent"].includes(args[i - 1] ?? ""));
if (!dataDir || !agent || !files.length) throw new Error("用法：bun scripts/import-claude-code.ts --data-dir <目录> --agent <id> <transcript.jsonl>… [--dry-run]");

interface Line {
  type?: string;
  uuid?: string;
  timestamp?: string;
  cwd?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  origin?: { kind?: string };
  message?: { model?: string; content?: unknown };
}

const strip = (t: string) => t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
const ECHO = /^\s*<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat)>/;

/** 一个 transcript → 处境变化 + 事件 */
export function read(text: string, session: string) {
  const situations: { at: number; payload: Record<string, unknown> }[] = [];
  const said: IntakeItem[] = [];
  const lines: Line[] = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    try {
      lines.push(JSON.parse(raw));
    } catch {
      /* 坏行跳过 */
    }
  }
  const modelOf = (d: Line) => (d.type === "assistant" && d.message?.model && d.message.model !== "<synthetic>" ? d.message.model : undefined);
  let model = lines.map(modelOf).find(Boolean);
  const cwd = lines.find((d) => d.cwd)?.cwd;
  for (const d of lines) {
    if (!d.uuid || d.isSidechain || !d.message) continue;
    const at = Date.parse(d.timestamp ?? "");
    if (!Number.isFinite(at)) continue;
    const m = modelOf(d) ?? model;
    if (m !== model || !situations.length) {
      model = m;
      situations.push({ at, payload: { harness: "claude-code", session, ...(model ? { model } : {}), ...(cwd ? { cwd } : {}) } });
    }
    if (d.type !== "user" || d.isMeta) continue;
    const content = d.message.content;
    const text = typeof content === "string" ? content : Array.isArray(content) ? (content as { type?: string; text?: string }[]).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n") : "";
    const t = strip(text);
    if (!t || ECHO.test(t)) continue;
    const human = d.origin?.kind === "human";
    said.push({
      kind: "message.in",
      source: SOURCE,
      at,
      idem: `${session}:in:${d.uuid}`,
      payload: { from: human ? "Joy" : "Claude Code", text: t, via: human ? "claude-code" : `claude-code:${d.origin?.kind ?? "system"}`, session },
    });
  }
  const { items } = parseTranscript(text, session);
  return { situations, items: [...said, ...items].sort((a, b) => (a.at ?? 0) - (b.at ?? 0)) };
}

if (import.meta.main) {
  const db = join(expand(dataDir), agent, "psyche.db");
  const store = dry ? null : new EventStore(db);
  let total = 0;
  for (const f of files) {
    const session = basename(f, ".jsonl");
    const { situations, items } = read(readFileSync(f, "utf8"), session);
    total += items.length;
    console.log(`${session}：处境 ${situations.length}，事件 ${items.length}（她 ${items.filter((i) => i.kind === "message.in" && i.payload.from === "Joy").length}）`);
    if (!store) continue;
    store.db.transaction(() => {
      for (const s of situations) store.setSituation(s.payload, SOURCE, s.at);
      for (const it of items) intake(store, it);
    })();
  }
  console.log(`${dry ? "（试跑）" : ""}共 ${total} 条 → ${db}`);
}
