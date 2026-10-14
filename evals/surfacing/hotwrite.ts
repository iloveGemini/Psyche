/**
 * 给浮现考卷的底库补情节：每个剧本会话让它本人（同一模型）无头补写一遍，存成 episodes.json，build.ts 原样重放。
 * 花额度，手动跑一次就行（剧本不改就不用重跑）。
 *
 *   bun evals/surfacing/build.ts --no-episodes && bun evals/surfacing/hotwrite.ts --model claude-opus-5-5
 *
 * 跑法同热写考卷（evals/hot-write/README.md）：空目录、不读用户设置、不给工具，只看清单。
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readSegment } from "../../src/catalog/hotwrite.ts";
import { readPrompt } from "../../src/core/prompts.ts";
import { renderInput } from "../hot-write/input.ts";
import { parseSubmission } from "../hot-write/check.ts";
import { EPISODE_SESSIONS, openStore } from "./build.ts";

const HERE = dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const model = args[args.indexOf("--model") + 1];
if (!args.includes("--model") || !model) throw new Error("要 --model：和 Soma 里的它同一个模型");

const { store } = openStore(join(HERE, "out", "base.db"));
const prompt = readPrompt("hot-write.md");
const self = readPrompt("self-v0.md").text;
const out: Record<string, unknown[]> = {};
await Promise.all(
  EPISODE_SESSIONS.map(async (session) => {
    const seg = readSegment(store, session);
    if (!seg.upTo) throw new Error(`${session} 没有可写的段（底库里已经有情节了？用 --no-episodes 重建）`);
    const input = renderInput({ ...seg, prompt: prompt.text, promptVersion: prompt.version } as never);
    const proc = Bun.spawn(
      ["claude", "-p", "--model", model, "--append-system-prompt", self, "--tools", "", "--strict-mcp-config", "--setting-sources", "project", "--no-session-persistence"],
      { cwd: mkdtempSync(join(tmpdir(), "psyche-hw-")), stdin: new TextEncoder().encode(input), stdout: "pipe", stderr: "inherit" },
    );
    const raw = await new Response(proc.stdout).text();
    const sub = parseSubmission(raw) as { entries?: unknown[] };
    if (!Array.isArray(sub?.entries)) throw new Error(`${session} 的输出不是 {entries}：${raw.slice(0, 300)}`);
    out[session] = sub.entries;
    console.log(`${session}：${sub.entries.length} 条`);
  }),
);
writeFileSync(
  join(HERE, "episodes.json"),
  JSON.stringify({ note: `浮现考卷底库的情节：${model} 按热写提示词 v${prompt.version} 无头补写（它本人写的，原样重放）`, sessions: Object.fromEntries(EPISODE_SESSIONS.map((s) => [s, out[s]])) }, null, 1),
);
store.close();
