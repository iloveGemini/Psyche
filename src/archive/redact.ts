/**
 * 凭据遮掉（notes/plan/claude-code.md §三）：上报的东西写库之前先遮，原文从不落库。
 *
 * 事件不可改，算向量还会把原文发出去；harness 的工具输出里常有 token、key。
 * 只是兜底：认得出的格式才遮，认不出的照样进去。宁可多遮——遮错了它看得到「已遮」，知道那里原本有东西。
 */

const RULES: { kind: string; re: RegExp; keep?: number }[] = [
  { kind: "私钥", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: "Anthropic key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: "API key", re: /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{20,}/g },
  { kind: "GitHub token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g },
  { kind: "AWS key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: "Slack token", re: /\bxox[abpsr]-[A-Za-z0-9-]{10,}/g },
  { kind: "Google key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "JWT", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  // 头和带名字的值：保留名字（keep = 前面第几组原样留），只遮值
  { kind: "Bearer", re: /(\bBearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, keep: 1 },
  {
    kind: "凭据",
    re: /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|secret|password|passwd|cookie|token|private[_-]?key)["']?\s*[:=]\s*["']?)([^\s"',;}{]{12,})/gi,
    keep: 1,
  },
];

/** 遮一段文字：返回遮过的和遮了几处 */
export function redactText(text: string): { text: string; n: number } {
  let n = 0;
  let out = text;
  for (const r of RULES) {
    out = out.replace(r.re, (...m: string[]) => {
      // 已经遮过的不再算
      if (m[0].includes("[已遮：")) return m[0];
      n++;
      return `${r.keep ? m.slice(1, r.keep + 1).join("") : ""}[已遮：${r.kind}]`;
    });
  }
  return { text: out, n };
}

/** 遮一个 payload 里所有的字符串（深入对象和数组）；键名不动 */
export function redactPayload<T>(value: T): { value: T; n: number } {
  let n = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const r = redactText(v);
      n += r.n;
      return r.text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value) as T, n };
}
