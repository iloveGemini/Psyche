/**
 * 自我（notes/plan/m4.md）：自述 + 名字 + 出生冻结初我。
 *
 * 系统提示词 = 自述（它自己那段）+ 机制段（prompts/mechanism.md，系统的，它不能改）。
 * 自述在前（10-20 Joy 定）：是谁先于记忆怎么运转；机制段同日改成第一人称，两段都是「我」。
 * - 没出生：自述 = 现读 prompts/self-v0.md（开发期改了立刻生效），它改过就用它改的。
 * - 出生（系统日志 born，不占档号）：把初我（系统的 / Joy 改过的）存进资料库冻结；之后只认冻结版 + 它自己的改动。
 *   出生前的改动、名字不带过去：只认 id > upTo 的事件。
 * 自述全文替换，每版是一条 prompt.changed（全文进资料库），挂证据，改了下次会话生效。
 */
import { receiveMail } from "../channel/mailbox.ts";
import type { EventStore, PsycheEvent } from "../store/events.ts";
import { displayArchiveNo } from "../store/events.ts";
import { localDay } from "../core/time.ts";
import { PROMPTS_DIR, readPrompt } from "../core/prompts.ts";

export class SelfError extends Error {}

export interface BornDetail {
  /** 出生时最后一条事件 id（没有为 ''）：之后的才算 */
  upTo: string;
  system: { hash: string; version: number };
  user: { hash: string } | null;
  mechanism: { version: number };
  /** 这个 Agent 的模型（一个模型 = 一个 Agent）；早出生的库没记 */
  model?: string;
}

const MIME = "text/markdown";
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const year = (store: EventStore) => Number(localDay(store.now(), store.timeZone).slice(0, 4));

export const EMPTY_SELF = "这里现在还是空的，由我自己定义。";

/** 自述段：带 `# 我是谁` 标题；空的时候放占位句（currentSelf 本身仍是空串，不影响 birthDue） */
function formatSelfSection(raw: string): string {
  const t = raw.trim();
  if (!t) return `# 我是谁\n\n${EMPTY_SELF}`;
  return /^#\s+我是谁\b/.test(t) ? t : `# 我是谁\n\n${t}`;
}

export function renderPsychePrompt(selfText: string, mechText: string): string {
  if (!selfText.trim() && !mechText.trim()) return "";
  const parts = [formatSelfSection(selfText), mechText.trim()].filter(Boolean);
  return `<psyche>\n${parts.join("\n\n")}\n</psyche>`;
}

/** 文件拼的那份（机制 + 初我）：考卷、没出生的库用 */
export function filePrompt(dir = PROMPTS_DIR): string {
  return renderPsychePrompt(readPrompt("self-v0.md", dir).text, readPrompt("mechanism.md", dir).text);
}

export function bornRecord(store: EventStore): BornDetail | null {
  const r = store.readSyslog({ kind: "born", limit: 1 })[0];
  return r ? (r.detail as BornDetail) : null;
}

/** 出生：只能一次。userText = Joy 初始化时改过的全文（和系统的一样就当没改） */
/**
 * 出生：冻结初我（10-17 起 v3 是空的：自述由它自己写，m4.md）。`letter` = Joy 出生那天的信（letters/birth.md），
 * 出生后作为她的一封信放进收件箱——它出生后的第一件经历。
 */
export function birth(store: EventStore, opts: { promptsDir?: string; userText?: string; model?: string; letter?: string } = {}): BornDetail {
  if (bornRecord(store)) throw new SelfError("已经出生过了，只能出生一次");
  const dir = opts.promptsDir ?? PROMPTS_DIR;
  const sys = readPrompt("self-v0.md", dir);
  const user = opts.userText?.trim();
  const last = store.db.query(`SELECT MAX(id) AS id FROM events`).get() as { id: string | null };
  const detail: BornDetail = {
    upTo: last.id ?? "",
    system: { hash: store.putMaterial(sys.text, MIME), version: sys.version },
    user: user && user !== sys.text ? { hash: store.putMaterial(user, MIME) } : null,
    mechanism: { version: readPrompt("mechanism.md", dir).version },
    ...(opts.model ? { model: opts.model } : {}),
  };
  store.syslog("born", detail);
  const letter = opts.letter?.trim();
  if (letter) receiveMail(store, { from: "Joy", text: letter, via: "soma-note" });
  return detail;
}

