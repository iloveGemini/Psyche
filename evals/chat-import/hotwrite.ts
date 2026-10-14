/**
 * 给导进来的会话无头补写情节（catalog §二"没写成 → 事后同一模型带 transcript 无头补写"）。花额度，手动跑。
 *
 *   bun evals/chat-import/hotwrite.ts --session chat-34575654 --model claude-opus-5-5 [--gap-hours 3] [--db …]
 *
 * 一个会话跨好几天，一段写不下：按间隔切成几段，依次交（游标往前走）。被闸拒了就停，把原因打出来。
 * 跑法同热写考卷：空目录、不读用户设置、不给工具，只看清单。
 */
import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "../../src/store/events.ts";
import { Projections } from "../../src/store/projections.ts";
import { experienceProjector } from "../../src/archive/experience.ts";
import { shelfProjector } from "../../src/reading/shelf.ts";
import { segmentEvents, segmentLines, writeEpisodes } from "../../src/catalog/hotwrite.ts";
import { readPrompt } from "../../src/core/prompts.ts";
import { renderInput } from "../hot-write/input.ts";
import { parseSubmission } from "../hot-write/check.ts";

const args = process.argv.slice(2);
const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const session = opt("--session");
const model = opt("--model");
if (!session || !model) throw new Error("要 --session 和 --model");
const gap = Number(opt("--gap-hours") ?? 3) * 3_600_000;
const db = opt("--db") ?? join(homedir(), ".psyche/test/psyche.db");

const store = new EventStore(db);
const projections = new Projections(store);
projections.register(experienceProjector);
projections.register(shelfProjector);
projections.live();
const prompt = readPrompt("hot-write.md");
const self = readPrompt("self-v0.md").text;

const events = segmentEvents(store, session);
const chunks: (typeof events)[] = [];
for (const ev of events) {
  const cur = chunks.at(-1);
  if (cur && ev.at - cur.at(-1)!.at < gap) cur.push(ev);
  else chunks.push([ev]);
}
console.log(`${session}：剩 ${events.length} 条，切成 ${chunks.length} 段`);

for (const [i, chunk] of chunks.entries()) {
  const upTo = chunk.at(-1)!.id;
  const lines = segmentLines(store, chunk);
  const input = renderInput({ session, upTo, prompt: prompt.text, promptVersion: prompt.version, lines } as never);
  const proc = Bun.spawn(
    ["claude", "-p", "--model", model, "--append-system-prompt", self, "--tools", "", "--strict-mcp-config", "--setting-sources", "project", "--no-session-persistence"],
    { cwd: mkdtempSync(join(tmpdir(), "psyche-hw-")), stdin: new TextEncoder().encode(input), stdout: "pipe", stderr: "inherit" },
  );
  const raw = await new Response(proc.stdout).text();
  let sub: { entries?: unknown[] };
  try {
    sub = parseSubmission(raw) as { entries?: unknown[] };
  } catch {
    console.error(`第 ${i + 1} 段交上来的不是 JSON：\n${raw.slice(0, 1500)}`);
    break;
  }
  try {
    const { episodes } = writeEpisodes(store, { session, upTo, entries: sub?.entries }, prompt.version);
    console.log(`第 ${i + 1} 段（${lines.length} 行）：${episodes.length} 条 ${episodes.map((e) => e.archiveNo).join("、")}`);
  } catch (e) {
    console.error(`第 ${i + 1} 段被拒：${e instanceof Error ? e.message : e}\n${raw.slice(0, 500)}`);
    break;
  }
}
projections.stop();
store.close();
