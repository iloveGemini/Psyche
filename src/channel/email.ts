/**
 * 邮箱通道（notes/plan/m6.md §〇.1）：房子的一个邮箱，经 agently-cli（QQ 邮箱的 Agent 邮箱 CLI）；
 * 几个住户共用，来信按 [名字] / @名字 / 同一话题分（soma2.md §8.2，routeEmail）。
 *
 * - 令牌按 workspace 分开存：一律带 AGENTLY_WORKSPACE（缺省 psyche），不碰 Roxy 用的 default。
 * - 收：常驻 `message +watch`（长轮询，一封一行 JSON），死了 5 秒后重起；每次起之前先 `+list --is-unread` 补漏
 *   （+watch 不补发它启动前到的）。只收 Joy 的地址（通道设置里），别人的不写事件、只记 `mail.ignored`。
 *   幂等靠事件的 idem（email:<message_id>），重启补漏不会重记。
 * - 发：回她的邮件 `+reply --id`；主动写 `+send`，主题由它填，没填取正文第一行（它自己的话，系统不另写）。
 *   结果记 `mail.sent`；失败不重试，作为状态进 <now>。
 * 做法照 Roxy packages/desktop/lib/lifecycle/mail.ts。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { EventStore, PsycheEvent } from "../store/events.ts";
import { getChannels, receiveMail } from "./mailbox.ts";

export interface MailMessage {
  message_id: string;
  subject?: string;
  from?: { name?: string; email?: string };
  body?: string;
  body_format?: string;
}

export const WORKSPACE = process.env.AGENTLY_WORKSPACE ?? "psyche";
const CLI_CANDIDATES = ["/opt/homebrew/bin/agently-cli", "/usr/local/bin/agently-cli"];
const RESTART_MS = 5000;
/** 来信正文超过这么长截断（全文进不了 <now>，也不该撑大事件） */
const BODY_LIMIT = 20_000;

/** +watch 的一行：{ message: {...} }；拿不到详情的（fetch_error）跳过，留给补漏 */
export function parseWatchLine(line: string): MailMessage | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.trim());
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const m = ((parsed as { message?: unknown }).message ?? parsed) as Partial<MailMessage>;
  return typeof m.message_id === "string" && m.message_id ? (m as MailMessage) : undefined;
}

/** HTML 里引用块的开头：QQ 邮箱 / Gmail / Outlook / Apple Mail */
const HTML_QUOTE = [/<div[^>]*\bid=["']original-content["']/i, /<div[^>]*\bclass=["'][^"']*\bgmail_quote\b/i, /<div[^>]*\bid=["']divRplyFwdMsg["']/i, /<blockquote[^>]*\btype=["']cite["']/i];
/** 纯文本里引用的开头：分隔线、「On … wrote:」「在 … 写道：」 */
const TEXT_QUOTE = [/^-{4,}\s*(原始邮件|Original Message)\s*-{4,}\s*$/im, /^On .{1,300}wrote:\s*$/im, /^在 ?.{1,300}写道[:：]\s*$/m];

/** 回信里引用的原信截掉：那是它自己写过的、已在它的经历里（连带 Agent Mail 的页脚）；截完是空的（只在引用里夹着写）就不截 */
export function cutQuote(text: string, patterns: RegExp[]): string {
  const at = Math.min(...patterns.map((p) => text.search(p)).filter((i) => i >= 0));
  if (!Number.isFinite(at)) return text;
  const head = text.slice(0, at);
  return head.replace(/<[^>]+>|&nbsp;|\s/g, "") ? head.trimEnd() : text;
}

export function plainBody(m: MailMessage): string {
  const html = m.body_format === "HTML";
  const raw = cutQuote((m.body ?? "").trim(), html ? HTML_QUOTE : TEXT_QUOTE);
  const text =
    html
      ? raw
          .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, "&")
          .replace(/^[ \t]+|[ \t]+$/gm, "")
          .replace(/[ \t]{2,}/g, " ")
          .replace(/\n{3,}/g, "\n\n")
          .trim()
      : raw;
  return Array.from(text).length > BODY_LIMIT ? `${Array.from(text).slice(0, BODY_LIMIT).join("")}…（截断）` : text;
}

/** 收一封：是 Joy 的地址就记 mail.in（from 用登记的名字），别人的只计数 */
export function takeEmail(store: EventStore, m: MailMessage): "taken" | "ignored" | "empty" {
  const addr = (m.from?.email ?? "").trim().toLowerCase();
  const { addresses } = getChannels(store);
  const who = Object.entries(addresses).find(([, a]) => a.email?.trim().toLowerCase() === addr)?.[0];
  if (!who) {
    store.syslog("mail.ignored", { via: "email", from: addr });
    return "ignored";
  }
  const text = plainBody(m);
  if (!text) return "empty";
  receiveMail(store, { from: who, text, via: "email", ...(m.subject?.trim() ? { subject: m.subject.trim() } : {}), ext: m.message_id });
  return "taken";
}

// ── 房子的一个邮箱，按 @ 分（soma2.md §8.2，10-17）──

export interface MailResident {
  id: string;
  store: EventStore;
  /** 它自己取的名字（没取 = 只认 id） */
  name?: string | null;
}

/** 去掉 Re: / 回复: / Fwd: / 转发: 和我们加的 [名字]，剩下的算同一个话题 */
export function topicOf(subject: string | undefined): string {
  let t = (subject ?? "").trim();
  for (let prev = ""; prev !== t; ) {
    prev = t;
    t = t.replace(/^(re|fwd?|回复|答复|转发)\s*[:：]\s*/i, "").replace(/^\[[^\]]{1,40}\]\s*/, "").trim();
  }
  return t;
}

