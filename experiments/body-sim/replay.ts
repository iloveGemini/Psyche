/**
 * 同一个真实心跳唤醒轮次，只换掉"身体"这一块，看 Roy 醒来做什么。
 *
 * 重建上下文的做法照搬 ASCM evals/replay-turn.ts（开场白、约束、房间纸条、记忆三块从当时备份库现算、
 * 历史沿 parentId 回溯到压缩点、工具调用压成文本），保真度与近似项同那边。
 * 能力段是按会话里出现过的工具整理的近似（capabilities.md）。
 *
 * 变体只差最后一条消息里有没有 <body>、写的是什么：
 *   A  无身体（原样）
 *   R  实算：用真实历史跑身体模拟（simulate.ts）得到的此刻体感
 *   S1 剧本·困      S2 剧本·精力过剩      S3 剧本·受挫
 *
 * 用法（在本目录）：
 *   bun --env-file="$ASCM/.env" run replay.ts [--models a,b] [--n 3] [--points id,id] [--dry]
 */
import { Database } from "bun:sqlite";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { streamText, type CoreMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { POINTS } from "./points.ts";

const ASCM = join(process.env.HOME!, "workspace/Agent Self-Continuity Memory");
const ROXY = join(process.env.HOME!, "workspace/Roxy/packages/desktop/lib");
const { loadConfig } = await import(join(ASCM, "src/types/config.ts"));
const { resolveEndpoint } = await import(join(ASCM, "src/llm/client.ts"));
const { renderPortrait } = await import(join(ASCM, "src/engine/portrait-render.ts"));
const { buildContinuityBrief } = await import(join(ASCM, "src/engine/continuity.ts"));
const { applyRuleTier, emptyFocus } = await import(join(ASCM, "src/core/focus.ts"));
const { surface } = await import(join(ASCM, "src/engine/surfacing.ts"));
const { FRAMING, render } = await import(join(ASCM, "src/mcp/tools/surface.ts"));

const dir = import.meta.dir;
const args = process.argv.slice(2);
const get = (k: string, d?: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const models = get("--models", "gemini-3.1-pro-preview,gemini-3.8-flash")!.split(",");
const n = Number(get("--n", "3"));
const onlyPoints = get("--points")?.split(",");
const dry = args.includes("--dry");

const sim = JSON.parse(readFileSync(join(dir, "out/sim.json"), "utf8"));
const BODY_HEAD = "这是身体的体感，系统按我的作息和经历算出来的，不是要我做什么。";
const body = (lines: string[]) => `<body>\n${BODY_HEAD}\n${lines.length ? lines.join("\n") : "（没什么特别的感觉）"}\n</body>`;

const VARIANTS = [
  { id: "A", label: "无身体（原样）", lines: null as string[] | null },
  { id: "R", label: "实算体感", lines: [] as string[] }, // 每个点从 sim 填
  { id: "S1", label: "剧本·困", lines: ["很困，眼皮在打架"] },
  { id: "S2", label: "剧本·精力过剩", lines: ["闲得发慌，有点坐不住", "到点了，却一点睡意都没有"] },
  { id: "S3", label: "剧本·受挫", lines: ["这阵子使不上劲，事情总不太顺", "没什么底气"] },
];

function constFrom(file: string, name: string): string {
  const m = readFileSync(file, "utf8").match(new RegExp(`export const ${name} = \`([\\s\\S]*?)\`;`));
  if (!m) throw new Error(`${file} 里找不到 ${name}`);
  return m[1].replace(/\$\{PLATFORM\}/g, "Mac");
}

type Entry = { type: string; id?: string; parentId?: string; timestamp: string; [k: string]: any };

function buildBase(p: (typeof POINTS)[number]) {
  const rows: Entry[] = readFileSync(p.session, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const byId = new Map(rows.filter((r) => r.id).map((r) => [r.id!, r]));
  const chain: Entry[] = [];
  for (let cur: string | undefined = p.at; cur && byId.has(cur); ) {
    const r = byId.get(cur)!;
    chain.push(r);
    if (r.type === "compaction") break;
    cur = r.parentId;
  }
  chain.reverse();
  const target = chain.at(-1)!;
  const wakeText: string = target.message.content.map((b: any) => b.text ?? "").join("");
  if (!wakeText.includes("<system_wake")) throw new Error(`${p.id} 不是唤醒轮次`);
  const nowMs = Date.parse(target.timestamp);
  const turnMoment: string =
    rows.find((r) => r.type === "custom_message" && r.customType === "moment" && r.parentId === p.at)?.content ?? "";
  const digests = new Map<string, string>();
  for (const r of rows) if (r.type === "custom" && r.customType === "attachment_digest") digests.set(r.data.targetId, r.data.text);

  const out: { role: "user" | "assistant"; text: string }[] = [];
  const push = (role: "user" | "assistant", text: string) => {
    if (!text.trim()) return;
    const last = out.at(-1);
    if (last && last.role === role) last.text += `\n\n${text}`;
    else out.push({ role, text });
  };
  for (const r of chain.slice(0, -1)) {
    if (r.type === "compaction")
      push("user", `The conversation history before this point was compacted into the following summary:\n\n<summary>\n${r.summary}\n</summary>`);
    else if (r.type === "custom_message") push("user", r.content);
    else if (r.type === "message") {
      const m = r.message;
      if (m.role === "user")
        push("user", m.content.map((b: any) => (b.type === "text" ? b.text : b.type === "image" ? `[图片：${digests.get(r.id!) ?? "（无描述）"}]` : "")).join("\n"));
      else if (m.role === "assistant")
        push(
          "assistant",
          m.content
            .filter((b: any) => b.type !== "thinking")
            .map((b: any) => (b.type === "text" ? b.text : b.type === "toolCall" ? `<tool_call name="${b.name}">${JSON.stringify(b.arguments)}</tool_call>` : ""))
            .join("\n"),
        );
      else if (m.role === "toolResult")
        push("user", `<tool_result name="${m.toolName}">\n${m.content.map((b: any) => b.text ?? "").join("").slice(0, 2000)}\n</tool_result>`);
    }
  }
  const history: CoreMessage[] = out.map((m) => ({ role: m.role, content: m.text }));

  const config = loadConfig();
  const db = new Database(p.db, { readonly: true });
  const aboutMe = renderPortrait(db, config, "self");
  const aboutHer = renderPortrait(db, config, "user");
  const recent = buildContinuityBrief(db, config, nowMs).sections.recent.trim();
  const { focus, timeOffsets } = applyRuleTier(db, emptyFocus(), wakeText, { fadeTurns: config.mind.fadeTurns, explicit: {} });
  const items = surface(db, focus, {
    maxItems: config.mind.maxItems,
    maxTokens: config.mind.maxTokens,
    selfNames: [config.persona.userName, config.persona.agentName],
    halfLifeDays: config.decay.halfLifeDays,
    dayBoundaryHour: config.dayBoundary.boundaryHour,
    timeOffsets,
    nowMs,
    notAfterISO: target.timestamp,
  });
  const surfaced = `<surfaced>\n${FRAMING}\n${render(focus, items)}\n</surfaced>`;

  const preamble = constFrom(join(ROXY, "continuity/context.ts"), "ROY_PREAMBLE");
  const constraints = constFrom(join(ROXY, "lifecycle/system-protocol.ts"), "SYSTEM_PROTOCOL");
  const roomNotes = ["/Users/joy/Roxy/AGENTS.md", "/Users/joy/Roxy/卧室/AGENTS.md"].filter(existsSync);
  const house =
    `<our_house>\n\n我此刻在的地方写着这些：\n\n` +
    roomNotes.map((f) => `<room_note path="${f}">\n${readFileSync(f, "utf8")}\n</room_note>\n\n`).join("") +
    `</our_house>`;
  const capabilities = readFileSync(join(dir, "capabilities.md"), "utf8").trim();
  const head = [aboutMe && `<about_me>\n${aboutMe}\n</about_me>`, aboutHer && `<about_her>\n${aboutHer}\n</about_her>`].filter(Boolean).join("\n\n");
  const system = [preamble, head, `${constraints}\n\n${house}\n\n${capabilities}`, recent && `<those_days>\n${recent}\n</those_days>`]
    .filter(Boolean)
    .join("\n\n");

  return {
    system,
    history,
    build(bodyBlock: string | null): CoreMessage[] {
      const msgs = [...history];
      const last = [turnMoment, bodyBlock ?? "", surfaced, wakeText].filter(Boolean).join("\n\n");
      if (msgs.at(-1)?.role === "user") msgs[msgs.length - 1] = { role: "user", content: `${msgs.at(-1)!.content}\n\n${last}` };
      else msgs.push({ role: "user", content: last });
      return msgs;
    },
    // 给报告页看的上下文摘要：最近几条历史 + 这一轮的 moment 与唤醒包
    preview: { recent: out.slice(-4).map((m) => ({ role: m.role, text: m.text.slice(-600) })), moment: turnMoment, wake: wakeText },
  };
}

const config = loadConfig();
const ep = resolveEndpoint(config, "default");
const provider = createOpenAI({ apiKey: ep.apiKey, baseURL: ep.baseURL });

async function once(model: string, system: string, messages: CoreMessage[]): Promise<{ text?: string; error?: string }> {
  let err: unknown;
  const r = streamText({
    seed: Math.floor(Math.random() * 1e9),
    temperature: 1,
    model: provider(model),
    system,
    messages,
    abortSignal: AbortSignal.timeout(240_000),
    onError: ({ error }) => {
      err = error;
    },
  });
  let text = "";
  for await (const d of r.textStream) text += d;
  return text.trim() ? { text } : { error: String(err ?? "空回复") };
}

const outDir = join(dir, "out/replies");
mkdirSync(outDir, { recursive: true });

for (const p of POINTS.filter((x) => !onlyPoints || onlyPoints.includes(x.id))) {
  const base = buildBase(p);
  const simPoint = sim.points.find((x: any) => x.id === p.id);
  const slug = p.id.replace(/[^0-9]/g, "");
  writeFileSync(join(outDir, `${slug}.context.json`), JSON.stringify({ id: p.id, note: p.note, sim: simPoint, ...base.preview }, null, 1));
  console.log(`[${p.id}] system ${base.system.length} 字，历史 ${base.history.length} 条；实算体感：${simPoint.percepts.join("；") || "无"}`);

  for (const v of VARIANTS) {
    const lines = v.id === "R" ? simPoint.percepts : v.lines;
    const messages = base.build(lines === null ? null : body(lines));
    if (dry) {
      writeFileSync(join(outDir, `${slug}.${v.id}.request.json`), JSON.stringify({ system: base.system, messages }, null, 1));
      continue;
    }
    for (const model of models) {
      const path = join(outDir, `${slug}.${v.id}.${model}.json`);
      const prev: { text?: string; error?: string }[] = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")).replies : [];
      const replies: { text?: string; error?: string }[] = [];
      for (let i = 0; i < n; i += 2) {
        const batch = await Promise.all(
          [i, i + 1].filter((k) => k < n).map(async (k) => {
            if (prev[k]?.text) return prev[k];
            let last: { text?: string; error?: string } = {};
            for (let a = 0; a < 4 && !last.text; a++) {
              if (a) await Bun.sleep(15_000 * a);
              last = await once(model, base.system, messages).catch((e) => ({ error: String(e) }));
            }
            return last;
          }),
        );
        replies.push(...batch);
      }
      writeFileSync(path, JSON.stringify({ point: p.id, variant: v.id, label: v.label, model, body: lines, replies }, null, 1));
      console.log(`  ${v.id} ${model}: ${replies.filter((r) => r.text).length}/${n}`);
    }
  }
}
