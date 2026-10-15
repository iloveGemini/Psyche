/**
 * 冷写考卷的入睡，换成 Vertex 上的 Gemini（流程同 src/sleep.ts，只把 `claude -p` 换成 evals/vertex.ts）。
 *
 *   PSYCHE_URL=http://127.0.0.1:7451 bun evals/vertex-sleep.ts --model gemini-4-argon --at "2026-10-08 03:00" --log out.json
 *
 * 只给考卷用：正式环境的入睡仍是 src/sleep.ts（它和 Soma 里的它是同一个模型）。
 */
import { writeFileSync } from "node:fs";
import { runVertex } from "./vertex.ts";

const args = process.argv.slice(2);
const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const model = opt("--model");
if (!model) throw new Error("要 --model");
const base = (process.env.PSYCHE_URL ?? "http://127.0.0.1:7450").replace(/\/+$/, "");
const at = opt("--at") ? Date.parse(`${opt("--at")!.replace(" ", "T")}:00+08:00`) : undefined;

async function rest(method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}：${(json as any)?.error ?? ""}`);
  return json;
}

const beforeDone = (await rest("GET", "/v1/events?kinds=coldwrite.done&limit=1000")).events.length;
await rest("POST", "/v1/events", { kind: "slept", source: "sleep", payload: {}, ...(at ? { at } : {}) });
const material = await rest("GET", "/v1/coldwrite");
if (material.upTo === null) {
  console.log("上次整理之后没有新的经历，不用整理。");
} else {
  const r = await runVertex({
    model,
    system: (await rest("GET", "/v1/prompt")).text,
    input: "你睡了。用 coldwrite_material 取上次整理之后的经历和书架，整理完用 coldwrite 写回。",
    psycheUrl: base,
    tools: ["coldwrite_material", "coldwrite", "shelf", "recall", "detail"],
  });
  if (opt("--log")) writeFileSync(opt("--log")!, JSON.stringify({ calls: r.calls, cost: r.cost, reply: r.reply, log: r.log }, null, 1));
  console.log(r.calls.map((c) => `调了：${c.slice(0, 160)}`).join("\n"));
  console.log(r.reply || "（没有给出结果）");
  console.log(`花了 $${r.cost.toFixed(2)}`);
}
await rest("POST", "/v1/events", { kind: "woke", source: "sleep", payload: { by: "manual" }, ...(at ? { at: at + 60_000 } : {}) });
const afterDone = (await rest("GET", "/v1/events?kinds=coldwrite.done&limit=1000")).events.length;
console.log(afterDone > beforeDone ? "交了：游标前移。" : "这次没交：游标不动。");
