/**
 * 凭据遮掉（notes/plan/claude-code.md §三）：写库之前遮，原文不落库；大块工具结果转资料前也遮。
 */
import { describe, expect, test } from "bun:test";
import { EventStore } from "../src/store/events.ts";
import { intake } from "../src/archive/intake.ts";
import { redactText } from "../src/archive/redact.ts";

describe("认得出的格式", () => {
  test("各种 key、token、私钥、带名字的值都遮；名字留着", () => {
    const cases: [string, string][] = [
      ["key sk-ant-api03-abcdefghijklmnopqrstuvwx 用这个", "Anthropic key"],
      ["OPENAI=sk-proj-abcdefghijklmnopqrstuvwxyz0123", "API key"],
      ["ghp_abcdefghijklmnopqrstuvwxyz0123456789", "GitHub token"],
      ["AKIAABCDEFGHIJKLMNOP", "AWS key"],
      ["xoxb-1234567890-abcdefghij", "Slack token"],
      ["AIzaSyA1234567890abcdefghijklmnopqrstuv", "Google key"],
      ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop", "JWT"],
      ["-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIB\n-----END RSA PRIVATE KEY-----", "私钥"],
    ];
    for (const [text, kind] of cases) {
      const r = redactText(text);
      expect(r.n).toBeGreaterThan(0);
      expect(r.text).toContain(`[已遮：${kind}]`);
    }
    const h = redactText("authorization: Bearer abcdefghijklmnopqrstuvwxyz123456");
    expect(h.text).toBe("authorization: Bearer [已遮：Bearer]");
    const kv = redactText(`"api_key": "a1b2c3d4e5f6g7h8i9j0", password=hunter2hunter2hunter2`);
    expect(kv.text).toBe(`"api_key": "[已遮：凭据]", password=[已遮：凭据]`);
  });

  test("普通的话、短值、哈希、uuid 不遮", () => {
    for (const t of ["token 用完了", "password: 123", "commit 4c5a901 心跳", "session 034537b8-fc9d-40da-88b5-daa810578952", "sk-短"]) {
      expect(redactText(t)).toEqual({ text: t, n: 0 });
    }
  });
});

describe("入库口", () => {
  test("工具结果和参数里的凭据不落库，带 redacted；大块转资料前也遮", () => {
    const store = new EventStore(":memory:");
    const call = intake(store, { kind: "tool.call", source: "claude-code", payload: { name: "Bash", callId: "c1", args: { command: "curl -H 'authorization: Bearer abcdefghijklmnopqrstuvwxyz123456' x" } } });
    expect(JSON.stringify(call.payload)).not.toContain("abcdefghijklmnop");
    expect((call.payload as Record<string, unknown>).redacted).toBe(1);
    const big = `${"x".repeat(3000)}\nSILICONFLOW_API_KEY=sk-abcdefghijklmnopqrstuvwxyz0123\n`;
    const res = intake(store, { kind: "tool.result", source: "claude-code", payload: { callId: "c1", name: "Bash", ok: true, text: big } });
    const rp = res.payload as Record<string, unknown>;
    const hash = (rp.result as { hash: string }).hash;
    const material = store.getMaterial(hash)!;
    expect(material.text()).toContain("[已遮：API key]");
    expect(material.text()).not.toContain("sk-abcdef");
    expect(rp.redacted).toBe(1);
    const said = intake(store, { kind: "message.in", source: "claude-code", payload: { from: "Joy", text: "在吗" } });
    expect((said.payload as Record<string, unknown>).redacted).toBeUndefined();
  });
});
