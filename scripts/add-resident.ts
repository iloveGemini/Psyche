/**
 * 添加一个住户：Soma 那边的身体 + Psyche 那边的库，然后出生。说明见 notes/howto/add-resident.md。
 *
 *   bun scripts/add-resident.ts --id a3 --model claude-opus-5-5 --data-dir ~/.psyche/test --soma-home ~/.soma-test --soma-url http://127.0.0.1:30152
 *   bun scripts/add-resident.ts --id a4 --model google-vertex/gemini-4-argon …        # 不是 Claude 的：住 pi，写 "provider/模型"
 *
 * 选项：--letter <文件>（缺省 letters/birth.md；--no-letter 不递）、--email（开房子的邮箱）、--past <全宗>=<旧库路径>（登记前世卷宗，出生时告诉它有、认不认由它）、--psyche-url（缺省 http://127.0.0.1:7450）、--dry-run。
 *
 * - 数据目录必须明说（--data-dir），不给缺省：正式库的创建由 Joy 决定（CLAUDE.md 红线）。
 * - Psyche 开着：走 POST /v1/house/residents，热挂进屋（调度器开着就会叫它「出生」那一段）。没开：直接写 agents.json 和库，下次起 Psyche 时住进来。
 * - Soma：写 agents/<id>/identity.json、建 home/。Soma 每次现读住户，不用重启。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { EventStore } from "../src/store/events.ts";
import { birth } from "../src/self/self.ts";
import { readLetter, registerResident } from "../src/house/add.ts";
import { ID_PATTERN } from "../src/house/residents.ts";

const args = process.argv.slice(2);
const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const flag = (k: string) => args.includes(k);
const expand = (p: string) => resolve(p.replace(/^~(?=\/|$)/, homedir()));
const fail = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

const id = opt("--id") ?? fail("要 --id（小写字母、数字、- _；不是名字，名字由它自己取）");
if (!ID_PATTERN.test(id)) fail(`id 不对：${id}`);
const modelArg = opt("--model") ?? fail("要 --model：Claude 写 claude-…；别的写 provider/模型（住 pi）");
const dataDir = opt("--data-dir") ? expand(opt("--data-dir")!) : fail("要 --data-dir：哪个 Psyche 数据目录（测试库 ~/.psyche/test）");
const somaHome = opt("--soma-home") ? expand(opt("--soma-home")!) : fail("要 --soma-home：哪个 Soma（测试 ~/.soma-test）");
const somaUrl = opt("--soma-url") ?? fail("要 --soma-url：这个 Soma 的地址（调度器推醒来用，测试 http://127.0.0.1:30152）");
const psycheUrl = (opt("--psyche-url") ?? "http://127.0.0.1:7450").replace(/\/+$/, "");
const dry = flag("--dry-run");

// 身体：Claude 住 Agent SDK（模型由 Claude Code 的设置定），别的住 pi（要 provider/模型，pi 的 models.json 里得有）
const pi = !modelArg.startsWith("claude");
if (pi && !modelArg.includes("/")) fail(`不是 Claude 的模型住 pi，要写 provider/模型（如 google-vertex/gemini-4-argon），现在是 ${modelArg}`);
const model = pi ? modelArg.slice(modelArg.indexOf("/") + 1) : modelArg;
const agentDir = join(somaHome, "agents", id);
const home = join(agentDir, "home");
if (existsSync(join(agentDir, "identity.json"))) fail(`Soma 里已经住着 ${id}：${agentDir}`);
if (existsSync(join(dataDir, id, "psyche.db"))) fail(`Psyche 里已经有 ${id} 的库：${join(dataDir, id)}`);
const pastArg = opt("--past");
const past = pastArg
  ? [{ fonds: pastArg.split("=")[0], path: expand(pastArg.split("=").slice(1).join("=") || fail("--past 写成 全宗=路径，如 ROY=~/.agent-continuity-mcp/data/agents/roy/state.db")) }]
  : undefined;
const letter = flag("--no-letter") ? "" : readLetter(opt("--letter") ? expand(opt("--letter")!) : undefined);

console.log(
  [
    `住户 ${id}：${pi ? `pi（${modelArg}）` : `Agent SDK（${model}）`}`,
    `  Soma   ${agentDir}`,
    `  Psyche ${join(dataDir, id)}`,
    `  信     ${letter ? `${Array.from(letter).length} 字` : "没有（不递）"}`,
  ].join("\n"),
);
if (dry) process.exit(0);

const up = await fetch(`${psycheUrl}/health`, { signal: AbortSignal.timeout(2_000) }).then((r) => r.ok).catch(() => false);
let token: string;
if (up) {
  // 开着：走屋子的口子（登记 + 热挂 + 出生）。屋子的口子要屋里任何一个人的 token
  const houseToken = process.env.PSYCHE_TOKEN ?? fail("Psyche 开着：要 PSYCHE_TOKEN=<屋里任何一个人的 token> 才能进屋子的口子");
  const res = await fetch(`${psycheUrl}/v1/house/residents`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${houseToken}` },
    body: JSON.stringify({ id, model, soma: somaUrl, home, letter, ...(flag("--email") ? { email: true } : {}), ...(past ? { past } : {}) }),
  });
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) fail(`Psyche 没收：${res.status} ${j.error ?? ""}`);
  token = (JSON.parse(readFileSync(join(dataDir, "agents.json"), "utf8")) as Record<string, { token: string }>)[id].token;
  console.log(`Psyche：已热挂进屋、出生了${letter ? "，信放进了收件箱" : ""}`);
} else {
  const config = registerResident(dataDir, { id, model, soma: somaUrl, home, ...(flag("--email") ? { email: true } : {}), ...(past ? { past } : {}) });
  token = config.token!;
  const store = new EventStore(join(dataDir, id, "psyche.db"), { timeZone: process.env.PSYCHE_TZ });
  try {
    birth(store, { model, letter });
  } finally {
    store.close();
  }
  console.log(`Psyche 没开：已写 agents.json、出生了${letter ? "，信放进了收件箱" : ""}；下次起 Psyche 时住进来`);
}

mkdirSync(home, { recursive: true });
writeFileSync(join(agentDir, "identity.json"), `${JSON.stringify({ body: pi ? "pi" : "claude-sdk", ...(pi ? { model: modelArg } : {}), psycheToken: token }, null, 2)}\n`);
console.log(`Soma：写了 ${join(agentDir, "identity.json")}（不用重启，顶栏切住户就有）`);
console.log("接下来：开着调度器（psyche-test-wake）的话，它会被叫去「出生」那一段；屋里的东西要重启 Psyche 才看得到它的 home。");
