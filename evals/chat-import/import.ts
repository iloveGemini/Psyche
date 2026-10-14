/**
 * 把 claude.ai 导出（conversations.json）里的一组对话导进**测试库**，当作它在 claude-chat 里的经历（10-14 Joy 定）。
 *
 *   bun evals/chat-import/import.ts <conversations.json> --name 闲聊直到睡着 [--db ~/.psyche/test/psyche.db]
 *
 * 只给测试库用：正式库里，别处的旧聊天应走前世（另立全宗、它自己决定认不认领，archive.md §四）。
 * 原始导出和库都不进仓库。幂等：按消息 uuid 记幂等键，重跑不重复。
 *
 * 映射：human 的 text → message.in（from: Joy）；assistant 的 text → message.out；tool_use / tool_result → tool.call / tool.result。
 * 不收：thinking（它当时的内部推理，不是对话）、injected_prompt_block（claude.ai 注入的日期等）。图片、文件只记名字（导出里没有内容）。
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { EventStore } from "../../src/store/events.ts";
import { intake, type IntakeItem } from "../../src/archive/intake.ts";

interface Part {
  type: string;
  text?: string;
  name?: string;
  id?: string;
  tool_use_id?: string;
  input?: unknown;
  content?: unknown;
  is_error?: boolean;
  start_timestamp?: string;
}
interface Msg {
  uuid: string;
  sender: "human" | "assistant";
  created_at: string;
  content: Part[];
  attachments?: { file_name?: string }[];
  files?: { file_name?: string }[];
}
interface Conv {
  uuid: string;
  name: string;
  chat_messages: Msg[];
}

const textOf = (c: unknown): string =>
  typeof c === "string" ? c : Array.isArray(c) ? c.map((x) => (typeof x === "string" ? x : (x as { text?: string })?.text ?? "")).join("\n") : c ? JSON.stringify(c) : "";

export function itemsOf(conv: Conv, who = "Joy"): IntakeItem[] {
  const items: IntakeItem[] = [];
  for (const m of conv.chat_messages) {
    const at = Date.parse(m.created_at);
    const files = [...(m.attachments ?? []), ...(m.files ?? [])].map((f) => f.file_name).filter(Boolean);
    m.content.forEach((p, i) => {
      const t = p.start_timestamp ? Date.parse(p.start_timestamp) : at;
      const idem = `chat:${m.uuid}:${i}`;
      if (p.type === "text" && p.text?.trim()) {
        const text = p.text.trim() + (m.sender === "human" && files.length && i === 0 ? `\n[附件：${files.join("、")}]` : "");
        items.push(m.sender === "human" ? { kind: "message.in", source: "claude-chat", at: t, payload: { from: who, text }, idem } : { kind: "message.out", source: "claude-chat", at: t, payload: { text }, idem });
      } else if (p.type === "tool_use" && p.name) {
        items.push({ kind: "tool.call", source: "claude-chat", at: t, payload: { name: p.name, callId: p.id ?? idem, args: p.input }, idem });
      } else if (p.type === "tool_result") {
        items.push({ kind: "tool.result", source: "claude-chat", at: t, payload: { name: p.name ?? "tool", callId: p.tool_use_id ?? idem, ok: !p.is_error, text: textOf(p.content) }, idem });
      }
    });
    // 只有附件没有文字的一条
    if (m.sender === "human" && files.length && !m.content.some((p) => p.type === "text" && p.text?.trim()))
      items.push({ kind: "message.in", source: "claude-chat", at, payload: { from: who, text: `[附件：${files.join("、")}]` }, idem: `chat:${m.uuid}:files` });
  }
  return items;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const file = args[0];
  const name = opt("--name");
  if (!file || !name) throw new Error("用法：bun evals/chat-import/import.ts <conversations.json> --name <对话名> [--db …]");
  const db = opt("--db") ?? join(homedir(), ".psyche/test/psyche.db");
  if (!db.includes("/.psyche/test")) throw new Error(`只往测试库导：${db}`);
  const convs = (await Bun.file(file).json()) as Conv[];
  const conv = convs.find((c) => c.name === name);
  if (!conv) throw new Error(`没有叫「${name}」的对话`);
  const store = new EventStore(db);
  const items = itemsOf(conv);
  const session = `chat-${conv.uuid.slice(0, 8)}`;
  store.db.transaction(() => {
    const sit = store.append({ kind: "situation", class: "situation", source: "claude-chat", at: items[0].at! - 1000, payload: { harness: "claude-chat", session }, idem: `chat:${conv.uuid}:sit` });
    // 显式挂在这个对话的处境上：按发生时间找"当时生效的处境"，会挂到库里同一时段别的会话上（10-14 撞过）
    for (const it of items) intake(store, { ...it, situation: sit.id });
  })();
  const kinds = new Map<string, number>();
  for (const it of items) kinds.set(it.kind, (kinds.get(it.kind) ?? 0) + 1);
  console.log(JSON.stringify({ db, session, ...Object.fromEntries(kinds) }));
  store.close();
}
