/**
 * 考卷用的 Vertex 执行器：给 Gemini 跑一轮无头会话，代替 `claude -p`（花额度，手动跑）。
 *
 * 工具走 Psyche 自己的 MCP（src/mcp.ts），和 Claude 拿到的是同一份名字、说明和参数——
 * 比的是模型，不是工具文案。和 `claude -p` 不同的地方（判卷时要记得）：
 *   - 没有 Claude Code 的系统提示词，只有 `system`（Psyche 的提示词）；
 *   - 思考用模型缺省（gemini-4-argon 是 HIGH），不进回复。
 *
 * 环境变量：
 *   VERTEX_API_KEY  Vertex API key
 *   VERTEX_BASE     到 location 为止，如 https://aiplatform.googleapis.com/v1/projects/<项目号>/locations/global
 *                   （gemini-4-argon 只在 global 开放）
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

/** 美元 / 百万 token（输入、输出含思考）。只认识的模型才算钱，别的记 0。 */
const PRICE: Record<string, [number, number]> = { "gemini-4-argon": [2, 10] };
/** 防它绕圈：一轮最多调这么多次模型 */
const MAX_STEPS = 40;
/** 429 / 5xx 最多重试几次（2s 起翻倍） */
const RETRIES = 6;

export const isVertexModel = (model: string) => model.startsWith("gemini-");

export interface VertexRun {
  reply: string;
  /** `名字(参数)`，和 b.ts 的格式一样 */
  calls: string[];
  cost: number;
  /** 每一步的原始请求结果与工具返回，写日志用 */
  log: unknown[];
}

interface Part {
  text?: string;
  thought?: boolean;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  thoughtSignature?: string;
}

export async function runVertex(opts: {
  model: string;
  system: string;
  input: string;
  psycheUrl: string;
  /** 只放行这些 MCP 工具（不带 mcp__psyche__ 前缀） */
  tools: string[];
}): Promise<VertexRun> {
  const key = process.env.VERTEX_API_KEY;
  const base = process.env.VERTEX_BASE?.replace(/\/+$/, "");
  if (!key || !base) throw new Error("要 VERTEX_API_KEY 和 VERTEX_BASE");

  const mcp = new Client({ name: "psyche-eval-vertex", version: "0.1.0" });
  await mcp.connect(
    new StdioClientTransport({
      command: "bun",
      args: ["run", join(ROOT, "src/mcp.ts")],
      env: { ...(process.env as Record<string, string>), PSYCHE_URL: opts.psycheUrl },
    }),
  );
  try {
    const listed = (await mcp.listTools()).tools.filter((t) => opts.tools.includes(t.name));
    const functionDeclarations = listed.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      parametersJsonSchema: t.inputSchema,
    }));

    const contents: { role: "user" | "model"; parts: Part[] }[] = [{ role: "user", parts: [{ text: opts.input }] }];
    const calls: string[] = [];
    const log: unknown[] = [];
    const [pin, pout] = PRICE[opts.model] ?? [0, 0];
    let cost = 0;

    for (let step = 0; step < MAX_STEPS; step++) {
      const body = JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents,
        ...(functionDeclarations.length ? { tools: [{ functionDeclarations }] } : {}),
      });
      // b.ts 一题 6 路并发，新模型的配额小，429 / 5xx 退避重试
      let res: Response;
      for (let attempt = 0; ; attempt++) {
        res = await fetch(`${base}/publishers/google/models/${opts.model}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key },
          body,
        });
        if ((res.status !== 429 && res.status < 500) || attempt >= RETRIES) break;
        await Bun.sleep(2000 * 2 ** attempt + Math.random() * 1000);
      }
      const json = (await res.json()) as any;
      log.push({ step, status: res.status, response: json });
      if (!res.ok) throw new Error(`Vertex ${res.status}：${json?.error?.message ?? JSON.stringify(json).slice(0, 300)}`);

      const u = json.usageMetadata ?? {};
      cost += ((u.promptTokenCount ?? 0) * pin + ((u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0)) * pout) / 1e6;

      // 原样带回（含 thoughtSignature）：Gemini 的多步工具调用要求把上一步的 model 回合原封不动地放回去
      const parts: Part[] = json.candidates?.[0]?.content?.parts ?? [];
      contents.push({ role: "model", parts });
      const fcs = parts.filter((p) => p.functionCall);
      if (!fcs.length) {
        const reply = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("");
        return { reply, calls, cost, log };
      }

      const responses: Part[] = [];
      for (const { functionCall } of fcs) {
        const name = functionCall!.name;
        const args = functionCall!.args ?? {};
        calls.push(`${name}(${JSON.stringify(args)})`);
        const r = opts.tools.includes(name)
          ? await mcp.callTool({ name, arguments: args })
          : { content: [{ type: "text", text: `没有这个工具：${name}` }], isError: true };
        const text = (r.content as { type: string; text?: string }[]).map((c) => c.text ?? "").join("\n");
        log.push({ step, tool: name, args, isError: r.isError ?? false, result: text });
        responses.push({ functionResponse: { name, response: r.isError ? { error: text } : { output: text } } });
      }
      contents.push({ role: "user", parts: responses });
    }
    throw new Error(`超过 ${MAX_STEPS} 步还没停`);
  } finally {
    await mcp.close();
  }
}
