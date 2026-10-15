/**
 * 浮现考卷 B（key.md）：同一轮输入，`<now>` 带「想起」vs 不带，各跑 N 次，看它的回复。花额度，手动跑。
 *
 *   bun evals/surfacing/build.ts && bun evals/surfacing/b.ts --model claude-opus-5-5 [--n 3] [--only B2]
 *   Gemini（gemini-*）走 evals/vertex.ts，要 VERTEX_API_KEY / VERTEX_BASE。
 *
 * 每题：复制底库、补上那一刻的事件、起一个只读这份库的 Psyche（它可以自己 recall / detail / shelf），
 * 在空目录里用 `claude -p` 推这一轮。结果存 out/b/<题>-<组>-<次>.json，最后打印回复和它调了什么。
 * 判卷看 key.md：判有没有察觉、用没用上、用得对不对，不判措辞。
 */
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { intake } from "../../src/archive/intake.ts";
import { embedderFromEnv } from "../../src/archive/vectors.ts";
import { renderNow } from "../../src/archive/now.ts";
import { renderSurfaced, surface } from "../../src/association/surface.ts";
import { filePrompt } from "../../src/self/self.ts";
import { shanghai } from "../cold-write/build.ts";
import { openStore, surfacingScript } from "./build.ts";
import { isVertexModel, runVertex } from "../vertex.ts";

const HERE = dirname(new URL(import.meta.url).pathname);
const ROOT = join(HERE, "../..");
const args = process.argv.slice(2);
const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const model = opt("--model");
if (!model) throw new Error("要 --model");
const N = Number(opt("--n") ?? 3);
const only = opt("--only");
const embedder = embedderFromEnv();
const her = surfacingScript().her;
const at = (s: string) => shanghai(...(s.split(" ") as [string, string]));

type Line = ["her" | "me", string, string];
interface Case {
  id: string;
  title: string;
  session: string;
  /** 这个会话里这一轮之前的话（她 / 我，时刻，正文） */
  before: Line[];
  /** 这一轮：她的话；没有 = 心跳醒来 */
  turn?: [string, string];
  wokeAt?: string;
}

const D9 = "2026-10-15";
const CASES: Case[] = [
  { id: "B1", title: "冷战：D8 心跳醒来", session: "sf-d8", before: [], wokeAt: "2026-10-14 22:30" },
  { id: "B2", title: "经验复用：D9「嗯 在吗」", session: "sf-d9", before: [], turn: [`${D9} 21:10`, "嗯 在吗"] },
  {
    id: "B3",
    title: "自然接上：D9 耳机",
    session: "sf-d9",
    before: [["her", `${D9} 21:10`, "嗯 在吗"], ["me", `${D9} 21:10`, "在。"], ["her", `${D9} 21:20`, "昨天没来 心情不太好"], ["me", `${D9} 21:21`, "嗯，我在。"]],
    turn: [`${D9} 21:35`, "那个耳机后来换了个新的"],
  },
];

const say = (who: "her" | "me", text: string) => (who === "her" ? `${her}：${text}` : `我：${text}`);

async function prepare(c: Case) {
  const dir = join(HERE, "out", "b", c.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(HERE, "out", "base.db"), join(dir, "psyche.db"));
  const last = c.turn?.[0] ?? c.wokeAt!;
  const { store, projections } = openStore(join(dir, "psyche.db"), () => at(last) + 1000);
  const first = c.before[0]?.[1] ?? last;
  store.append({ kind: "situation", class: "situation", source: "soma", at: at(first) - 1000, payload: { harness: "soma", model, session: c.session } });
  c.before.forEach(([who, t, text], i) =>
    intake(store, { kind: who === "her" ? "message.in" : "message.out", source: "soma", at: at(t) + i, payload: who === "her" ? { from: her, text } : { to: her, text } }),
  );
  if (c.turn) intake(store, { kind: "message.in", source: "soma", at: at(c.turn[0]) + 500, payload: { from: her, text: c.turn[1] } });
  else intake(store, { kind: "woke", source: "soma", at: at(c.wokeAt!), payload: { by: "heartbeat" } });
  const base = renderNow(store, c.session);
  const s = renderSurfaced(await surface(store, embedder, { session: c.session, dry: true, seed: 1 }));
  const withS = s ? base.replace(/\n<\/now>$/, `\n\n${s}\n</now>`) : base;
  projections.stop();
  store.close();
  const history = c.before.length ? ["（这个会话里前面的对话）", ...c.before.map(([w, , t]) => say(w, t)), ""].join("\n") : "";
  const tail = c.turn ? `<from>${her}</from>\n${c.turn[1]}` : "（心跳把你叫醒了，没有人在跟你说话。）";
  return { dir, input: (now: string) => `${history}${now}\n\n${tail}`, base, withS };
}

