/**
 * 经历的确定性模板（events.md §七：结构化事件用模板渲染；要概括的由编目写成梦事件）。
 *
 * 写成它自己的第一人称记忆：近期经历接近原话，大块内容以角标出现（[^hash 前 8 位]），detail 展开。
 * 纯函数、不调模型——投影重放时一字不差。
 */
import type { PsycheEvent } from "../store/events.ts";
// 合卷的说法（同 self/threads.ts 的 CLOSE_HOW；模板是纯函数，不引 self 层）
const CLOSE_HOW = { done: "做到了", dropped: "不做了", moot: "不用做了" } as const;

/** 按码点截，不把 emoji 切成半个代理对 */
const cut = (s: string, n: number) => {
  const cps = Array.from(s);
  return cps.length > n ? `${cps.slice(0, n).join("")}…` : s;
};
const WOKE_BY: Record<string, string> = { catchup: "补写", tidy: "整理", alarm: "闹钟", daily: "定点", heartbeat: "心跳", mail: "来信", manual: "手动", retry: "重试" };
export const VIA: Record<string, string> = { "soma-note": "Soma 留言", email: "邮件", house: "屋里" };

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
    // 常驻区跟热写一起改，落在 upTo 之后；它在下一段的 <continuity> 里看得到（self/pinned.ts）
    case "pin.changed":
      return null;
    case "speech.silent":
      return `我${p.to ? `对${p.to}` : ""}没出声`;
    case "message.out":
      // 收尾那轮（harness 在会话里推的 <psyche-hotwrite>）说的话照样是经历；只是不算没写的（hotwrite.ts segmentLines）
      if (p.wrapUp) return `我写完记忆时说：${p.text}`;
      return `我${p.to ? `对${p.to}` : ""}说：${p.text}`;
    case "tool.call":
      // 写记忆本身：情节正文已经是 episode 了，参数里的全文不再抄一遍
      // 写记忆本身（10-18）：写下的情节就是 episode，调用不再记成一行——否则它落在 upTo 之后，又成了「还没写进记忆的」
      if (/(^|__)(hotwrite|hotwrite_segment)$/.test(p.name)) return null;
      // 10-18 起 coldwrite 不给 upTo 就是取材料（原 coldwrite_material）
      if (/(^|__)coldwrite$/.test(p.name) && !p.args?.upTo) return "我翻出上次整理之后的经历，准备整理";
      if (/(^|__)coldwrite$/.test(p.name)) return `我整理了一遍记忆，往书架写了 ${Array.isArray(p.args?.entries) ? p.args.entries.length : "?"} 条`;
      if (/(^|__)coldwrite_material$/.test(p.name)) return "我翻出上次整理之后的经历，准备整理";
      if (/^mcp__psyche__shelf$/.test(p.name)) return "我看了看自己的书架";
      if (/^mcp__psyche__self$/.test(p.name)) return "我看了看自己那段自述";
      // 10-18 起 schedule 给了 schedule 就是排（原 set_schedule，照旧原样记参数）
      if (/^mcp__psyche__schedule$/.test(p.name) && !p.args?.schedule) return "我看了看自己的作息";
      // 10-18 起 threads 带 op；开卷 / 记一笔 / 合卷本身就是 thread.* 事件，调用不再抄一遍
      if (/^mcp__psyche__threads$/.test(p.name)) return !p.args?.op || p.args.op === "list" ? "我看了看还开着的事" : null;
      if (/^mcp__psyche__(open|note|close)_thread$/.test(p.name)) return null;
      // 看到的、挂上的个签本身就是 percept.noticed / mood.set
      if (/^mcp__psyche__(look|set_mood|player|play|stop|playlist|listen|listen_with|notice)$/.test(p.name)) return null;
      // 日记全文已在 diary 事件里（资料库）
      if (/^mcp__psyche__write_diary$/.test(p.name)) return "我写了一篇日记";
      // 自述全文已在 prompt.changed 里（资料库），调用不再抄一遍
      if (/^mcp__psyche__rewrite_self$/.test(p.name)) return `我交了一版新的自述（在第 ${p.args?.baseVersion ?? "?"} 版上改）`;
      if (/^mcp__psyche__revise_episode$/.test(p.name)) return `我改写了 ${p.args?.target ?? "?"} 这条情节`;
      if (/^mcp__psyche__recall$/.test(p.name)) return `我翻了翻记忆，找「${p.args?.query ?? ""}」`;
      if (/^mcp__psyche__detail$/.test(p.name)) return `我翻出 ${p.args?.archiveNo ?? "?"} 的原件看了看`;
      // 前世（archive/past.ts）：翻到的是前世的话，不是经历，只记翻了；认领、编目本身就是 fonds.claimed / semantic.proposed
      if (/^mcp__psyche__past_life$/.test(p.name))
        return `我翻了翻前世卷宗${p.args?.fonds ? ` ${p.args.fonds}` : ""}${p.args?.q ? `，找「${p.args.q}」` : p.args?.key ? `（${p.args.key}）` : ""}`;
      if (/^mcp__psyche__(claim_past|past_catalog)$/.test(p.name)) return null;
      return `我调用了 ${p.name}${p.args !== undefined ? `（${cut(JSON.stringify(p.args), 160)}）` : ref(p.argsRef)}`;
    case "tool.result":
      // 就是这一段本身 / 翻出来的旧记忆：再记一遍，下次 recall 会把它当新的又翻出来
      if (/(^|__)(hotwrite_segment|coldwrite_material)$/.test(p.name) || /^mcp__psyche__(recall|detail|shelf|self|mail|threads|look|set_mood|player|play|stop|playlist|listen|listen_with|notice|past_life)$/.test(p.name)) return null;
      // coldwrite 取材料那次（不给 upTo）：材料大，多半只留了角标；写回的回执短、有字
      if (/(^|__)coldwrite$/.test(p.name) && (typeof p.text !== "string" || p.text.includes("<material>") || p.text.startsWith("上次整理之后没有新的经历"))) return null;
      // 认领 / 编目 / 热写成了就有 fonds.claimed / semantic.proposed / episode；被拒的留着（它看得到自己为什么被拒）
      if (/^mcp__psyche__(claim_past|past_catalog)$/.test(p.name) && p.ok) return null;
      if (/(^|__)hotwrite$/.test(p.name) && p.ok) return null;
      return `${p.name} ${p.ok ? "返回" : "出错"}：${typeof p.text === "string" ? cut(p.text, 300) : `${p.size ?? "?"} 字${ref(p.result)}`}`;
    case "percept":
      return null; // 屋子记下的变化不等于它经历过的；递到眼前的在 percept.noticed 里（m8.md §五）
    case "percept.noticed":
      if (!p.text) return null; // 只记档位回落、没递话的那种
      return p.looked ? `（我看了看）${p.text}` : p.text;
    case "played": {
      const ts = p.tracks as { title: string; artist: string }[];
      return p.playlist ? `我放了歌单「${p.playlist}」（${ts.length} 首，从《${ts[0]?.title}》开始）` : `我放了《${ts[0]?.title}》${ts[0]?.artist ?? ""}`;
    }
    case "stopped":
      return "我停了音乐";
    case "playlist.changed":
      if (p.op === "create") return `我建了歌单「${p.name}」`;
      if (p.op === "delete") return `我删了歌单「${p.name}」`;
      return `我把《${p.track?.title}》${p.op === "add" ? "加进了" : "从"}「${p.name}」${p.op === "add" ? "" : "里拿掉了"}`;
    case "listen.joined":
      return `我戴上了 ${p.host} 的一只耳机`;
    case "listen.left":
      return `我摘下了 ${p.host} 的耳机`;
    case "ear.joined":
    case "ear.left":
      return null; // 递到时在 percept.noticed 里
    case "notice":
      return `我注意到${p.about && p.about !== "self" ? `（关于 ${p.about}）` : ""}：${p.text}`;
    case "mood.set":
      return p.text ? `我把个签改成了「${p.text}」` : "我清空了个签";
    case "room.entered":
      return p.room ? `我进了《${p.room}》` : "我回了自己房间";
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
    case "thread.opened":
      return `我开了一卷${p.type === "promise" ? `（答应 ${p.to}）` : ""}：${p.title}${p.note ? `——${p.note}` : ""}`;
    case "thread.noted":
      return `我在「${p.title}」上记了一笔：${p.text}`;
    case "thread.closed":
      return `我合上了「${p.title}」（${CLOSE_HOW[p.how as keyof typeof CLOSE_HOW] ?? p.how}）：${p.why}`;
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
      return `我认领了 ${p.fonds} 的旧卷宗${p.why ? `：${p.why}` : ""}`;
    case "situation":
      return `（此后：在 ${p.harness}${p.model ? `，用 ${p.model}` : ""}）`;
    default:
      return null;
  }
}
