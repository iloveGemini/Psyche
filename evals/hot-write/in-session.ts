/**
 * 热写考卷·会话内（10-20）：在一个 pi 会话的副本上推一轮收尾（全文 / 索引），截下 hotwrite 的参数，不入库。
 * 用 Soma 装的 pi 和 Soma 的模型凭据（SOMA_PI_DIR，缺省测试库 ~/.soma-test/pi）。花额度，手动跑。
 *   bun evals/hot-write/in-session.ts <segment.json> <full|brief> <out.json> <pi 会话 .jsonl> [provider/model]
 * segment.json = GET /v1/hotwrite 的返回（全文）；brief 在这里截，和 ?brief=1 同一个函数。
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const SOMA = process.env.SOMA_DIR ?? join(import.meta.dir, "../../../Soma");
const PI = join(SOMA, "node_modules/@earendil-works/pi-coding-agent/dist/index.js");
const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, defineTool } = await import(PI);
const { Type } = await import(join(SOMA, "node_modules/typebox/build/index.mjs"));
const { briefText } = await import("../../src/catalog/hotwrite.ts");

const [segPath, mode, outPath, SRC, spec = "google-vertex/gemini-3.8-flash"] = process.argv.slice(2);
if (!SRC || !["full", "brief"].includes(mode)) {
  console.error("用法：bun evals/hot-write/in-session.ts <segment.json> <full|brief> <out.json> <pi 会话 .jsonl> [provider/model]");
  process.exit(2);
}
const seg = JSON.parse(readFileSync(segPath, "utf8"));
const PI_DIR = process.env.SOMA_PI_DIR ?? join(process.env.HOME!, ".soma-test/pi");
const work = mkdtempSync(join(tmpdir(), `hotwrite-${mode}-`));
mkdirSync(join(work, "sessions"), { recursive: true });
const file = join(work, "sessions", "s.jsonl");
copyFileSync(SRC, file);

// 系统提示词：会话里存的那份
let systemPrompt = "";
for (const l of readFileSync(SRC, "utf8").split("\n")) {
  if (!l) continue;
  const m = JSON.parse(l).message;
  if (m?.role === "system") systemPrompt = [m.sections.preamble, m.sections.cwd].filter(Boolean).join("\n\n");
}

const full = new Map<string, string>(seg.lines.map((l: any) => [l.archiveNo, l.text]));
const lines = seg.lines.map((l: any) => ({ ...l, text: mode === "brief" ? briefText(l.text) : l.text }));
const records = lines.map((l: any) => `${l.archiveNo} ${l.text.replace(/\n/g, "\n  ")}`);
const wrap = [`<psyche-hotwrite session="${seg.session}" upTo="${seg.upTo}">`, seg.prompt.trim(), "", `<segment upTo="${seg.upTo}">`, ...records, "</segment>", "</psyche-hotwrite>"].join("\n");

const calls: any[] = [];
const detailCalls: string[] = [];
const hotwrite = defineTool({
  name: "mcp__psyche__hotwrite",
  label: "hotwrite",
  description: "把这一段写成情节交给记忆。upTo 用 hotwrite_segment 或收尾提示给的那个，原样传回。",
  parameters: Type.Object({
    upTo: Type.String(),
    entries: Type.Array(Type.Object({ text: Type.String(), felt: Type.Optional(Type.String()), cites: Type.Array(Type.String()) })),
  }),
  async execute(_id: string, params: any) {
    calls.push(params);
    return { content: [{ type: "text", text: `记下了 ${params.entries?.length ?? 0} 条` }] };
  },
});
const detail = defineTool({
  name: "mcp__psyche__detail",
  label: "detail",
  description: "按档号看原件",
  parameters: Type.Object({ archiveNo: Type.String() }),
  async execute(_id: string, p: any) {
    detailCalls.push(p.archiveNo);
    return { content: [{ type: "text", text: full.get(p.archiveNo.replace(/^2026-/, "")) ?? "没有这个档号" }] };
  },
});

const modelRuntime = await ModelRuntime.create({ authPath: join(PI_DIR, "auth.json"), modelsPath: join(PI_DIR, "models.json") });
const model = modelRuntime.getModel(spec.slice(0, spec.indexOf("/")), spec.slice(spec.indexOf("/") + 1));
if (!model) throw new Error(`找不到模型 ${spec}`);
const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: true, maxRetries: 3 } });
const resourceLoader = new DefaultResourceLoader({
  cwd: work, agentDir: work, settingsManager,
  noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
  extensionFactories: [], systemPromptOverride: () => systemPrompt, appendSystemPromptOverride: () => [],
});
await resourceLoader.reload();
const sessionManager = SessionManager.open(file, join(work, "sessions"), work);
const { session } = await createAgentSession({ cwd: work, agentDir: work, model, modelRuntime, resourceLoader, settingsManager, sessionManager, customTools: [hotwrite, detail], noTools: "builtin" });
const before = session.getContextUsage();
await session.prompt(wrap);
const stats = session.getSessionStats();
const said = session.messages.filter((m: any) => m.role === "assistant").slice(-3).flatMap((m: any) => m.content.filter((b: any) => b.type === "text").map((b: any) => b.text));
writeFileSync(outPath, JSON.stringify({ mode, wrapChars: wrap.length, before, stats, detailCalls, said, upTo: calls.at(-1)?.upTo, entries: calls.at(-1)?.entries ?? [], calls: calls.length }, null, 2));
console.log(mode, "wrapChars", wrap.length, "calls", calls.length, "entries", calls.at(-1)?.entries?.length, "detail", detailCalls.length);
process.exit(0);