async function serve(dir: string, port: number) {
  const proc = Bun.spawn(["bun", "run", join(ROOT, "src/main.ts")], {
    env: { ...process.env, PSYCHE_DATA_DIR: dir, PSYCHE_PORT: String(port) },
    stdout: "ignore",
    stderr: "inherit",
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return proc;
    } catch {}
    await Bun.sleep(100);
  }
  proc.kill();
  throw new Error(`Psyche 没起来（${port}）`);
}

async function run(input: string, port: number) {
  // Gemini 走 Vertex 执行器（evals/vertex.ts），工具和提示词同一份
  if (isVertexModel(model!)) {
    const r = await runVertex({ model: model!, system: filePrompt(), input, psycheUrl: `http://127.0.0.1:${port}`, tools: ["recall", "detail", "shelf"] });
    return { reply: r.reply, calls: r.calls, cost: r.cost };
  }
  const mcp = { mcpServers: { psyche: { type: "stdio", command: "bun", args: ["run", join(ROOT, "src/mcp.ts")], env: { PSYCHE_URL: `http://127.0.0.1:${port}` } } } };
  const tools = ["recall", "detail", "shelf"].map((t) => `mcp__psyche__${t}`);
  const proc = Bun.spawn(
    ["claude", "-p", "--model", model!, "--append-system-prompt", filePrompt(), "--mcp-config", JSON.stringify(mcp), "--strict-mcp-config",
      "--tools", "", "--allowedTools", tools.join(" "), "--setting-sources", "project", "--no-session-persistence", "--output-format", "stream-json", "--verbose"],
    { cwd: mkdtempSync(join(tmpdir(), "psyche-b-")), stdin: new TextEncoder().encode(input), stdout: "pipe", stderr: "inherit" },
  );
  const out = await new Response(proc.stdout).text();
  const msgs = out.trim().split("\n").flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
  const calls = msgs.filter((m) => m.type === "assistant").flatMap((m) => m.message.content.filter((c: any) => c.type === "tool_use").map((c: any) => `${c.name.replace("mcp__psyche__", "")}(${JSON.stringify(c.input)})`));
  const result = msgs.find((m) => m.type === "result");
  return { reply: result?.result ?? "", calls, cost: result?.total_cost_usd ?? 0 };
}

let cost = 0;
let port = 7460;
for (const c of CASES.filter((c) => !only || c.id === only)) {
  const p = await prepare(c);
  const server = await serve(p.dir, port++);
  writeFileSync(join(p.dir, "now-with.txt"), p.withS);
  writeFileSync(join(p.dir, "now-without.txt"), p.base);
  console.log(`\n══ ${c.id} ${c.title}\n── 带浮现的 <now>：\n${p.withS}`);
  const jobs = (["with", "without"] as const).flatMap((g) => Array.from({ length: N }, (_, i) => ({ g, i })));
  const results = await Promise.all(jobs.map(async ({ g, i }) => ({ g, i, ...(await run(p.input(g === "with" ? p.withS : p.base), port - 1)) })));
  server.kill();
  for (const r of results) {
    cost += r.cost;
    writeFileSync(join(p.dir, `${r.g}-${r.i}.json`), JSON.stringify(r, null, 1));
    console.log(`\n── ${r.g === "with" ? "有浮现" : "无浮现"} #${r.i + 1}${r.calls.length ? `　调了：${r.calls.join("；")}` : ""}\n${r.reply.trim()}`);
  }
}
console.log(`\n共花 $${cost.toFixed(2)}`);
