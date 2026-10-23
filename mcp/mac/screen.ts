/**
 * MCP 服务 mac（stdio）：look_at_screen，看一眼 Joy 的屏幕（从 Roxy `screen-extension.ts` 搬来）。
 *
 * - 能力归她：`~/.psyche/mac.json` 的 screen 没开，就是一句事实「她没开放」，不截。开了之后什么时候看归他。
 * - 截屏 → sips 压到长边 2000 的 JPEG → 图直接进这一轮；原图用完即删，不留存。
 * - 每看一次记一行账（`~/.psyche/mac-screen.jsonl`：时间、谁、为什么），她翻得到。
 * - 系统要给跑这个进程的程序「屏幕录制」权限，没给时截出来的只有桌面或报错，照实说。
 *
 * 环境变量：PSYCHE_AGENT（他是谁，记账用）、PSYCHE_MAC_CONFIG。
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readConfig } from "./config.ts";

const run = promisify(execFile);
export const LEDGER = process.env.PSYCHE_MAC_LEDGER || join(homedir(), ".psyche", "mac-screen.jsonl");

export async function captureScreen(): Promise<{ data: string; mimeType: string }> {
  const png = join(tmpdir(), `psyche-screen-${randomBytes(6).toString("hex")}.png`);
  const jpg = `${png}.jpg`;
  try {
    await run("screencapture", ["-x", png], { timeout: 10_000 });
    try {
      await run("sips", ["-Z", "2000", "-s", "format", "jpeg", "-s", "formatOptions", "75", png, "--out", jpg], { timeout: 10_000 });
      return { data: readFileSync(jpg).toString("base64"), mimeType: "image/jpeg" };
    } catch {
      return { data: readFileSync(png).toString("base64"), mimeType: "image/png" };
    }
  } finally {
    for (const p of [png, jpg]) rmSync(p, { force: true });
  }
}

export function record(who: string, reason?: string, ledger = LEDGER) {
  mkdirSync(dirname(ledger), { recursive: true });
  appendFileSync(ledger, `${JSON.stringify({ at: new Date().toISOString(), who, ...(reason ? { reason } : {}) })}\n`, { mode: 0o600 });
}

export function createServer(opts: { capture?: typeof captureScreen; ledger?: string; config?: () => { screen: boolean } } = {}) {
  const server = new McpServer({ name: "mac", version: "0.1.0" });
  server.registerTool(
    "look_at_screen",
    {
      description:
        "看一眼 Joy 屏幕上此刻的画面：截一张，压缩后直接进这一轮，原图用完即删、不留存。每看一次都记进她翻得到的账（时间、谁、你写的 reason）。一次一张。她没开放时不截。",
      inputSchema: { reason: z.string().optional().describe("为什么想看，一句就够；记进她翻得到的账") },
    },
    async ({ reason }) => {
      if (!(opts.config ?? readConfig)().screen) return { content: [{ type: "text", text: "Joy 没有开放看屏幕（~/.psyche/mac.json 里 screen 没开），没截。" }] };
      try {
        const { data, mimeType } = await (opts.capture ?? captureScreen)();
        record(process.env.PSYCHE_AGENT || "?", reason, opts.ledger);
        return { content: [{ type: "text", text: "此刻的屏幕（压缩过，原图已删）：" }, { type: "image", data, mimeType }] };
      } catch (e) {
        return { content: [{ type: "text", text: `截屏没成（${e instanceof Error ? e.message : String(e)}）：可能是系统没给这个进程「屏幕录制」权限。` }], isError: true };
      }
    },
  );
  return server;
}

if (import.meta.main) await createServer().connect(new StdioServerTransport());
