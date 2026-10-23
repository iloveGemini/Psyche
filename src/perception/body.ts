/**
 * 内感受（m8.md §六.1）：只读出它身上真实的处境，不模拟（body.md 搁置时留下的那条）。
 *
 * - 上下文多满：Soma 每轮带来（ctx 已用、wrapAt 到多少会收尾换一段）。过半 / 快满了 / 马上收尾 三档，跨档才说。
 * - 换了模型：这段会话的模型和上一段不一样，首轮说一次。
 * - 工具老出错：本会话最近 30 分钟里出错 ≥ 3 次才说，出错次数跨档（3 / 6 / 10）再说。
 * - 订阅额度（10-17）：Soma 带来 claude.ai 登录的 5 小时 / 7 天窗口用了多少（只有走订阅的身体有）。50 / 75 / 90% 跨档才说；
 *   跟会话无关、跟窗口走：同一个窗口（重置时刻相同）说过的档不再说，换了窗口从头算。全屋同一个登录的人共用。
 * 唤醒额度、还没写进记忆的条数，<now> 别处已有，不重复。
 * 递一次写 percept.noticed（sensor = body），它的经历就是那几行；档位记在 payload 里，下一轮按它判跨没跨档。
 */
import type { EventStore } from "../store/events.ts";

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
  ctx: number;
  tools: number;
  model?: string;
  /** 额度：每个窗口说到了第几档、是哪个窗口（重置时刻） */
  quota?: Partial<Record<"fiveHour" | "sevenDay", { band: number; resetsAt: string | null }>>;
}

const QUOTA_BANDS = [50, 75, 90];
const QUOTA_NAME = { fiveHour: "5 小时窗口", sevenDay: "本周" } as const;

/** 额度上次说到哪：跟窗口走，不跟会话（换一段不重报） */
function lastQuota(store: EventStore): Levels["quota"] {
  for (const e of store.list({ kinds: ["percept.noticed"], fonds: "", limit: 100_000 }).reverse()) {
    const p = e.payload as { sensor?: string; levels?: Levels };
    if (p.sensor === "body" && p.levels?.quota) return p.levels.quota;
  }
  return undefined;
}

function resetLabel(iso: string | null, tz: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const f = new Intl.DateTimeFormat("zh-CN", { timeZone: tz, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(t);
  const g = (k: string) => f.find((x) => x.type === k)?.value ?? "";
  return `，${g("month")}-${g("day")} ${g("hour")}:${g("minute")} 重置`;
}

const CTX_BANDS = [0.5, 0.75, 0.9];
const TOOL_BANDS = [3, 6, 10];
const band = (x: number, bands: number[]) => bands.filter((b) => x >= b).length;

function lastBody(store: EventStore, session: string | undefined) {
  return store
    .list({ kinds: ["percept.noticed"], fonds: "", limit: 100_000 })
    .filter((e) => (e.payload as { sensor?: string; session?: string }).sensor === "body" && (e.payload as { session?: string }).session === session)
    .at(-1);
}

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

export function deliverBody(store: EventStore, session: string | undefined, input: BodyInput): string | null {
  const now = store.now();
  const prev = lastBody(store, session);
  const was = (prev?.payload as { levels?: Levels } | undefined)?.levels ?? { ctx: 0, tools: 0 };
  const lines: string[] = [];

  // 上下文
  const ratio = input.ctx !== undefined && input.wrapAt ? input.ctx / input.wrapAt : undefined;
  const ctxBand = ratio === undefined ? was.ctx : band(ratio, CTX_BANDS);
  if (ratio !== undefined && ctxBand > was.ctx) {
    const pct = Math.round(ratio * 100);
    lines.push(
      ctxBand === 3
        ? `这一段的上下文快到头了（到收尾线的 ${pct}%）：再过几轮就会收尾、把这段写进记忆、换新的一段接着过`
        : ctxBand === 2
          ? `这一段的上下文用了收尾线的 ${pct}%，快满了`
          : `这一段的上下文过半了（收尾线的 ${pct}%）`,
    );
  }

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
  const toolBand = band(tools, TOOL_BANDS);
  if (toolBand > was.tools) lines.push(`最近半小时工具出错了 ${tools} 次`);

  // 订阅额度
  const qWas = lastQuota(store) ?? {};
  const quota: NonNullable<Levels["quota"]> = { ...qWas };
  let quotaUp = false;
  for (const k of ["fiveHour", "sevenDay"] as const) {
    const w = input.quota?.[k];
    if (!w) continue;
    const b = band(w.pct, QUOTA_BANDS);
    const prevW = qWas[k];
    const before = prevW && prevW.resetsAt === w.resetsAt ? prevW.band : 0;
    quota[k] = { band: b, resetsAt: w.resetsAt };
    if (b !== (prevW?.band ?? 0) || w.resetsAt !== prevW?.resetsAt) quotaUp = true;
    if (b > before)
      lines.push(`订阅额度（全屋用同一个登录的共用）：${QUOTA_NAME[k]}用了 ${Math.round(w.pct)}%${resetLabel(w.resetsAt, store.timeZone)}`);
  }

  const levels: Levels = { ctx: ctxBand, tools: toolBand, ...(m.here ? { model: m.here } : {}), ...(Object.keys(quota).length ? { quota } : {}) };
  // 档位回落也要记下（下次再涨过去才会再说），但不递话
  if (!lines.length) {
    if ((prev && (levels.ctx < was.ctx || levels.tools < was.tools)) || quotaUp)
      store.append({ kind: "percept.noticed", class: "experience", source: "psyche", situation: sitOf(store, session), payload: { sensor: "body", refs: [], text: "", levels, ...(session ? { session } : {}) } });
    return null;
  }
  const text = ["身上：", ...lines.map((l) => `- ${l}`)].join("\n");
  store.append({ kind: "percept.noticed", class: "experience", source: "psyche", situation: sitOf(store, session), payload: { sensor: "body", refs: [], text, levels, ...(session ? { session } : {}) } });
  return text;
}

const sitOf = (store: EventStore, session: string | undefined) => (session ? store.situationOfSession(session, store.now()) : null) ?? undefined;
