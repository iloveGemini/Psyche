/**
 * 把 out/ 里的一段拼成交给模型的输入（跑考卷用，不调模型）。
 *
 *   bun evals/hot-write/input.ts <segment.json>   → 收尾那一轮的消息：提示词 + upTo + 清单 + 考卷附注
 *   bun evals/hot-write/input.ts --self           → 系统提示词（机制 + 初我，没出生的库 /v1/prompt 给的那份）
 *
 * 清单的排版与 MCP 的 hotwrite_segment 一致：`[档号] MM-DD HH:mm 内容`。
 * 考卷附注只说输出格式（这里没有 hotwrite 工具），不加任何写法上的要求。
 */
import { readFileSync } from "node:fs";
import type { Segment } from "./check.ts";
import { filePrompt } from "../../src/self/self.ts";

const TZ = process.env.PSYCHE_TZ ?? "Asia/Shanghai";

function shortTime(at: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hourCycle: "h23", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(at));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

export function renderInput(seg: Segment): string {
  return [
    seg.prompt?.trim() ?? "",
    "",
    `upTo: ${seg.upTo}`,
    "",
    "<segment>",
    ...seg.lines.map((l) => `[${l.archiveNo}] ${shortTime(l.at)} ${l.text}`),
    "</segment>",
    "",
    "（这次没有 hotwrite 工具：把你本来会传给它的参数，作为一个 JSON 对象 `{\"upTo\": …, \"entries\": […]}` 输出，不要输出别的。）",
  ].join("\n");
}

if (import.meta.main) {
  const arg = process.argv[2];
  if (arg === "--self") console.log(filePrompt());
  else if (arg) console.log(renderInput(JSON.parse(readFileSync(arg, "utf8")) as Segment));
  else {
    console.error("用法：bun evals/hot-write/input.ts <segment.json> | --self");
    process.exit(2);
  }
}
