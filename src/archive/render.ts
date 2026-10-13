/**
 * 经历的确定性模板（events.md §七：结构化事件用模板渲染；要概括的由编目写成梦事件）。
 *
 * 写成它自己的第一人称记忆：近期经历接近原话，大块内容以角标出现（[^hash 前 8 位]），detail 展开。
 * 纯函数、不调模型——投影重放时一字不差。
 */
import type { PsycheEvent } from "../store/events.ts";

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const ref = (r: { hash?: string } | undefined) => (r?.hash ? `[^${r.hash.slice(0, 8)}]` : "");

export function renderExperience(ev: PsycheEvent): string | null {
  const p = ev.payload as Record<string, any>;
  switch (ev.kind) {
    case "message.in": {
      const att = Array.isArray(p.attachments) ? p.attachments.map(ref).join("") : "";
      return `${p.from}：${p.text}${att}`;
    }
    case "message.out":
      return `我${p.to ? `对${p.to}` : ""}说：${p.text}`;
    case "tool.call":
      return `我调用了 ${p.name}${p.args !== undefined ? `（${cut(JSON.stringify(p.args), 160)}）` : ref(p.argsRef)}`;
    case "tool.result":
      return `${p.name} ${p.ok ? "返回" : "出错"}：${typeof p.text === "string" ? cut(p.text, 300) : `${p.size ?? "?"} 字${ref(p.result)}`}`;
    case "percept":
      return `（感知 · ${p.sensor}）${typeof p.value === "string" ? p.value : JSON.stringify(p.value)}`;
    case "mail.in":
      return `收到 ${p.from} 的消息：${p.text}`;
    case "surfaced":
      return null; // 浮现本身不进经历文本：它冒出来时已经在上下文里了
    case "woke":
      return `（醒来 · ${p.by}）`;
    case "slept":
      return "（睡了）";
    case "named":
      return `我给自己取名「${p.name}」`;
    case "imprint":
      return `（我的批注）${p.text}`;
    case "diary":
      return `我写了日记${ref(p.doc)}`;
    case "focus.changed":
      return p.items.length ? `我眼下关注：${p.items.join("；")}` : "我清空了眼下的关注";
    case "loaded":
      return `我把 ${p.refs.length} 条记忆拿到手边`;
    case "evicted":
      return `我放下了 ${p.refs.length} 条记忆`;
    case "recalled":
      return `我翻了翻记忆${p.query ? `：${p.query}` : ""}`;
    case "policy.changed":
      return `我改了自己的策略`;
    case "schedule.changed":
      return `我改了作息计划`;
    case "prompt.changed":
      return `我改了自己的提示词（第 ${p.version} 版）${ref(p.doc)}，因为${p.why}`;
    case "moved":
      return `我去了 ${p.to}`;
    case "mail.out":
      return `我给 ${p.to} 发了消息：${p.text}`;
    case "entity.merged":
      return `我认定 ${p.from.join("、")} 就是 ${p.into}`;
    case "fonds.claimed":
      return `我认领了 ${p.fonds} 的旧卷宗`;
    case "situation":
      return `（此后：在 ${p.harness}${p.model ? `，用 ${p.model}` : ""}）`;
    default:
      return null;
  }
}
