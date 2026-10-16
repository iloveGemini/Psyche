/**
 * 经历的确定性模板（events.md §七：结构化事件用模板渲染；要概括的由编目写成梦事件）。
 *
 * 写成它自己的第一人称记忆：近期经历接近原话，大块内容以角标出现（[^hash 前 8 位]），detail 展开。
 * 纯函数、不调模型——投影重放时一字不差。
 */
import type { PsycheEvent } from "../store/events.ts";

/** 按码点截，不把 emoji 切成半个代理对 */
const cut = (s: string, n: number) => {
  const cps = Array.from(s);
  return cps.length > n ? `${cps.slice(0, n).join("")}…` : s;
};
const WOKE_BY: Record<string, string> = { catchup: "补写", tidy: "整理", alarm: "闹钟", daily: "定点", heartbeat: "心跳", mail: "来信", manual: "手动" };
export const VIA: Record<string, string> = { "soma-note": "Soma 留言", email: "邮件" };

/** 来信在经历里的样子：没翻开只说有信（m6.md §〇.2），翻开后（mail.read）投影换成全文 */
export function mailInText(p: { from: string; text: string; via: string; subject?: string }, read: boolean): string {
  const head = `（来信 · ${p.from}，经${VIA[p.via] ?? p.via}）`;
  return read ? `${head}${p.subject ? `《${p.subject}》` : ""}${p.text}` : `${head}还没看`;
}
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
      // 写记忆本身：情节正文已经是 episode 了，参数里的全文不再抄一遍
      if (/(^|__)hotwrite$/.test(p.name)) return `我把这一段写成了 ${Array.isArray(p.args?.entries) ? p.args.entries.length : "?"} 条情节`;
      if (/(^|__)hotwrite_segment$/.test(p.name)) return "我翻出这一段，准备写进记忆";
      if (/(^|__)coldwrite$/.test(p.name)) return `我整理了一遍记忆，往书架写了 ${Array.isArray(p.args?.entries) ? p.args.entries.length : "?"} 条`;
      if (/(^|__)coldwrite_material$/.test(p.name)) return "我翻出上次整理之后的经历，准备整理";
      if (/^mcp__psyche__shelf$/.test(p.name)) return "我看了看自己的书架";
      if (/^mcp__psyche__self$/.test(p.name)) return "我看了看自己那段自述";
      if (/^mcp__psyche__schedule$/.test(p.name)) return "我看了看自己的作息";
      // 日记全文已在 diary 事件里（资料库）
      if (/^mcp__psyche__write_diary$/.test(p.name)) return "我写了一篇日记";
      // 自述全文已在 prompt.changed 里（资料库），调用不再抄一遍
      if (/^mcp__psyche__rewrite_self$/.test(p.name)) return `我交了一版新的自述（在第 ${p.args?.baseVersion ?? "?"} 版上改）`;
      if (/^mcp__psyche__revise_episode$/.test(p.name)) return `我改写了 ${p.args?.target ?? "?"} 这条情节`;
      if (/^mcp__psyche__recall$/.test(p.name)) return `我翻了翻记忆，找「${p.args?.query ?? ""}」`;
      if (/^mcp__psyche__detail$/.test(p.name)) return `我翻出 ${p.args?.archiveNo ?? "?"} 的原件看了看`;
      return `我调用了 ${p.name}${p.args !== undefined ? `（${cut(JSON.stringify(p.args), 160)}）` : ref(p.argsRef)}`;
    case "tool.result":
      // 就是这一段本身 / 翻出来的旧记忆：再记一遍，下次 recall 会把它当新的又翻出来
      if (/(^|__)(hotwrite_segment|coldwrite_material)$/.test(p.name) || /^mcp__psyche__(recall|detail|shelf|self|mail)$/.test(p.name)) return null;
      return `${p.name} ${p.ok ? "返回" : "出错"}：${typeof p.text === "string" ? cut(p.text, 300) : `${p.size ?? "?"} 字${ref(p.result)}`}`;
    case "percept":
      return `（感知 · ${p.sensor}）${typeof p.value === "string" ? p.value : JSON.stringify(p.value)}`;
    case "mail.in":
      return mailInText(p as { from: string; text: string; via: string }, false);
    case "mail.read":
      return `我看了${(p.seen as string[] | undefined)?.join("、") || "信"}`;
    case "surfaced":
      return null; // 浮现本身不进经历文本：它冒出来时已经在上下文里了
    case "woke":
      return `（醒来 · ${WOKE_BY[p.by] ?? p.by}）`;
    case "due":
      return `（${p.by === "daily" ? "定点" : "闹钟"}）${p.note ?? ""}`;
    case "slept":
      return "（睡了）";
    case "named":
      return `我给自己取名「${p.name}」`;
    case "episode":
      return null; // 情节不走模板：经历投影直接用它写的正文（experience.ts），热写清单里也不列
    case "diary":
      return `我写了日记${p.title ? `《${p.title}》` : ""}${ref(p.doc)}`;
    case "gist":
      return `我给 ${p.key} 写了梗概：${p.text}`;
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
      return `我改了作息${p.why ? `：${p.why}` : ""}`;
    case "prompt.changed":
      return `我改写了自己那段提示词（第 ${p.version} 版）${ref(p.doc)}：${p.why}`;
    case "moved":
      return `我去了 ${p.to}`;
    case "mail.out":
      if (p.to === "self") return `我给之后在别处的自己留了封信${p.for ? `（给 ${p.for}）` : ""}：${p.text}`;
      if (p.replyTo) return `我回了 ${p.to} 的信：${p.text}`;
      return `我给 ${p.to} 写信${p.subject ? `《${p.subject}》` : ""}：${p.text}`;
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