/**
 * 这封给谁：① 主题里我们加的 [名字]；② 主题或第一行 @名字（可几个）；③ 同一个话题上次给过谁；④ 默认住户。
 * 名字认 id 和它自己取的名字。
 */
export function routeEmail(residents: MailResident[], m: MailMessage, fallback: string): string[] {
  const subject = m.subject ?? "";
  const names = (r: MailResident) => [r.id, ...(r.name ? [r.name] : [])];
  const tagged = residents.filter((r) => names(r).some((n) => subject.includes(`[${n}]`)));
  if (tagged.length) return [tagged[0].id];
  const head = `${subject}\n${plainBody(m).split("\n")[0] ?? ""}`;
  const at = residents.filter((r) => names(r).some((n) => new RegExp(`[@＠]${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`, "i").test(head)));
  if (at.length) return at.map((r) => r.id);
  const topic = topicOf(subject);
  if (topic) {
    let best: { id: string; at: number } | undefined;
    for (const r of residents) {
      const last = r.store
        .list({ kinds: ["mail.in", "mail.out"], fonds: "", limit: 100_000 })
        .filter((e) => topicOf((e.payload as { subject?: string }).subject) === topic && ((e.payload as { via?: string }).via ?? "email") === "email")
        .at(-1);
      if (last && (!best || last.at > best.at)) best = { id: r.id, at: last.at };
    }
    if (best) return [best.id];
  }
  return [fallback];
}

/** 收一封进房子：分给谁，再按那人的通道设置认发信人（不认识就看全屋别人登记的） */
export function takeHouseEmail(residents: MailResident[], m: MailMessage, fallback: string): { to: string; result: "taken" | "ignored" | "empty" }[] {
  const addr = (m.from?.email ?? "").trim().toLowerCase();
  const nameIn = (store: EventStore) => Object.entries(getChannels(store).addresses).find(([, a]) => a.email?.trim().toLowerCase() === addr)?.[0];
  const known = residents.map((r) => nameIn(r.store)).find(Boolean);
  return routeEmail(residents, m, fallback).map((to) => {
    const r = residents.find((x) => x.id === to)!;
    const who = nameIn(r.store) ?? known;
    if (!who) {
      r.store.syslog("mail.ignored", { via: "email", from: addr });
      return { to, result: "ignored" as const };
    }
    const text = plainBody(m);
    if (!text) return { to, result: "empty" as const };
    receiveMail(r.store, { from: who, text, via: "email", ...(m.subject?.trim() ? { subject: m.subject.trim() } : {}), ext: m.message_id });
    return { to, result: "taken" as const };
  });
}

/** 发信的 CLI 参数：回她的邮件用 +reply；主动写用 +send */
/** `tag`：房子的邮箱有几个人在用时，主动写的信主题前加 [名字]（她一眼知道是谁，回信也认得回来） */
export function emailArgs(mail: { to: string; text: string; subject?: string; replyToExt?: string; tag?: string }): string[] {
  const tail = ["--body", mail.text, "--body-format", "plain", "--confirmed"];
  if (mail.replyToExt) return ["message", "+reply", "--id", mail.replyToExt, ...tail];
  const subject = mail.subject?.trim() || Array.from(mail.text.trim().split("\n")[0]).slice(0, 40).join("");
  return ["message", "+send", "--to", mail.to, "--subject", mail.tag ? `[${mail.tag}] ${subject}` : subject, ...tail];
}

