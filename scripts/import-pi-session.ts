#!/usr/bin/env bun
/**
 * 把一卷 pi 会话（Roxy / Soma pi 身体的 jsonl）导进一个住户的库，当作它在那个地方的经历。
 * 10-19 Joy 定：Roy 从 Roxy 搬回 Soma，只导他眼前那一卷（更早的在前世 ROY 里有）。
 *
 *   bun scripts/import-pi-session.ts --data-dir ~/.psyche/data --agent roy --harness roxy <session.jsonl> [--dry-run]
 *
 * 映射同 Soma 的 pi 身体（Soma lib/soma/bodies/pi-shape.ts + report.ts）：
 * - 她的话 → message.in（from Joy，via = harness）；Roxy 的唤醒包（`<system_wake triggers="…">`）→ woke（by = 触发）。
 * - 他说的话（每个非空 text 块）→ message.out；工具调用 / 结果 → tool.call / tool.result。思考不收。
 * - 不收：压缩摘要（另一个模型替他写的）、Roxy 每轮的 moment / 接续简报（那是地方递给他的处境，不是发生的事）、模型切换行。
 * - 处境：开头一条（harness、会话号、模型），换模型在那一刻再记一条。
 * 幂等：idem 同 Soma（responseId:块序号 / 工具 id / 工具 id:result），source = harness；重跑不重复。Psyche 要关着（直接写库）。
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { EventStore } from "../src/store/events.ts";
import { intake, type IntakeItem } from "../src/archive/intake.ts";

interface Block {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  arguments?: unknown;
}

interface Entry {
  type: string;
  id?: string;
  timestamp?: string;
  provider?: string;
  modelId?: string;
  message?: {
    role: string;
    content?: string | Block[];
    model?: string;
    provider?: string;
    responseId?: string;
    toolCallId?: string;
    toolName?: string;
    isError?: boolean;
    stopReason?: string;
    timestamp?: number;
  };
}

const WAKE = /^\s*<system_wake triggers="([^"]*)">/;
const hasWords = (t: string | undefined) => !!t && /[^\s�]/.test(t);

function textOf(content: string | Block[] | undefined): string {
  if (typeof content === "string") return content;
  return (content ?? []).map((b) => (b.type === "text" ? (b.text ?? "") : `[${b.type}]`)).join("\n");
}

/** 一卷 → 会话号 + 处境变化 + 事件 */
export function read(text: string, harness: string) {
  const entries: Entry[] = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    try {
      entries.push(JSON.parse(raw));
    } catch {
      /* 坏行跳过 */
    }
  }
  const head = entries.find((e) => e.type === "session") as (Entry & { cwd?: string }) | undefined;
  if (!head?.id) throw new Error("不是 pi 会话：没有 session 行");
  const session = head.id;
  const situations: { at: number; payload: Record<string, unknown> }[] = [];
  const items: IntakeItem[] = [];
  let model: string | undefined;
  const base = { harness, session, ...(head.cwd ? { cwd: head.cwd } : {}) };

  for (const e of entries) {
    const m = e.message;
    if (e.type !== "message" || !m) continue;
    const at = m.timestamp ?? Date.parse(e.timestamp ?? "");
    if (!Number.isFinite(at)) continue;
    if (m.role === "assistant") {
      // 出错的那次 pi 不放进上下文，也不是他说的话（同 Soma）
      if (m.stopReason === "error") continue;
      const now = m.provider && m.model ? `${m.provider}/${m.model}` : m.model;
      if (now && now !== model) {
        model = now;
        situations.push({ at, payload: { ...base, model } });
      }
      const uuid = m.responseId ?? `${session}:${at}`;
      (Array.isArray(m.content) ? m.content : []).forEach((b, i) => {
        if (b.type === "text" && hasWords(b.text)) {
          items.push({ kind: "message.out", source: harness, at, idem: `${uuid}:${i}`, payload: { text: b.text, session } });
        } else if (b.type === "toolCall" && b.id) {
          items.push({ kind: "tool.call", source: harness, at, idem: b.id, payload: { name: b.name ?? "", callId: b.id, args: b.arguments ?? {}, session } });
        }
      });
    } else if (m.role === "toolResult" && m.toolCallId) {
      items.push({
        kind: "tool.result",
        source: harness,
        at,
        idem: `${m.toolCallId}:result`,
        payload: { callId: m.toolCallId, name: m.toolName ?? "", ok: m.isError !== true, text: textOf(m.content), session },
      });
    } else if (m.role === "user") {
      const t = textOf(m.content).trim();
      if (!t) continue;
      const wake = WAKE.exec(t);
      items.push(
        wake
          ? { kind: "woke", source: harness, at, idem: `${session}:wake:${e.id}`, payload: { by: wake[1], session } }
          : { kind: "message.in", source: harness, at, idem: `${session}:in:${e.id}`, payload: { from: "Joy", text: t, via: harness, session } },
      );
    }
  }
  // 头一条处境要在头一件事之前
  const first = Math.min(...items.map((i) => i.at ?? Infinity));
  if (situations.length && Number.isFinite(first)) situations[0].at = Math.min(situations[0].at, first);
  else if (Number.isFinite(first)) situations.push({ at: first, payload: base });
  return { session, situations, items: items.sort((a, b) => (a.at ?? 0) - (b.at ?? 0)) };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const expand = (p: string) => p.replace(/^~(?=\/|$)/, homedir());
  const dataDir = opt("--data-dir");
  const agent = opt("--agent");
  const harness = opt("--harness");
  const dry = args.includes("--dry-run");
  const file = args.find((a, i) => !a.startsWith("--") && !["--data-dir", "--agent", "--harness"].includes(args[i - 1] ?? ""));
  if (!dataDir || !agent || !harness || !file) throw new Error("用法：bun scripts/import-pi-session.ts --data-dir <目录> --agent <id> --harness <地方> <session.jsonl> [--dry-run]");
  const { session, situations, items } = read(readFileSync(file, "utf8"), harness);
  const count = (k: string) => items.filter((i) => i.kind === k).length;
  console.log(`${session}：处境 ${situations.length}，事件 ${items.length}（她 ${count("message.in")}、他 ${count("message.out")}、工具 ${count("tool.call")}/${count("tool.result")}、醒 ${count("woke")}）`);
  if (dry) process.exit(0);
  const db = join(expand(dataDir), agent, "psyche.db");
  const store = new EventStore(db);
  store.db.transaction(() => {
    for (const s of situations) store.setSituation(s.payload, harness, s.at);
    for (const it of items) intake(store, it);
  })();
  store.close();
  console.log(`共 ${items.length} 条 → ${db}`);
}
