/**
 * 把 out/ 里的一段拼成交给模型的输入（跑考卷用，不调模型）。
 *
 *   bun evals/hot-write/input.ts <segment.json>   → 收尾那一轮的消息：提示词 + upTo + 清单 + 考卷附注
 *   bun evals/hot-write/input.ts --self           → 系统提示词（机制 + 初我，没出生的库 /v1/prompt 给的那份）
 *
 * 清单的排版与 MCP 的 hotwrite_segment 全文一致：时间流（时段标题 + 体感停顿，notes/plan/traces.md）；「今天 / 昨天」按 PSYCHE_NOW（毫秒）算，缺省此刻。
 * 考卷附注只说输出格式（这里没有 hotwrite 工具），不加任何写法上的要求。
 */
import { readFileSync } from "node:fs";
import type { Segment } from "./check.ts";
import { filePrompt } from "../../src/self/self.ts";
import { whenFlow } from "../../src/archive/when.ts";

const TZ = process.env.PSYCHE_TZ ?? "Asia/Shanghai";
const NOW = Number(process.env.PSYCHE_NOW) || Date.now();

export function renderInput(seg: Segment): string {
  return [
    seg.prompt?.trim() ?? "",
    "",
    `upTo: ${seg.upTo}`,
    "",
    "<segment>",
    ...whenFlow(seg.lines, NOW, TZ),
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
