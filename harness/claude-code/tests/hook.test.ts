/**
 * Claude Code 插件（notes/plan/claude-code.md）：transcript 映射 + 四个 hook 对着一个真的 Psyche（内存库）跑。
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "../../../src/store/events.ts";
import { Projections } from "../../../src/store/projections.ts";
import { experienceProjector } from "../../../src/archive/experience.ts";
import { createApp } from "../../../src/server/app.ts";
import { parseTranscript, isCommand } from "../src/transcript.ts";

const line = (o: Record<string, unknown>) => JSON.stringify(o);
const assistant = (uuid: string, content: unknown[], extra: Record<string, unknown> = {}) =>
  line({ type: "assistant", uuid, timestamp: "2026-10-17T07:00:00Z", message: { model: "claude-opus-5-5", content }, ...extra });
const toolResult = (uuid: string, id: string, text: string) => line({ type: "user", uuid, timestamp: "2026-10-17T07:00:01Z", message: { content: [{ type: "tool_result", tool_use_id: id, content: text }] } });

const TRANSCRIPT = [
  line({ type: "user", uuid: "u1", timestamp: "2026-10-17T06:59:59Z", message: { content: "看下测试" } }),
  assistant("a1", [{ type: "thinking", thinking: "想一想" }]),
  assistant("a2", [{ type: "text", text: "先跑一下。" }]),
  assistant("a3", [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "bun test" } }]),
  toolResult("u2", "t1", "295 pass"),
  assistant("a4", [{ type: "text", text: "�" }]),
  assistant("s1", [{ type: "text", text: "子代理说的" }], { isSidechain: true }),
  assistant("x1", [{ type: "text", text: "API Error" }], { message: { model: "<synthetic>", content: [{ type: "text", text: "API Error" }] } }),
  line({ type: "attachment", uuid: "at1" }),
  assistant("a5", [{ type: "text", text: "都过了。" }]),
  assistant("a7", [{ type: "tool_use", id: "t2", name: "mcp__plugin_psyche_psyche__recall", input: { query: "测试" } }]),
  toolResult("u3", "t2", "没找到"),
].join("\n");

describe("transcript 映射", () => {
  test("报说的话、工具调用与结果（带名字）；不报思考、空字、子代理、合成消息、她的话", () => {
    const { items, model } = parseTranscript(TRANSCRIPT, "S");
    expect(items.map((i) => [i.kind, i.idem])).toEqual([
      ["message.out", "a2:0"],
      ["tool.call", "t1"],
      ["tool.result", "t1:result"],
      ["message.out", "a5:0"],
      ["tool.call", "t2"],
      ["tool.result", "t2:result"],
    ]);
    expect(items[4].payload.name).toBe("mcp__psyche__recall");
    expect(items[5].payload.name).toBe("mcp__psyche__recall");
    expect(items[2].payload).toMatchObject({ name: "Bash", ok: true, text: "295 pass", session: "S" });
    expect(model).toBe("claude-opus-5-5");
    expect(parseTranscript(TRANSCRIPT, "S", new Set(["a2:0", "t1"])).items.map((i) => i.idem)).toEqual(["t1:result", "a5:0", "t2", "t2:result"]);
  });

  test("斜杠命令认得出", () => {
    expect(isCommand("/clear")).toBe(true);
    expect(isCommand("<command-name>/model</command-name>")).toBe(true);
    expect(isCommand("看下 /tmp 里")).toBe(false);
  });
});

describe("四个 hook 对着 Psyche", () => {
  const store = new EventStore(":memory:");
  const projections = new Projections(store);
  projections.register(experienceProjector);
  projections.live();
  const app = createApp({ store, projections });
  const server = Bun.serve({ port: 0, fetch: app.fetch });
  afterAll(() => server.stop(true));
  const dir = mkdtempSync(join(tmpdir(), "psyche-cc-"));
  const transcript = join(dir, "t.jsonl");
  const hook = join(import.meta.dir, "..", "src", "hook.ts");

  const run = async (event: string, input: Record<string, unknown>, env: Record<string, string> = {}) => {
    const p = Bun.spawn(["bun", hook, event], {
      stdin: new Blob([JSON.stringify(input)]),
      stdout: "pipe",
      env: { ...process.env, PSYCHE_URL: `http://127.0.0.1:${server.port}`, CLAUDE_PLUGIN_DATA: dir, ...env },
    });
    const text = await new Response(p.stdout).text();
    expect(await p.exited).toBe(0);
    return text ? (JSON.parse(text) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext : "";
  };
  const kinds = () => store.list({}).map((e) => e.kind);

  test("开会话：报处境，给地方说明 + 自述；她说话：先报再给 <moment>；Stop：报经过，重跑不重复", async () => {
    writeFileSync(transcript, "");
    const ctx = await run("session-start", { session_id: "S", source: "startup", cwd: "/w/p", model: "claude-opus-5-5" });
    expect(ctx).toContain("这个地方：Claude Code（工位）");
    expect(store.list({ kinds: ["situation"] }).at(-1)!.payload).toEqual({ harness: "claude-code", session: "S", model: "claude-opus-5-5", cwd: "/w/p" });

    const now = await run("user-prompt", { session_id: "S", prompt: "看下测试" });
    expect(now).toContain("<moment>");
    expect(store.list({ kinds: ["message.in"] }).at(-1)!.payload).toMatchObject({ from: "Joy", text: "看下测试", via: "claude-code", session: "S" });
    expect(await run("user-prompt", { session_id: "S", prompt: "/clear" })).toBe("");

    writeFileSync(transcript, TRANSCRIPT);
    await run("stop", { session_id: "S", transcript_path: transcript });
    await run("stop", { session_id: "S", transcript_path: transcript });
    expect(kinds().filter((k) => k === "message.out" || k.startsWith("tool."))).toEqual(["message.out", "tool.call", "tool.result", "message.out", "tool.call", "tool.result"]);
    // 新的一行，只报新的
    appendFileSync(transcript, `\n${assistant("a6", [{ type: "text", text: "还有一件。" }], { message: { model: "claude-sonnet-5-5", content: [{ type: "text", text: "还有一件。" }] } })}`);
    await run("session-end", { session_id: "S", transcript_path: transcript });
    expect(store.list({ kinds: ["message.out"] }).length).toBe(3);
    // 换了模型重报处境，在新事件之前
    const sits = store.list({ kinds: ["situation"] });
    expect(sits.at(-1)!.payload).toMatchObject({ model: "claude-sonnet-5-5" });
 
    // 上下文从 transcript 里最后一条回复的 usage 算；「在」没变不重报
    appendFileSync(transcript, `\n${assistant("a7", [{ type: "text", text: "好" }], { message: { model: "claude-sonnet-5-5", content: [{ type: "text", text: "好" }], usage: { input_tokens: 2000, cache_read_input_tokens: 80000, cache_creation_input_tokens: 0 } } })}`);
    const again = await run("user-prompt", { session_id: "S", prompt: "继续", transcript_path: transcript });
    expect(again).toContain("上下文：已用约 82k token");
    expect(again).not.toContain("在：claude-code");
    // 压缩之后全报
    await run("session-start", { session_id: "S", source: "compact" });
    expect(await run("user-prompt", { session_id: "S", prompt: "接着" })).toContain("在：claude-code");
  });

  test("Psyche 不在：安静退出，什么都不输出；关掉开关也不动", async () => {
    expect(await run("session-start", { session_id: "Q" }, { PSYCHE_URL: "http://127.0.0.1:1" })).toBe("");
    expect(await run("user-prompt", { session_id: "S", prompt: "在吗" }, { PSYCHE_ENABLED: "0" })).toBe("");
  });
});