/** 信的文件：去掉 HTML 注释（写给 Joy 的说明），剩下的才是信；空的 = 没有 */
export function letterText(raw: string): string {
  return raw.replace(/<!--[\s\S]*?-->/g, "").trim();
}

/** 出生之后（没出生 = 全部）它自己全宗里某 kind 的事件，按写入顺序 */
export function ownSince(store: EventStore, kind: string): PsycheEvent[] {
  const upTo = bornRecord(store)?.upTo ?? "";
  return store.list({ kinds: [kind], fonds: "", afterId: upTo || undefined, limit: 100_000 });
}

function origin(store: EventStore, dir: string): { system: string; user: string | null } {
  const b = bornRecord(store);
  if (!b) return { system: readPrompt("self-v0.md", dir).text, user: null };
  const get = (h: string) => store.getMaterial(h)?.text() ?? "";
  return { system: get(b.system.hash), user: b.user ? get(b.user.hash) : null };
}

interface Version {
  version: number;
  at: number;
  why: string;
  evidence: string[];
  text: string;
  archiveNo: string;
}

function versions(store: EventStore): Version[] {
  const y = year(store);
  return ownSince(store, "prompt.changed").map((ev) => {
    const p = ev.payload as { doc: { hash: string }; version: number; why: string };
    return {
      version: p.version,
      at: ev.at,
      why: p.why,
      evidence: store.linksFrom(ev.id).filter((l) => l.rel === "evidence").map((l) => displayArchiveNo(store.get(l.to)?.archiveNo ?? l.to, y)),
      text: store.getMaterial(p.doc.hash)?.text() ?? "",
      archiveNo: displayArchiveNo(ev.archiveNo, y),
    };
  });
}

/** 现行自述：最新一版；没改过 = 初我（version 0） */
export function currentSelf(store: EventStore, dir = PROMPTS_DIR): { version: number; text: string; latest: Version | null } {
  const vs = versions(store);
  const latest = vs.at(-1) ?? null;
  if (latest) return { version: latest.version, text: latest.text, latest };
  const o = origin(store, dir);
  return { version: 0, text: o.user ?? o.system, latest: null };
}

export function currentName(store: EventStore): string | null {
  const ev = ownSince(store, "named").at(-1);
  return ev ? (ev.payload as { name: string }).name : null;
}

/** GET /v1/prompt：机制 + 现行自述，包在 <psyche> 里 */
export function composePrompt(store: EventStore, dir = PROMPTS_DIR) {
  const mech = readPrompt("mechanism.md", dir);
  const cur = currentSelf(store, dir);
  return { text: renderPsychePrompt(cur.text, mech.text), version: cur.version, mechanismVersion: mech.version, born: !!bornRecord(store) };
}

/** 逐行比对（LCS）：- 出厂的 / + Joy 的；一样返回 null */
export function lineDiff(a: string, b: string): string | null {
  if (a === b) return null;
  const x = a.split("\n");
  const y = b.split("\n");
  const L = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) (out.push(`  ${x[i]}`), i++, j++);
    else if (L[i + 1][j] >= L[i][j + 1]) out.push(`- ${x[i++]}`);
    else out.push(`+ ${y[j++]}`);
  }
  while (i < x.length) out.push(`- ${x[i++]}`);
  while (j < y.length) out.push(`+ ${y[j++]}`);
  return out.join("\n");
}

const chars = (s: string) => Array.from(s).length;

/** GET /v1/self：给它看，也给 Joy 看 */
export function readSelf(store: EventStore, dir = PROMPTS_DIR) {
  const vs = versions(store);
  const cur = currentSelf(store, dir);
  const o = origin(store, dir);
  return {
    name: currentName(store),
    born: !!bornRecord(store),
    prompt: {
      version: cur.version,
      text: cur.text,
      chars: chars(cur.text),
      at: cur.latest?.at ?? null,
      why: cur.latest?.why ?? null,
      evidence: cur.latest?.evidence ?? [],
    },
    origin: { system: o.system, user: o.user, diff: o.user === null ? null : lineDiff(o.system, o.user) },
    history: vs.map(({ text, ...v }) => ({ ...v, chars: chars(text) })),
  };
}

