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
  // 这一轮选了不开口（10-20：Roxy 的 <keep_silence/>）；跟没轮到他说（没能回应）、什么都没发生都不一样
  "speech.silent": { class: "experience", required: {} }, // + to?, session?
  // 没说出口的话（10-23 Joy 提）：和说出口的地位一样，只是没对人说；上报的 message.out 里的 <unsaid> 在入库口拆出来（speech.ts）
  "speech.unsaid": { class: "experience", required: { text: "string" } }, // + to?, session?
  "tool.call": { class: "experience", required: { name: "string", callId: "string" } }, // + args?
  "tool.result": { class: "experience", required: { callId: "string", name: "string", ok: "boolean" } }, // + text? | result?: MaterialRef
  percept: { class: "experience", required: { sensor: "string", value: "any" } }, // + subject?, name?, prev?（m8.md：全屋记下的变化；不进经历，递到才算）
  // 它自己 look 看到的（looked: true，m8.md §五）；10-24 之前递送也写这一条（没有 looked，经历里不显示）。递送现在记系统日志 percept.delivered
  "percept.noticed": { class: "experience", required: { refs: "array", text: "string" } }, // + session?, looked?
  // 来信（m6.md §一）：经通道口子写，不挂处境；没翻开前经历里不给正文
  "mail.in": { class: "experience", required: { from: "string", text: "string", via: "string" } }, // + subject?, urgent?, ext?（外部通道的消息 id）
  surfaced: { class: "experience", required: { ref: "string" } }, // + clarity?；线索记在 cue 里但不渲染给它看
  woke: { class: "experience", required: { by: "string" } }, // + note?, session?（补写哪个会话）
  // 到点的闹钟 / 定点响了（m5.md §四）：它下一次取 <now> 时写（推给 Soma 的那一轮，或它自己先赶上的那一轮）
  due: { class: "experience", required: { by: "string", key: "string" } }, // + note, at（约的时刻）
  slept: { class: "experience", required: {} },

  // ── 自我：它自己做的选择 ──
  named: { class: "self", required: { name: "string" }, rels: ["evidence"] }, // + why?
  // 热写的情节条目（catalog.md §二）：正文 + 感受（原 imprint），cites 指向本段原件
  // revises：改写自己的一条情节，旧条留着，经历里显示新的
  episode: { class: "self", required: { text: "string" }, rels: ["cites", "revises"] },
  diary: { class: "self", required: { doc: "object" } }, // doc: MaterialRef（+ path?）
  // 梗概（10-16）：天 / 周 / 月，它睡着时自己写（catalog/gist.ts）
  gist: { class: "self", required: { span: "string", key: "string", text: "string" } },
  // 还开着的事（m7.md）：它开卷、记碎片、合卷；noted / closed 的 title 由系统抄上（经历模板看不到开卷那条）
  "thread.opened": { class: "self", required: { type: "string", title: "string" }, rels: ["evidence"] }, // + to?, note?
  "thread.noted": { class: "self", required: { target: "string", title: "string", text: "string" }, rels: ["evidence"] },
  "thread.closed": { class: "self", required: { target: "string", title: "string", how: "string", why: "string" }, rels: ["evidence"] },
  // 心情个签（m8.md §二）：本人挂，空串 = 清空
  "mood.set": { class: "self", required: { text: "string" } },
  // 换房间（P3，10-19；houses-p1.md §四）：在哪间由 Soma 管，这里记他走的这一步。老记录 room 空串 = 回了自己房间
  "room.entered": { class: "self", required: { room: "string" } }, // + house, houseName, id, from?, fromHouse?, parent?
  // 自己的声音（m8.md §三）：放、停、歌单、跟着谁听——它的动作；别人来戴 / 摘它的耳机是它经历到的
  played: { class: "self", required: { tracks: "array", startAt: "number" } }, // + playlist?
  stopped: { class: "self", required: {} },
  "playlist.changed": { class: "self", required: { name: "string", op: "string" } }, // + track?
  "listen.joined": { class: "self", required: { host: "string" } },
  "listen.left": { class: "self", required: { host: "string" } },
  "ear.joined": { class: "experience", required: { who: "string" } },
  "ear.left": { class: "experience", required: { who: "string" } },
  // 注意到（m8.md §4.2）：它当场写的一条观察；系统把此刻的环境记进 env、挂成证据
  notice: { class: "self", required: { text: "string" }, rels: ["evidence"] }, // + about?, env
  "focus.changed": { class: "self", required: { items: "array" } },
  loaded: { class: "self", required: { refs: "array" } },
  evicted: { class: "self", required: { refs: "array" } },
  recalled: { class: "self", required: { refs: "array" } }, // + query?
  "policy.changed": { class: "self", required: { policy: "object" }, rels: ["evidence"] },
  "schedule.changed": { class: "self", required: { schedule: "object" } },
  "senses.changed": { class: "self", required: { senses: "object", why: "string" } }, // 感知设置（m8.md §6.4）
  "prompt.changed": { class: "self", required: { doc: "object", version: "number", why: "string" }, rels: ["evidence"] },
  moved: { class: "self", required: { to: "string" } },
  "mail.out": { class: "self", required: { to: "string", text: "string" } }, // + subject?, replyTo?, for?, from: { harness, session }（系统填）
  "mail.read": { class: "self", required: { refs: "array" } }, // + seen: string[]（「Joy 的信」「交接信」）
  "entity.merged": { class: "self", required: { into: "string", from: "array" } },
  "fonds.claimed": { class: "self", required: { fonds: "string", why: "string" }, rels: ["evidence"] }, // + count（导了几条原话；archive/past.ts）
  // 冷写的书架条目（m2.md §一）：它睡觉时写，系统只数证据。经冷写口子写入（catalog/coldwrite.ts）
  "semantic.proposed": { class: "self", required: { shelf: "string", text: "string" }, rels: ["evidence"] },
  "semantic.evidence": { class: "self", required: { target: "string", stance: "string" }, rels: ["evidence"] },
  "semantic.revised": { class: "self", required: { target: "string", why: "string" }, rels: ["evidence", "revises"] },
  "semantic.retired": { class: "self", required: { target: "string", why: "string" }, rels: ["evidence"] },
  "coldwrite.done": { class: "self", required: { upTo: "string", unjudged: "array" } },
  // 常驻区（self/pinned.ts）：跟 hotwrite 一起写，pin / unpin 是书架条目的 root
  "pin.changed": { class: "self", required: { pin: "array", unpin: "array" } },
  // 新会话的种子放了哪些情节（m1.md §五，10-23）：浮现在这段会话里跳过它们；经历里不渲染
  "continuity.seeded": { class: "self", required: { episodes: "array" } }, // + since?, session?

  // ── 处境 ──
  situation: { class: "situation", required: { harness: "string" } }, // + model?, harnessPrompt?: hash, selfPromptVersion?
};

/** episode / semantic.* / coldwrite.done / prompt.changed / named / schedule.changed / diary / due / mail.* 由热写、冷写、自我、作息的口子写（带系统闸）；登记在这里是为了 kind 清单只有一份 */

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
