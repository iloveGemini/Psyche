/**
 * 手动入睡（m2.md §六）：写 slept → 起同一模型的无头会话，让它自己取材料、写回书架 → 写 woke。
 *
 *   bun run src/sleep.ts --model claude-opus-5-5 [--at "2026-10-08 03:00"] [--log out.jsonl]
 *
 * 连一个已经在跑的 Psyche（PSYCHE_URL，缺省 http://127.0.0.1:7450；PSYCHE_AGENT、PSYCHE_TOKEN）。花额度，手动跑。
 * 无头会话：空目录里跑（不读项目 CLAUDE.md、git 信息），不读 Joy 的用户设置（全局 hook 里有别的记忆注入），
 * 只挂 Psyche 的 MCP，内置工具全关。它没交 = 这次没写，游标不动，下次材料更多；系统不替它补。
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_HEADER } from "./server/house.ts";

const args = process.argv.slice(2);
const opt = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const model = opt("--model");
if (!model) throw new Error("要 --model：和 Soma 里的它同一个模型（模型是它本人）");
const base = (process.env.PSYCHE_URL ?? "http://127.0.0.1:7450").replace(/\/+$/, "");
const token = process.env.PSYCHE_TOKEN;
const agent = process.env.PSYCHE_AGENT;
/** 入睡时刻（考卷用剧本里的时间）；缺省此刻 */
const at = opt("--at") ? Date.parse(`${opt("--at")!.replace(" ", "T")}:00+08:00`) : undefined;

async function rest(method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(agent ? { [AGENT_HEADER]: agent } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}：${json?.error ?? ""}`);
  return json;
}

const beforeDone = (await rest("GET", "/v1/events?kinds=coldwrite.done&limit=1000")).events.length;
await rest("POST", "/v1/events", { kind: "slept", source: "sleep", payload: {}, ...(at ? { at } : {}) });
const material = await rest("GET", "/v1/coldwrite");
if (material.upTo === null) {
  console.log("上次整理之后没有新的经历，不用整理。");
} else {
  const self = (await rest("GET", "/v1/prompt")).text as string;
  const mcp = {
    mcpServers: {
      psyche: {
        type: "stdio",
        command: "bun",
        args: ["run", join(import.meta.dir, "mcp.ts")],
        env: { PSYCHE_URL: base, ...(agent ? { PSYCHE_AGENT: agent } : {}), ...(token ? { PSYCHE_TOKEN: token } : {}) },
      },
    },
  };
  const tools = ["coldwrite_material", "coldwrite", "shelf", "recall", "detail"].map((t) => `mcp__psyche__${t}`);
  const cwd = mkdtempSync(join(tmpdir(), "psyche-sleep-"));
  const proc = Bun.spawn(
    [
      "claude", "-p",
      "--model", model,
      "--append-system-prompt", self,
      "--mcp-config", JSON.stringify(mcp), "--strict-mcp-config",
      "--tools", "", "--allowedTools", tools.join(" "),
      "--setting-sources", "project", "--no-session-persistence",
      "--output-format", "stream-json", "--verbose",
    ],
    { cwd, stdin: new TextEncoder().encode("你睡了。用 coldwrite_material 取上次整理之后的经历和书架，整理完用 coldwrite 写回。"), stdout: "pipe", stderr: "inherit" },
  );
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  if (opt("--log")) writeFileSync(opt("--log")!, out);
  const result = out.trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((m) => m?.type === "result");
  console.log(result?.result ?? "（无头会话没有给出结果）");
}
await rest("POST", "/v1/events", { kind: "woke", source: "sleep", payload: { by: "manual" }, ...(at ? { at: at + 60_000 } : {}) });
const afterDone = (await rest("GET", "/v1/events?kinds=coldwrite.done&limit=1000")).events.length;
console.log(afterDone > beforeDone ? "交了：游标前移。" : "这次没交：游标不动。");
