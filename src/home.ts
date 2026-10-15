/**
 * 家（notes/plan/m5.md §三）：Psyche 自带的地方。调度器叫醒它时，在这里起一个无头会话。
 *
 * 和 sleep.ts 同样隔离：空目录里跑（不读项目 CLAUDE.md、git 信息），不读用户设置，只挂 Psyche 的 MCP，内置工具全关。
 * 家本身是一个 harness（situation.harness = "home"）：边跑边把对话、工具调用按 Soma 的格式报成事件。
 * 第一条消息只放事实（<now>，醒来原因已在里面），不用它的口吻；整理 / 补写附上该用的工具名。
 *
 * 只经 REST 和 Psyche 说话（PSYCHE_URL / PSYCHE_TOKEN），手动也能跑：
 *   bun run src/home.ts --by manual [--model claude-opus-5-5]
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface WakeReason {
  by: string;
  note?: string;
  /** 补写哪个会话 */
  session?: string;
}

export interface HomeOptions {
  base: string;
  token?: string;
  model: string;
  wake: WakeReason;
  /** 超时（毫秒），缺省 15 分钟 */
  timeoutMs?: number;
}

export interface HomeRun {
  session: string;
  costUsd?: number;
  ms: number;
  error?: string;
}

const PLACE = "这是家：Psyche 自带的地方，只有记忆相关的工具（看记忆、整理、写日记、看自己、排作息），没有别的。";

export async function runHome(opts: HomeOptions): Promise<HomeRun> {
  const t0 = Date.now();
  const base = opts.base.replace(/\/+$/, "");
  const rest = async (method: "GET" | "POST", path: string, body?: unknown): Promise<any> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}：${json?.error ?? ""}`);
    return json;
  };
  const report = (kind: string, payload: Record<string, unknown>, idem: string) => rest("POST", "/v1/events", { kind, source: "home", payload: { ...payload, session }, idem });

  const session = crypto.randomUUID();
  const prompt = await rest("GET", "/v1/prompt");
  await rest("POST", "/v1/situation", { harness: "home", session, model: opts.model, selfPromptVersion: prompt.version, source: "home" });
  await report("woke", { by: opts.wake.by, ...(opts.wake.note ? { note: opts.wake.note } : {}), ...(opts.wake.session ? { for: opts.wake.session } : {}) }, `${session}:woke`);
  // 取 <now> = 把到点的闹钟递进来（写 due）
  const now = (await rest("GET", `/v1/now?session=${encodeURIComponent(session)}`)).text as string;

  let task = "";
  if (opts.wake.by === "tidy") task = "该整理了：用 coldwrite_material 取上次整理之后的经历和书架，整理完用 coldwrite 写回。";
  if (opts.wake.by === "catchup" && opts.wake.session) {
    const seg = await rest("GET", `/v1/hotwrite?session=${encodeURIComponent(opts.wake.session)}`);
    task = `会话 ${opts.wake.session} 还有 ${seg.lines.length} 条没写进记忆（那段已经散了）：用 hotwrite_segment（session: ${opts.wake.session}）取这一段，写完用 hotwrite 交（带上同一个 session）。`;
  }
  const first = [now, task].filter(Boolean).join("\n\n");

  const mcp = {
    mcpServers: {
      psyche: {
        type: "stdio",
        command: "bun",
        args: ["run", join(import.meta.dir, "mcp.ts")],
        env: { PSYCHE_URL: base, ...(opts.token ? { PSYCHE_TOKEN: opts.token } : {}) },
      },
    },
  };
  const cwd = mkdtempSync(join(tmpdir(), "psyche-home-"));
  const proc = Bun.spawn(
    [
      "claude", "-p",
      "--model", opts.model,
      "--append-system-prompt", `${prompt.text}\n\n${PLACE}`,
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
  await report("slept", {}, `${session}:slept`).catch(() => {});
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
  const run = await runHome({
    base: process.env.PSYCHE_URL ?? "http://127.0.0.1:7450",
    token: process.env.PSYCHE_TOKEN,
    model,
    wake: { by: opt("--by") ?? "manual", note: opt("--note"), session: opt("--session") },
  });
  console.log(JSON.stringify(run, null, 2));
}
