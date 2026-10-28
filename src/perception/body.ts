/**
 * 内感受（m8.md §六.1）：只读出它身上真实的处境，不模拟（body.md 搁置时留下的那条）。
 *
 * - 上下文多满、订阅额度：10-27 并进 moment 的状态闸（ctxItem / quotaItem，m1.md §四），跨档才报，这里不再说。
 * - 换了模型：这段会话的模型和上一段不一样，首轮说一次。
 * - 工具老出错：本会话最近 30 分钟里出错 ≥ 3 次才说，出错次数跨档（3 / 6 / 10）再说。
 * 唤醒额度在 moment 的作息那项，不重复。
 * 递一次记系统日志 percept.delivered（sensor = body），不进经历（m8.md §五）；档位记在里面，下一轮按它判跨没跨档。
 */
import type { EventStore } from "../store/events.ts";
import { lastDelivery, recordDelivery } from "./delivered.ts";
import { bandOf, type StateItem } from "../archive/moment.ts";

export interface BodyInput {
  /** 已用 token */
  ctx?: number;
  /** 到多少 token 会收尾换一段 */
  wrapAt?: number;
  /** 订阅额度（百分比 0-100，重置时刻 ISO） */
  quota?: { fiveHour?: QuotaWindow; sevenDay?: QuotaWindow };
}

interface QuotaWindow {
  pct: number;
  resetsAt: string | null;
}

interface Levels {
  tools: number;
  model?: string;
}

const QUOTA_BANDS = [50, 75, 90];
const QUOTA_NAME = { fiveHour: "5 小时窗口", sevenDay: "本周" } as const;

function resetLabel(iso: string | null, tz: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const f = new Intl.DateTimeFormat("zh-CN", { timeZone: tz, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(t);
  const g = (k: string) => f.find((x) => x.type === k)?.value ?? "";
  return `，${g("month")}-${g("day")} ${g("hour")}:${g("minute")} 重置`;
}

const CTX_BANDS = [0.25, 0.5, 0.75, 0.9];
/** 没有收尾线（工位）：按已用 token 每 5 万一档 */
const CTX_STEP = 50_000;
const TOOL_BANDS = [3, 6, 10];

const lastBody = (store: EventStore, session: string | undefined) => lastDelivery(store, "body", session, false);

/** 这段会话和上一段的模型（处境里记的） */
function models(store: EventStore, session: string | undefined): { here?: string; before?: string } {
  if (!session) return {};
  const sits = store.db
    .query(`SELECT json_extract(payload, '$.session') AS s, json_extract(payload, '$.model') AS m FROM events WHERE class = 'situation' AND fonds = '' ORDER BY at, id`)
    .all() as { s: string | null; m: string | null }[];
  const here = [...sits].reverse().find((r) => r.s === session && r.m)?.m ?? undefined;
  const firstHere = sits.findIndex((r) => r.s === session);
  const before = firstHere > 0 ? [...sits.slice(0, firstHere)].reverse().find((r) => r.m && r.s !== session)?.m ?? undefined : undefined;
  return { here, before };
}

/** 上下文（moment 的一项）：有收尾线按它的 25 / 50 / 75 / 90% 分档，没有（工位）按已用 token 每 5 万一档 */
export function ctxItem(input: Pick<BodyInput, "ctx" | "wrapAt">): StateItem | null {
  if (input.ctx === undefined) return null;
  const k = Math.round(input.ctx / 1000);
  if (!input.wrapAt) return { key: "ctx", sig: String(Math.floor(input.ctx / CTX_STEP)), text: `上下文：已用约 ${k}k token` };
  const ratio = input.ctx / input.wrapAt;
  const b = bandOf(ratio, CTX_BANDS);
  const pct = Math.round(ratio * 100);
  return {
    key: "ctx",
    sig: String(b),
    text: `上下文：约 ${k}k，到收尾线的 ${pct}%${b === 4 ? "——再过几轮就会收尾、把这段写进记忆、换新的一段接着过" : ""}`,
  };
}

/**
 * 订阅额度（moment 的一项，10-24 Joy 要常显）：Soma 带来 claude.ai 登录的 5 小时 / 7 天窗口用了多少（只有走订阅的身体有），
 * 全屋同一个登录的人共用。跨 50 / 75 / 90% 或换了窗口才重报。
 */
export function quotaItem(store: EventStore, quota: BodyInput["quota"]): StateItem | null {
  const ks = (["fiveHour", "sevenDay"] as const).filter((k) => quota?.[k]);
  if (!ks.length) return null;
  return {
    key: "quota",
    sig: ks.map((k) => `${k}:${bandOf(quota![k]!.pct, QUOTA_BANDS)}:${resetBucket(quota![k]!.resetsAt)}`).join("|"),
    text: `订阅额度（全屋共用）：${ks.map((k) => `${QUOTA_NAME[k]} ${Math.round(quota![k]!.pct)}%${resetLabel(quota![k]!.resetsAt, store.timeZone)}`).join(" · ")}`,
  };
}

/** 重置时刻每轮会抖一两分钟（20:09 / 20:10）：按半小时取整，真换了窗口才算变 */
function resetBucket(iso: string | null): string {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? "" : String(Math.round(t / 1_800_000));
}

/** 身上（事件）：换了模型（首轮说一次）、工具老出错（跨档说） */
export function deliverBody(store: EventStore, session: string | undefined): string | null {
  const now = store.now();
  const prev = lastBody(store, session);
  const was = (prev?.levels as Levels | undefined) ?? { tools: 0 };
  const lines: string[] = [];

  // 模型
  const m = models(store, session);
  if (!prev && m.here && m.before && m.here !== m.before) lines.push(`这一段用的是 ${m.here}，上一段是 ${m.before}`);

  // 工具出错
  let tools = 0;
  if (session) {
    const r = store.db
      .query(
        `SELECT COUNT(*) AS n FROM events e JOIN events s ON s.id = e.situation WHERE e.kind = 'tool.result' AND e.fonds = ''
           AND json_extract(e.payload, '$.ok') = 0 AND json_extract(s.payload, '$.session') = ? AND e.at > ?`,
      )
      .get(session, now - 30 * 60_000) as { n: number };
    tools = r.n;
  }
  const toolBand = bandOf(tools, TOOL_BANDS);
  if (toolBand > (was.tools ?? 0)) lines.push(`最近半小时工具出错了 ${tools} 次`);

  const levels: Levels = { tools: toolBand, ...(m.here ? { model: m.here } : {}) };
  // 档位回落也要记下（下次再涨过去才会再说），但不递话
  if (!lines.length) {
    if (prev && levels.tools < (was.tools ?? 0)) recordDelivery(store, "body", session, { refs: [], text: "", levels });
    return null;
  }
  const text = ["身上：", ...lines.map((l) => `- ${l}`)].join("\n");
  recordDelivery(store, "body", session, { refs: [], text, levels });
  return text;
}
