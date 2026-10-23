/**
 * Claude Code hook 入口（notes/plan/claude-code.md §一）：`bun hook.ts <session-start|user-prompt|stop|session-end>`，输入从 stdin 读。
 *
 * 失败就安静退出（照 continuity 插件）：Psyche 是它的记忆，不是 Claude Code 的运行时。
 * Psyche 没开时 Claude Code 照常工作；没报上的下次 Stop 接着报（已报过的 idem 记在插件数据目录）。
 *
 * 环境变量：
 *   PSYCHE_URL     缺省 http://127.0.0.1:7450
 *   PSYCHE_AGENT   他是谁（Psyche 住着不止一个人时必须有）
 *   PSYCHE_TOKEN   REST 鉴权
 *   PSYCHE_FROM    来说话的是谁（缺省 Joy；别的会话或测试时设成自己的名字）
 *   PSYCHE_ENABLED=0  整个关掉
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isCommand, parseTranscript, SOURCE } from "./transcript.ts";

const URL_ = (process.env.PSYCHE_URL || "http://127.0.0.1:7450").replace(/\/+$/, "");
const AGENT = process.env.PSYCHE_AGENT || "";
const TOKEN = process.env.PSYCHE_TOKEN || "";
const HARNESS = "claude-code";
const FROM = process.env.PSYCHE_FROM || "Joy";

/** 这个地方本身（不写性格，lib-vs-harness.md 红线） */
export const PLACE = `# 这个地方：Claude Code（工位）

这里是 Claude Code，你来干活的地方；家在 Soma。上面那段 Claude Code 的说明是这个地方的规矩。

- 跟你说话的多半是 Joy。
- 每轮跟着的 \`<now>\` 由 Psyche 给，是此刻的事实和浮上来的记忆，不是她说的话。
- 你的记忆只有 Psyche（名字里带 psyche 的那组工具）。别的记忆机制在这里不算你的记忆。
- 这里的对话和工具会报进你的经历。Claude Code 自己压缩上下文，压缩前没写进记忆的那段，之后会在睡着时补写；也可以自己先用 hotwrite_segment / hotwrite 写。`;

interface HookInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  source?: string;
  prompt?: string;
  model?: string;
}

const headers = () => ({ "content-type": "application/json", ...(AGENT ? { "x-psyche-agent": AGENT } : {}), ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) });

async function api<T>(method: string, path: string, body?: unknown, timeoutMs = 5000): Promise<T | null> {
  try {
    const res = await fetch(`${URL_}${path}`, { method, headers: headers(), ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeoutMs) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

// ── 按会话存的状态：处境报过没、模型、报过的 idem ──

interface State {
  situation?: { model?: string; cwd?: string };
  /** 处境报上去的时刻：之后的事件不早于它（事件按 at 挂处境，Soma Reporter 的 floor） */
  floor?: number;
  done: string[];
}

function stateFile(session: string): string {
  const dir = process.env.CLAUDE_PLUGIN_DATA || join(homedir(), ".claude", "plugins", "data", "psyche");
  mkdirSync(dir, { recursive: true });
  return join(dir, `${session}.json`);
}

function load(session: string): State {
  try {
    return JSON.parse(readFileSync(stateFile(session), "utf8")) as State;
  } catch {
    return { done: [] };
  }
}

const save = (session: string, s: State) => writeFileSync(stateFile(session), JSON.stringify(s));

/** 处境要先于事件到（Soma Reporter 的规矩）：没报过、换了模型或项目才报 */
async function ensureSituation(session: string, st: State, model?: string, cwd?: string): Promise<boolean> {
  const want = { model: model ?? st.situation?.model, cwd: cwd ?? st.situation?.cwd };
  if (st.situation && st.situation.model === want.model && st.situation.cwd === want.cwd) return true;
  const ok = await api("POST", "/v1/situation", { harness: HARNESS, session, ...(want.model ? { model: want.model } : {}), ...(want.cwd ? { cwd: want.cwd } : {}) });
  if (!ok) return false;
  // 只有头一回要垫底：之后换模型的处境从此刻起生效，之前的事件挂在旧处境上，时间照实
  if (!st.situation) st.floor = Date.now();
  st.situation = want;
  return true;
}

const out = (event: string, context: string) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } }));