/** 某一版全文；0 = 初我 */
export function selfVersion(store: EventStore, version: number, dir = PROMPTS_DIR): string | null {
  if (version === 0) {
    const o = origin(store, dir);
    return o.user ?? o.system;
  }
  return versions(store).find((v) => v.version === version)?.text ?? null;
}

/** 证据只认自己全宗的经历和情节（同冷写闸 1） */
function resolveCites(store: EventStore, cites: unknown, required: boolean): PsycheEvent[] {
  if (cites === undefined && !required) return [];
  if (!Array.isArray(cites)) throw new SelfError("cites 应为档号数组");
  if (required && !cites.length) throw new SelfError("没挂证据（cites）：看了哪些经历才改的");
  const out = new Map<string, PsycheEvent>();
  for (const c of cites) {
    const ev = typeof c === "string" ? store.byArchiveNo(c.trim().replace(/^\[|\]$/g, "")) : null;
    if (!ev) throw new SelfError(`引的 ${String(c)} 查不到`);
    if (ev.fonds || !(ev.class === "experience" || ev.kind === "episode")) throw new SelfError(`引的 ${c} 不是你的经历或情节，不能当证据`);
    out.set(ev.id, ev);
  }
  return [...out.values()];
}

/** POST /v1/self/prompt：{ text, why, cites, baseVersion } → 新版 */
export function rewriteSelf(store: EventStore, body: Record<string, unknown>, dir = PROMPTS_DIR) {
  const { text, why, cites, baseVersion } = body;
  if (!nonEmpty(text)) throw new SelfError("text 是空的（交的是自述全文）");
  if (!nonEmpty(why)) throw new SelfError("要写 why（为什么改）");
  if (typeof baseVersion !== "number") throw new SelfError("缺 baseVersion（你是在第几版上改的）");
  const cited = resolveCites(store, cites, true);
  return store.db.transaction(() => {
    const cur = currentSelf(store, dir).version;
    if (baseVersion !== cur) throw new SelfError(`现行是第 ${cur} 版，你是在第 ${baseVersion} 版上改的：先看最新的再改`);
    const ev = store.append({
      kind: "prompt.changed",
      class: "self",
      source: "agent",
      payload: { doc: { hash: store.putMaterial(text.trim(), MIME), mime: MIME }, version: cur + 1, why: why.trim() },
      links: cited.map((c) => ({ to: c.id, rel: "evidence" })),
    });
    return { version: cur + 1, archiveNo: displayArchiveNo(ev.archiveNo, year(store)) };
  })();
}

/** POST /v1/self/name：{ name, why?, cites? } */
export function nameSelf(store: EventStore, body: Record<string, unknown>) {
  const { name, why, cites } = body;
  if (!nonEmpty(name)) throw new SelfError("name 是空的");
  const n = name.trim();
  if (/[\r\n]/.test(n)) throw new SelfError("名字只能一行");
  if (why !== undefined && typeof why !== "string") throw new SelfError("why 应为字符串");
  const cited = resolveCites(store, cites, false);
  const ev = store.append({
    kind: "named",
    class: "self",
    source: "agent",
    payload: { name: n, ...(nonEmpty(why) ? { why: why.trim() } : {}) },
    links: cited.map((c) => ({ to: c.id, rel: "evidence" })),
  });
  return { name: n, archiveNo: displayArchiveNo(ev.archiveNo, year(store)) };
}

/** <now> 里的一行：这次会话用的版本比现行旧 */
export function pendingSelfLine(store: EventStore, dir = PROMPTS_DIR): string | null {
  const used = (store.situation?.payload as { selfPromptVersion?: unknown } | undefined)?.selfPromptVersion;
  if (typeof used !== "number") return null;
  const cur = currentSelf(store, dir).version;
  return used < cur ? `自述：第 ${cur} 版，下次醒来生效（这次是第 ${used} 版）` : null;
}