// ── CLI ──

function cliPath(): string {
  return process.env.AGENTLY_CLI ?? CLI_CANDIDATES.find((p) => existsSync(p)) ?? "agently-cli";
}
const cliEnv = () => ({ ...process.env, AGENTLY_WORKSPACE: WORKSPACE, AGENTLY_CLI_NO_UPDATE_NOTIFIER: "1" });

export type CliRunner = (args: string[]) => Promise<string>;

export const runCli: CliRunner = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(cliPath(), args, { env: cliEnv(), stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`agently-cli ${args[1] ?? ""} 超时`));
    }, 30_000);
    child.stdout.setEncoding("utf8").on("data", (c: string) => (out += c));
    child.stderr.setEncoding("utf8").on("data", (c: string) => (err += c));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else {
        let msg = err.trim() || out.trim();
        try {
          const j = JSON.parse(out);
          msg = j?.error?.message ?? j?.message ?? msg;
        } catch {}
        reject(new Error(msg.slice(0, 300) || `退出码 ${code}`));
      }
    });
  });

/** 投递一封写给人的信（mail.out），记 mail.sent */
export async function deliverEmail(store: EventStore, ev: PsycheEvent, run: CliRunner = runCli, tag?: string): Promise<void> {
  const p = ev.payload as { to: string; text: string; subject?: string; replyTo?: string };
  const to = getChannels(store).addresses[p.to]?.email;
  const reply = p.replyTo ? store.get(p.replyTo) : null;
  const replyToExt = reply && (reply.payload as { via?: string }).via === "email" ? (reply.payload as { ext?: string }).ext : undefined;
  try {
    if (!to && !replyToExt) throw new Error(`没有 ${p.to} 的邮箱地址（通道设置）`);
    await run(emailArgs({ to: to ?? "", text: p.text, subject: p.subject, replyToExt, ...(tag ? { tag } : {}) }));
    store.syslog("mail.sent", { ref: ev.id, via: "email", ok: true });
  } catch (e) {
    store.syslog("mail.sent", { ref: ev.id, via: "email", ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

/** 常驻收信：先补漏，再 +watch；进程没了 5 秒后重来（重来也先补漏） */
/** `take` 收一封（房子的：takeHouseEmail）；`seen` 这封记过没有（补漏时跳过） */
export function startEmailWatch(
  inbox: { take(m: MailMessage): void; seen(messageId: string): boolean },
  opts: { onError?: (e: Error) => void; run?: CliRunner } = {},
): { stop(): void } {
  const run = opts.run ?? runCli;
  const report = (e: unknown) => opts.onError?.(e instanceof Error ? e : new Error(String(e)));
  let stopped = false;
  let child: ReturnType<typeof spawn> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const take = (m: MailMessage) => {
    try {
      inbox.take(m);
    } catch (e) {
      report(e);
    }
  };

  const catchUp = async () => {
    try {
      const list = JSON.parse(await run(["message", "+list", "--is-unread", "--limit", "20"]))?.data?.data;
      if (!Array.isArray(list)) return;
      for (const s of list as MailMessage[]) {
        if (typeof s?.message_id !== "string") continue;
        if (inbox.seen(s.message_id)) continue;
        const full = JSON.parse(await run(["message", "+read", "--id", s.message_id]))?.data;
        take(full?.message_id ? full : s);
      }
    } catch (e) {
      report(e);
    }
  };

  const start = () => {
    if (stopped) return;
    void catchUp().finally(() => {
      if (stopped) return;
      child = spawn(cliPath(), ["message", "+watch"], { env: cliEnv(), stdio: ["ignore", "pipe", "pipe"] });
      let buf = "";
      child.stdout!.setEncoding("utf8").on("data", (c: string) => {
        buf += c;
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) {
          const m = parseWatchLine(l);
          if (m) take(m);
        }
      });
      child.stderr!.setEncoding("utf8").on("data", (c: string) => console.error("[email]", c.trim()));
      child.on("error", report);
      child.on("close", () => {
        if (stopped || timer) return;
        timer = setTimeout(() => {
          timer = undefined;
          start();
        }, RESTART_MS);
      });
    });
  };
  start();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      child?.kill();
    },
  };
}
