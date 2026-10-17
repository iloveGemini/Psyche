/**
 * Claude Code 的 transcript（JSONL）里哪些行成为 Psyche 的事件（notes/plan/claude-code.md §一）。
 *
 * 映射照 Soma `lib/soma/report.ts`（同一种消息格式：Agent SDK 的消息就是 transcript 的行）：
 * 他说的话（整块文字）、调的工具、工具回来的东西。不报：她说的话（UserPromptSubmit 时已经报了）、
 * 思考、子代理（isSidechain）、Claude Code 自己合成的消息（model = <synthetic>）、元数据行、附件。
 *
 * 纯函数，没有 I/O，好测。
 */

export interface IntakeItem {
  kind: string;
  source: string;
  payload: Record<string, unknown>;
  at: number;
  idem: string;
}

export const SOURCE = "claude-code";

const SYNTHETIC = "<synthetic>";

/**
 * 插件带的 MCP 在 Claude Code 里叫 mcp__plugin_psyche_psyche__X；Psyche 认记忆工具按 mcp__psyche__X
 * （回声不搜、翻出来的不算经历、"在做事"不算记忆工具），所以报上去之前规整成后者。
 */
export const toolName = (name: string) => name.replace(/^mcp__plugin_psyche_psyche__/, "mcp__psyche__");
const TOOL_USE = new Set(["tool_use", "server_tool_use", "mcp_tool_use"]);

interface Block {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

interface Line {
  type?: string;
  uuid?: string;
  timestamp?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  message?: { model?: string; content?: unknown };
}

const timeOf = (stamp: string | undefined, fallback: number) => {
  const at = stamp ? Date.parse(stamp) : NaN;
  return Number.isFinite(at) ? at : fallback;
};

const blocks = (content: unknown): Block[] => (typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? (content as Block[]) : []);

/** 工具结果的文字；非文字的部分留个记号占位 */
export function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content === undefined || content === null ? "" : JSON.stringify(content);
  return content.map((part: { type?: string; text?: string }) => (part.type === "text" ? (part.text ?? "") : `[${part.type}]`)).join("\n");
}

/** 有没有说出字（模型偶尔只吐出一个 U+FFFD 就转去调工具，那不是它说的话） */
export const hasWords = (text: string | undefined) => !!text && /[^\s�]/.test(text);

function toolResult(block: Block, name: string, at: number, session: string): IntakeItem {
  const content = block.content as { type?: string } | undefined;
  const failed = block.is_error === true || (content !== null && typeof content === "object" && !Array.isArray(content) && content.type?.endsWith("_error") === true);
  return {
    kind: "tool.result",
    source: SOURCE,
    at,
    idem: `${block.tool_use_id}:result`,
    payload: { callId: block.tool_use_id, name, ok: !failed, text: resultText(block.content), session },
  };
}

export interface Parsed {
  items: IntakeItem[];
  /** 最后一条助手消息用的模型（换了模型要重报处境） */
  model?: string;
}

/**
 * 从 transcript 全文挑出事件。done = 已报过的 idem（插件数据目录里存着），挑出来的不含它们。
 * 工具名按 callId 从前面的 tool_use 找（结果行里没有名字）。
 */
export function parseTranscript(text: string, session: string, done: ReadonlySet<string> = new Set(), now = Date.now()): Parsed {
  const names = new Map<string, string>();
  const items: IntakeItem[] = [];
  let model: string | undefined;
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    let d: Line;
    try {
      d = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!d.uuid || d.isSidechain || d.isMeta || !d.message) continue;
    const at = timeOf(d.timestamp, now);
    if (d.type === "assistant") {
      if (d.message.model === SYNTHETIC) continue;
      if (d.message.model) model = d.message.model;
      blocks(d.message.content).forEach((b, i) => {
        if (b.type === "text" && hasWords(b.text)) {
          items.push({ kind: "message.out", source: SOURCE, at, idem: `${d.uuid}:${i}`, payload: { text: b.text, session } });
        } else if (TOOL_USE.has(b.type) && b.id) {
          names.set(b.id, toolName(b.name ?? ""));
          items.push({ kind: "tool.call", source: SOURCE, at, idem: b.id, payload: { name: toolName(b.name ?? ""), callId: b.id, args: b.input ?? {}, session } });
        } else if (b.type.endsWith("_tool_result") && b.tool_use_id) {
          items.push(toolResult(b, "", at, session));
        }
      });
    } else if (d.type === "user") {
      for (const b of blocks(d.message.content)) {
        if (b.type === "tool_result" && b.tool_use_id) items.push(toolResult(b, names.get(b.tool_use_id) ?? "", at, session));
      }
    }
  }
  return { items: items.filter((it) => !done.has(it.idem)), model };
}

/** 斜杠命令、Claude Code 自己塞进来的东西：报，但不取 <now>（没有在跟它说话） */
export const isCommand = (prompt: string) => /^\s*\//.test(prompt) || /^\s*<(command-name|local-command-|bash-)/.test(prompt);
