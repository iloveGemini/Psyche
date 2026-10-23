/**
 * 他说的话里的两个标记（m1.md §五「说出口的和没说出口的」）：上报的 `message.out` 在入库口拆开。
 *
 * - `<unsaid>…</unsaid>`：没说出口的话（10-23 Joy 提）。和说出口的地位一样，进他的经历，记成 `speech.unsaid`；
 *   界面和别人收到的话里地方（Soma）去掉。用不用、写什么是他的事；Joy 后台翻得到，她答应过不拿来找茬。
 * - `<keep_silence/>` 独占整条：这一轮选了不开口，记成 `speech.silent`。
 *
 * 拆在 Psyche：哪个地方报上来的都一样拆（Claude Code 工位界面藏不掉，但记忆里照样分开）。代码块里的不算（他在贴代码）。
 */
import type { IntakeItem } from "./intake.ts";

const UNSAID_RE = /<unsaid>([\s\S]*?)<\/unsaid>/g;
const SILENCE_RE = /<keep_silence\s*\/>/g;
const FENCE = /(```[\s\S]*?```)/;

export interface Split {
  said: string;
  unsaid: string[];
  silent: boolean;
}

/** 拆一条他说的话：说出口的、没说出口的几段、是不是整条只是沉默 */
export function splitSpeech(raw: string): Split {
  const unsaid: string[] = [];
  let silence = false;
  const said = raw
    .split(FENCE)
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part
        .replace(UNSAID_RE, (_, t: string) => {
          if (t.trim()) unsaid.push(t.trim());
          return "";
        })
        .replace(SILENCE_RE, () => {
          silence = true;
          return "";
        });
    })
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!silence && !unsaid.length) return { said: raw, unsaid, silent: false };
  // 夹在话里的 <keep_silence/> 多半是在引用它：话照说，标记去掉
  return { said, unsaid, silent: silence && !said };
}

/** 一条上报的 message.out → 说出口的（有的话）+ 沉默（整条只是沉默）+ 每段没说出口的；没有标记的原样 */
export function expandSpeech(item: IntakeItem): IntakeItem[] {
  if (item.kind !== "message.out" || typeof item.payload.text !== "string") return [item];
  const s = splitSpeech(item.payload.text);
  if (s.said === item.payload.text) return [item];
  const { text: _, ...rest } = item.payload;
  const out: IntakeItem[] = [];
  if (s.said) out.push({ ...item, payload: { ...rest, text: s.said } });
  if (s.silent) out.push({ ...item, kind: "speech.silent", payload: rest, ...(item.idem ? { idem: `${item.idem}:silent` } : {}) });
  s.unsaid.forEach((text, n) => out.push({ ...item, kind: "speech.unsaid", payload: { ...rest, text }, ...(item.idem ? { idem: `${item.idem}:unsaid:${n}` } : {}) }));
  return out;
}
