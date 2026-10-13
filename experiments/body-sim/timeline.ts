/**
 * 把 Roy 的真实历史抽成一条只有时间、类型、长度的事件线（不带正文），给身体模拟器吃。
 *
 * 来源：ASCM 的 raw_logs（只读）+ Roxy 会话里的 system_wake（谁、什么时候叫醒了他）。
 * 用法：bun run timeline.ts [--db <state.db>] → out/timeline.json
 */
import { Database } from "bun:sqlite";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const HOME = process.env.HOME!;
const args = process.argv.slice(2);
const dbPath = args[args.indexOf("--db") + 1] && args.includes("--db")
  ? args[args.indexOf("--db") + 1]
  : join(HOME, ".agent-continuity-mcp/data/agents/roy/state.db");
const SESSIONS = join(HOME, ".roxy/agent/sessions/life");

export type Ev =
  | { t: number; k: "joy"; n: number } // 她说话（n = 字数）
  | { t: number; k: "roy"; n: number } // 他说话
  | { t: number; k: "call"; n: number } // 他调工具（n = 参数长度）
  | { t: number; k: "ok" | "err"; n: number } // 工具结果（n = 返回长度）
  | { t: number; k: "wake"; trigger: string }; // 系统叫醒他

const db = new Database(dbPath, { readonly: true });
const rows = db
  .query(`select created_at, speaker, kind, tool_status, length(content) n from raw_logs order by created_at`)
  .all() as { created_at: string; speaker: string; kind: string; tool_status: string | null; n: number }[];

// raw_logs.created_at 是本地时间（UTC+8）不带时区
const ms = (s: string) => Date.parse(s.replace(" ", "T") + "+08:00");

const evs: Ev[] = [];
for (const r of rows) {
  const t = ms(r.created_at);
  if (r.speaker === "user" && r.kind === "speech") evs.push({ t, k: "joy", n: r.n });
  else if (r.speaker === "agent" && r.kind === "speech") evs.push({ t, k: "roy", n: r.n });
  else if (r.kind === "tool_call") evs.push({ t, k: "call", n: r.n });
  else if (r.kind === "tool_result" || r.kind === "observation")
    evs.push({ t, k: r.tool_status === "error" ? "err" : "ok", n: Math.min(r.n, 20000) });
}

// 唤醒：同一条会出现在相邻两个会话文件里（会话切换时复制），按 id 去重
const seen = new Set<string>();
for (const f of readdirSync(SESSIONS).filter((f) => f.endsWith(".jsonl"))) {
  for (const line of readFileSync(join(SESSIONS, f), "utf8").split("\n")) {
    if (!line.includes("<system_wake")) continue;
    const r = JSON.parse(line);
    if (r.type !== "message" || r.message?.role !== "user" || seen.has(r.id)) continue;
    seen.add(r.id);
    const text = r.message.content.map((b: any) => b.text ?? "").join("");
    evs.push({ t: Date.parse(r.timestamp), k: "wake", trigger: text.match(/triggers="([^"]*)"/)?.[1] ?? "?" });
  }
}

evs.sort((a, b) => a.t - b.t);
writeFileSync(join(import.meta.dir, "out/timeline.json"), JSON.stringify(evs));
const count = (k: string) => evs.filter((e) => e.k === k).length;
console.log(
  `${evs.length} 条：她 ${count("joy")}、他 ${count("roy")}、调用 ${count("call")}、成 ${count("ok")}、败 ${count("err")}、唤醒 ${count("wake")}`,
);
console.log(`${new Date(evs[0].t).toISOString()} → ${new Date(evs.at(-1)!.t).toISOString()}`);