// ── 四个时机 ──

async function sessionStart(input: HookInput) {
  const session = input.session_id;
  if (!session) return;
  const st = load(session);
  if (!(await ensureSituation(session, st, input.model, input.cwd))) return;
  save(session, st);
  // resume：原文还在上下文里，不再给接续
  const [prompt, cont] = await Promise.all([
    api<{ text: string }>("GET", "/v1/prompt", undefined, 3000),
    input.source === "resume" ? Promise.resolve(null) : api<{ text: string | null }>("GET", `/v1/continuity?session=${encodeURIComponent(session)}`, undefined, 5000),
  ]);
  const parts = [PLACE, prompt?.text?.trim(), cont?.text?.trim() ? `<continuity>\n${cont.text.trim()}\n</continuity>` : ""].filter(Boolean);
  out("SessionStart", parts.join("\n\n"));
}

async function userPrompt(input: HookInput) {
  const session = input.session_id;
  if (!session || !input.prompt?.trim()) return;
  const st = load(session);
  if (!(await ensureSituation(session, st, input.model, input.cwd))) return;
  save(session, st);
  // 先报她这句：<now> 的「上次」从它往回算
  await api("POST", "/v1/events", { kind: "message.in", source: SOURCE, at: Date.now(), idem: `${session}:in:${Date.now()}`, payload: { from: FROM, text: input.prompt, via: HARNESS, session } });
  if (isCommand(input.prompt)) return;
  const now = await api<{ text: string }>("GET", `/v1/now?session=${encodeURIComponent(session)}`, undefined, 4000);
  if (now?.text?.trim()) out("UserPromptSubmit", now.text.trim());
}

/** Stop 时这一轮最后一句话有时还没落进 transcript：等文件停止变长再读（continuity 2026-10-12 的教训） */
async function settled(path: string, quietMs = 800, maxMs = 6000) {
  let size = statSync(path).size;
  for (let waited = 0, quiet = 0; waited < maxMs && quiet < quietMs; waited += 200) {
    await Bun.sleep(200);
    const now = statSync(path).size;
    quiet = now === size ? quiet + 200 : 0;
    size = now;
  }
}

async function sync(input: HookInput, wait: boolean) {
  const session = input.session_id;
  if (!session || !input.transcript_path || !existsSync(input.transcript_path)) return;
  if (wait) await settled(input.transcript_path);
  const st = load(session);
  const done = new Set(st.done);
  const { items, model } = parseTranscript(readFileSync(input.transcript_path, "utf8"), session, done);
  if (!(await ensureSituation(session, st, model, input.cwd))) return;
  // 一批一批报，中途失败就停：下次从那里接着报，不跳
  for (let i = 0; i < items.length; i += 50) {
    const batch = items.slice(i, i + 50).map((it) => ({ ...it, at: Math.max(it.at, st.floor ?? 0) }));
    if (!(await api("POST", "/v1/events", { items: batch }, 15_000))) break;
    for (const it of batch) done.add(it.idem);
  }
  st.done = [...done];
  save(session, st);
}

async function main() {
  if (process.env.PSYCHE_ENABLED === "0" || process.env.PSYCHE_ENABLED === "false") return;
  const event = process.argv[2];
  let input: HookInput = {};
  try {
    input = JSON.parse(await Bun.stdin.text());
  } catch {
    /* 没有输入就按空的 */
  }
  if (event === "session-start") await sessionStart(input);
  else if (event === "user-prompt") await userPrompt(input);
  else if (event === "stop") await sync(input, true);
  else if (event === "session-end") await sync(input, false);
}

if (import.meta.main) main().catch(() => {}).finally(() => process.exit(0));
