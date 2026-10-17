/**
 * 睡着时的整理（10-16 收束，notes/design/lib-vs-harness.md「家 = Soma」）：补写、整理、梗概。
 * 不进它那条连续的会话——材料大，也不是它醒着经历的事。
 *
 * 10-17 起（m5.md §三）：调度器把这段推给 Soma，用它醒着的同一个身体跑；Psyche 只出内容、记处境
 * （`/v1/asleep/start` 拿系统提示词和第一条，`/v1/asleep/end` 记睡下）。这里的 runAsleep 只是手动工具：
 * 没 Soma 时调试用，走同样两个口子，无头 `claude -p`，只能跑 Claude。
 *
 * 隔离同 sleep.ts：空目录里跑（不读项目 CLAUDE.md、git 信息），不读用户设置，只挂 Psyche 的 MCP，内置工具全关，
 * 系统提示词整段换掉（不留 Claude Code 自己那段）。situation.harness = "sleep"：不算地方、不算醒着、不补写。
 * 第一条消息只放事实（<now>）和该用的工具名，不用它的口吻。
 *
 *   bun run src/asleep.ts --by tidy [--model claude-opus-5-5]
 *   bun run src/asleep.ts --by catchup --session <会话>
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_HEADER } from "./server/house.ts";

export interface WakeReason {
  by: string;
  note?: string;
  /** 补写哪个会话 */
  session?: string;
}

export interface AsleepOptions {
  base: string;
  /** 谁（多租户时必须说，server/house.ts） */
  agent?: string;
  token?: string;
  model: string;
  wake: WakeReason;
  /** 超时（毫秒），缺省 15 分钟 */
  timeoutMs?: number;
}

export interface AsleepRun {
  session: string;
  costUsd?: number;
  ms: number;
  error?: string;
}

/** 睡着那段的地方说明（拼在机制 + 自述之后） */
export const ASLEEP_PLACE = "这是睡着的时候：Psyche 起的一段整理，不在你平时那条会话里，只有记忆相关的工具。整理完就接着睡。";

/** 这次的活：只说事实和该用的工具名。`lines` = 补写那段还剩几条 */
export function asleepTask(wake: WakeReason, lines?: number): string {
  if (wake.by === "gist") return "该写梗概了：用 gist_material 看哪些天 / 周 / 月过完了还没写，一段一段用 gist 交。";
  if (wake.by === "tidy") return "该整理了：用 coldwrite_material 取上次整理之后的经历和书架，整理完用 coldwrite 写回。";
  if (wake.by === "catchup" && wake.session)
    return `会话 ${wake.session} 还有 ${lines ?? 0} 条没写进记忆（那段已经散了）：用 hotwrite_segment（session: ${wake.session}）取这一段，写完用 hotwrite 交（带上同一个 session）。`;
  return "";
}

export async function runAsleep(opts: AsleepOptions): Promise<AsleepRun> {
  const t0 = Date.now();
  const base = opts.base.replace(/\/+$/, "");
  const rest = async (method: "GET" | "POST", path: string, body?: unknown): Promise<any> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.agent ? { [AGENT_HEADER]: opts.agent } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}：${json?.error ?? ""}`);
    return json;
  };
  const { session, system, first } = (await rest("POST", "/v1/asleep/start", { ...opts.wake, model: opts.model })) as { session: string; system: string; first: string };
  const report = (kind: string, payload: Record<string, unknown>, idem: string) => rest("POST", "/v1/events", { kind, source: "sleep", payload: { ...payload, session }, idem });

  const mcp = {
    mcpServers: {
      psyche: {
        type: "stdio",
        command: "bun",
        args: ["run", join(import.meta.dir, "mcp.ts")],
        env: { PSYCHE_URL: base, ...(opts.agent ? { PSYCHE_AGENT: opts.agent } : {}), ...(opts.token ? { PSYCHE_TOKEN: opts.token } : {}) },
      },
    },
  };
  const cwd = mkdtempSync(join(tmpdir(), "psyche-asleep-"));
  const proc = Bun.spawn(
    [
      "claude", "-p",
      "--model", opts.model,
      "--system-prompt", system,
      "--mcp-config", JSON.stringify(mcp), "--strict-mcp-config",
      "--tools", "", "--allowedTools", "mcp__psyche",
      "--setting-sources", "project", "--no-session-persistence",
      "--output-format", "stream-json", "--verbose",
    ],
    { cwd, stdin: new TextEncoder().encode(first), stdout: "pipe", stderr: "pipe" },
  );
  const timer = setTimeout(() => proc.kill(), opts.timeoutMs ?? 15 * 60_000);

  const names = new Map<string, string>();
  let costUsd: number | undefined;
  let error: string | undefined;
  let buf = "";
  const decoder = new TextDecoder();
  const handle = async (line: string) => {
    let m: any;
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if (m.type === "assistant") {
      const blocks = Array.isArray(m.message?.content) ? m.message.content : [];
      for (const [i, b] of blocks.entries()) {
        if (b.type === "text" && b.text?.trim()) await report("message.out", { text: b.text }, `${m.message.id ?? m.uuid}:${i}`);
        if (b.type === "tool_use") {
          names.set(b.id, b.name);
          await report("tool.call", { name: b.name, callId: b.id, args: b.input ?? {} }, b.id);
        }
      }
    } else if (m.type === "user") {
      const blocks = Array.isArray(m.message?.content) ? m.message.content : [];
      for (const b of blocks) {
        if (b.type !== "tool_result") continue;
        const text = typeof b.content === "string" ? b.content : Array.isArray(b.content) ? b.content.map((c: any) => c.text ?? "").join("\n") : "";
        await report("tool.result", { callId: b.tool_use_id, name: names.get(b.tool_use_id) ?? "", ok: !b.is_error, text }, `${b.tool_use_id}:result`);
      }
    } else if (m.type === "result") {
      costUsd = m.total_cost_usd;
      if (m.is_error) error = String(m.result ?? m.subtype ?? "出错");
    }
  };
  for await (const chunk of proc.stdout) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) await handle(line).catch((e) => (error = String(e)));
    }
  }
  if (buf.trim()) await handle(buf.trim()).catch((e) => (error = String(e)));
  const code = await proc.exited;
  clearTimeout(timer);
  if (code !== 0 && !error) error = `claude 退出码 ${code}：${(await new Response(proc.stderr).text()).slice(0, 500)}`;
  await rest("POST", "/v1/asleep/end", { session }).catch(() => {});
  return { session, costUsd, ms: Date.now() - t0, ...(error ? { error } : {}) };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt = (k: string) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const model = opt("--model") ?? process.env.PSYCHE_MODEL;
  if (!model) throw new Error("要 --model 或 PSYCHE_MODEL：这个 Agent 的模型");
  const run = await runAsleep({
    base: process.env.PSYCHE_URL ?? "http://127.0.0.1:7450",
    agent: process.env.PSYCHE_AGENT,
    token: process.env.PSYCHE_TOKEN,
    model,
    wake: { by: opt("--by") ?? "tidy", note: opt("--note"), session: opt("--session") },
  });
  console.log(JSON.stringify(run, null, 2));
}
