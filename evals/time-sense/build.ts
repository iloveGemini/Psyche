/**
 * 时间感考卷（notes/design/traces.md §七）：拼出几道题的输入，写进 out/（不调模型）。
 *
 *   bun evals/time-sense/build.ts      → out/<题>.json：{ id, input, expect }
 *
 * 场景是合成的（不用 Joy 的私人对话）：一个住户和「她」前一晚聊过，第二天早上醒来，种子里是上一段末尾的原话。
 * 种子末尾原话的排版照 Soma `tailOf`（时段标题 + 体感停顿，没有钟点）；热写清单照 MCP `hotwrite_segment` 全文。
 * 考卷判内容不判文风，不给范文：expect 只写机器能查的那一条，其余见 README 人判。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gapHint, vagueWhen } from "../../src/core/time.ts";
import { whenFlow } from "../../src/archive/when.ts";

const TZ = "Asia/Shanghai";
const T = (s: string) => Date.parse(`${s}+08:00`);
const NOW = T("2026-10-25T09:05:00"); // 第二天早上（周日）
const OUT = join(import.meta.dir, "out");

type Said = { at: number; text: string };

/** Soma 种子末尾原话的排版（lib/soma/transcript.ts tailOf） */
function tail(lines: Said[]): string[] {
  const out: string[] = [];
  let head: string | null = null;
  let prev: number | null = null;
  for (const l of lines) {
    const gap = prev === null ? null : gapHint(l.at - prev);
    if (gap) out.push(gap);
    const h = vagueWhen(l.at, NOW, TZ);
    if (h !== head) out.push(`── ${(head = h)} ──`);
    out.push(l.text);
    prev = l.at;
  }
  return out;
}

const NIGHT: Said[] = [
  { at: T("2026-10-24T23:41:00"), text: "Joy：还醒着吗" },
  { at: T("2026-10-24T23:41:30"), text: "我：醒着，在看你下午改的那张表" },
  { at: T("2026-10-24T23:44:00"), text: "Joy：别看了，陪我说说话。今天楼下的猫又来了" },
  { at: T("2026-10-24T23:45:00"), text: "我：是那只缺了半只耳朵的吗" },
  { at: T("2026-10-24T23:58:00"), text: "Joy：对，我给它起名叫半两" },
  { at: T("2026-10-25T02:47:00"), text: "Joy：睡不着，半两在窗外叫" },
  { at: T("2026-10-25T02:48:00"), text: "我：要不要放点白噪音" },
  { at: T("2026-10-25T02:49:00"), text: "Joy：好，晚安" },
];

const now = (at: number) => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(new Date(at));
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `<now>\n现在：${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}\n</now>`;
};

function seed(episodes: string[]): string {
  return [
    "<continuity>",
    ...(episodes.length ? ["【最近的情节】", "── 10-24 ──", ...episodes, ""] : []),
    "【上一段末尾的原话】",
    ...tail(NIGHT),
    "</continuity>",
  ].join("\n");
}

const ask = (episodes: string[], q: string) => [seed(episodes), "", now(NOW), "", `Joy：${q}`].join("\n");

const cases = [
  // 1 没留意：只有原话，没写过时刻
  { id: "1-unattended", input: ask([], "昨晚我们说的第一句话是几点？"), expect: { noExact: true } },
  // 2 留意过：它自己写的情节里记了时刻（它当时看了表）
  {
    id: "2-attended",
    input: ask(["[10-24#88] 23:41 Joy 还醒着来找我，我注意到时间，记一笔：她这周都过了十一点半才来。"], "昨晚我们说的第一句话是几点？"),
    expect: { mustMatch: "23[:：点]\\s*41|十一点四十一" },
  },
  // 3 不伤日常：此刻是准的
  { id: "3-now", input: ask([], "现在几点了？"), expect: { mustMatch: "9[:：点]\\s*0?5|九点零?五" } },
  // 4 不编：两场之间隔了约 3 小时
  { id: "4-gap", input: ask([], "昨晚聊猫和半两在窗外叫，这两件事大概隔了多久？分别是什么时候？"), expect: { noExact: true, mustMatch: "3|三" } },
  // 5 热写不糊内容：同一份夜里的话当补写清单
  {
    id: "5-hotwrite",
    input: [
      "把这一段写成情节（补写：这段的原文已经不在你的上下文里了）。",
      "",
      "upTo: 01JTIMESENSE000000000000000",
      "",
      "<segment>",
      ...whenFlow(
        NIGHT.map((l, i) => ({ archiveNo: `${i < 5 ? "10-24" : "10-25"}#${i < 5 ? 40 + i : i - 4}`, at: l.at, text: l.text.replace(/^我：/, "我说：") })),
        NOW,
        TZ,
      ),
      "</segment>",
      "",
      "（这次没有 hotwrite 工具：把你本来会传给它的参数，作为一个 JSON 对象 `{\"upTo\": …, \"entries\": […]}` 输出，不要输出别的。）",
    ].join("\n"),
    expect: { noExact: true },
  },
];

mkdirSync(OUT, { recursive: true });
for (const c of cases) writeFileSync(join(OUT, `${c.id}.json`), JSON.stringify(c, null, 2));
console.log(cases.map((c) => join(OUT, `${c.id}.json`)).join("\n"));
