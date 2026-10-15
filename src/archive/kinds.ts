/**
 * 各 kind 的 payload 形状与入库校验（archive.md「入库口」）。
 *
 * 库房本身不校验（更底层）；入库口校验：未登记的 kind 一律拒收——新需求 = 在这里登记新 kind，不往旧 kind 里塞字段。
 * 大块内容（工具返回、附件、日记、提示词）进资料库，payload 只放哈希，经历里以角标出现。
 */
import type { EventClass } from "../store/events.ts";

export interface MaterialRef {
  hash: string;
  mime?: string;
  name?: string;
}

type Field = "string" | "number" | "boolean" | "object" | "array" | "any";
interface KindSpec {
  class: EventClass;
  required: Record<string, Field>;
  /** 能挂的关系 */
  rels?: string[];
}

export const KINDS: Record<string, KindSpec> = {
  // ── 经历：发生在它身上、它经历到的 ──
  "message.in": { class: "experience", required: { from: "string", text: "string" } }, // + session?, attachments?: MaterialRef[]
  "message.out": { class: "experience", required: { text: "string" } }, // + to?, session?
  "tool.call": { class: "experience", required: { name: "string", callId: "string" } }, // + args?
  "tool.result": { class: "experience", required: { callId: "string", name: "string", ok: "boolean" } }, // + text? | result?: MaterialRef
  percept: { class: "experience", required: { sensor: "string", value: "any" } }, // + sensitive?: string[], precision?
  "mail.in": { class: "experience", required: { from: "string", text: "string" } },
  surfaced: { class: "experience", required: { ref: "string" } }, // + clarity?；线索记在 cue 里但不渲染给它看
  woke: { class: "experience", required: { by: "string" } },
  slept: { class: "experience", required: {} },

  // ── 自我：它自己做的选择 ──
  named: { class: "self", required: { name: "string" }, rels: ["evidence"] }, // + why?
  // 热写的情节条目（catalog.md §二）：正文 + 感受（原 imprint），cites 指向本段原件
  // revises：改写自己的一条情节，旧条留着，经历里显示新的
  episode: { class: "self", required: { text: "string" }, rels: ["cites", "revises"] },
  diary: { class: "self", required: { doc: "object" } }, // doc: MaterialRef（+ path?）
  "focus.changed": { class: "self", required: { items: "array" } },
  loaded: { class: "self", required: { refs: "array" } },
  evicted: { class: "self", required: { refs: "array" } },
  recalled: { class: "self", required: { refs: "array" } }, // + query?
  "policy.changed": { class: "self", required: { policy: "object" }, rels: ["evidence"] },
  "schedule.changed": { class: "self", required: { schedule: "object" } },
  "prompt.changed": { class: "self", required: { doc: "object", version: "number", why: "string" }, rels: ["evidence"] },
  moved: { class: "self", required: { to: "string" } },
  "mail.out": { class: "self", required: { to: "string", text: "string" } },
  "entity.merged": { class: "self", required: { into: "string", from: "array" } },
  "fonds.claimed": { class: "self", required: { fonds: "string" } },
  // 冷写的书架条目（m2.md §一）：它睡觉时写，系统只数证据。经冷写口子写入（catalog/coldwrite.ts）
  "semantic.proposed": { class: "self", required: { shelf: "string", text: "string" }, rels: ["evidence"] },
  "semantic.evidence": { class: "self", required: { target: "string", stance: "string" }, rels: ["evidence"] },
  "semantic.revised": { class: "self", required: { target: "string", why: "string" }, rels: ["evidence", "revises"] },
  "semantic.retired": { class: "self", required: { target: "string", why: "string" }, rels: ["evidence"] },
  "coldwrite.done": { class: "self", required: { upTo: "string", unjudged: "array" } },

  // ── 处境 ──
  situation: { class: "situation", required: { harness: "string" } }, // + model?, harnessPrompt?: hash, selfPromptVersion?
};

/** episode / semantic.* / coldwrite.done / prompt.changed / named 由热写、冷写、自我的口子写（带系统闸）；登记在这里是为了 kind 清单只有一份 */

export class IntakeError extends Error {}

function typeOf(v: unknown): Field {
  if (Array.isArray(v)) return "array";
  if (v === null) return "any";
  return typeof v as Field;
}

export function validate(kind: string, payload: unknown, links: { rel: string }[] = []): KindSpec {
  const spec = KINDS[kind];
  if (!spec) throw new IntakeError(`未登记的 kind：${kind}`);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new IntakeError(`${kind} 的 payload 必须是对象`);
  for (const [k, t] of Object.entries(spec.required)) {
    const v = (payload as Record<string, unknown>)[k];
    if (v === undefined) throw new IntakeError(`${kind} 缺字段 ${k}`);
    if (t !== "any" && typeOf(v) !== t) throw new IntakeError(`${kind}.${k} 应为 ${t}`);
  }
  for (const l of links) if (!spec.rels?.includes(l.rel)) throw new IntakeError(`${kind} 不能挂 ${l.rel} 关系`);
  return spec;
}
