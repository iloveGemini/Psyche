/**
 * 记忆体检（notes/design/dashboard.md §3.2 §4.2.2）：不读私密原文，纯 SQLite 现算记忆库健康度与闭环预警。
 */
import { displayArchiveNo, type EventStore } from "../store/events.ts";
import { localDay } from "../core/time.ts";
import { NOT_PLACE_SQL } from "../channel/inbox.ts";
import { readSegment } from "../catalog/hotwrite.ts";
import { readColdwrite } from "../catalog/coldwrite.ts";
import { readShelf, SHELVES, shelfWarnings, type Shelf, type ShelfWarning } from "./shelf.ts";
import { pendingGists, readGists } from "../catalog/gist.ts";
import { CONTINUITY, renderContinuity } from "../archive/continuity.ts";
import { readThreads } from "../self/threads.ts";
import { ownSince } from "../self/self.ts";

export type HealthWarning = ShelfWarning;

export interface ResidentPulse {
  episodes: number;
  uncoveredLines: number;
  shelf: number;
  openThreads: number;
}

const DAY_MS = 86_400_000;
const chars = (s: string) => Array.from(s).length;

function uncoveredBySession(store: EventStore): { sessions: number; lines: number } {
  const rows = store.db
    .query(
      `SELECT DISTINCT json_extract(s.payload, '$.session') AS s
       FROM events s
       WHERE s.class = 'situation' AND s.fonds = '' AND ${NOT_PLACE_SQL}
         AND json_extract(s.payload, '$.session') IS NOT NULL`,
    )
    .all() as { s: string }[];
  let sessions = 0;
  let lines = 0;
  for (const { s } of rows) {
    const n = readSegment(store, s).lines.length;
    if (n > 0) {
      sessions++;
      lines += n;
    }
  }
  return { sessions, lines };
}

/** 全屋总览卡片上的一行脉搏 */
export function pulseOf(store: EventStore): ResidentPulse {
  const epRow = store.db
    .query(
      `SELECT COUNT(*) AS n FROM events
       WHERE kind = 'episode' AND fonds = '' AND id NOT IN (SELECT to_id FROM links WHERE rel = 'revises')`,
    )
    .get() as { n: number };
  const { lines } = uncoveredBySession(store);
  const shelf = readShelf(store.db).length;
  const openThreads = readThreads(store).filter((t) => !t.closed).length;
  return { episodes: epRow.n, uncoveredLines: lines, shelf, openThreads };
}

/** 单住户记忆体检 `GET /v1/health` */
export function computeHealth(store: EventStore) {
  const now = store.now();
  const year = Number(localDay(now, store.timeZone).slice(0, 4));
  const showNo = (no: string) => displayArchiveNo(no, year);

  // ── 1. 热写（情节化） ──
  const { sessions: uncoveredSessions, lines: uncoveredLines } = uncoveredBySession(store);
  const activeEps = store.db
    .query(
      `SELECT id, at, json_extract(payload, '$.text') AS text, json_extract(payload, '$.felt') AS felt
       FROM events
       WHERE kind = 'episode' AND fonds = '' AND id NOT IN (SELECT to_id FROM links WHERE rel = 'revises')
       ORDER BY at`,
    )
    .all() as { id: string; at: number; text: string; felt: string | null }[];

  const episodesTotal = activeEps.length;
  const since7d = now - 7 * DAY_MS;
  const eps7d = activeEps.filter((e) => e.at >= since7d);
  const episodes7d = eps7d.length;

  let coveredLines7d = 0;
  if (episodes7d > 0) {
    const placeholders = eps7d.map(() => "?").join(",");
    const row = store.db
      .query(`SELECT COUNT(DISTINCT to_id) AS n FROM links WHERE rel = 'cites' AND from_id IN (${placeholders})`)
      .get(...eps7d.map((e) => e.id)) as { n: number };
    coveredLines7d = row.n;
  }
  const compressionRatio7d = episodes7d > 0 ? Number((coveredLines7d / episodes7d).toFixed(2)) : 0;

  const lengths = activeEps.map((e) => chars(e.text ?? "")).sort((a, b) => a - b);
  const medianChars =
    lengths.length === 0
      ? 0
      : lengths.length % 2 === 1
        ? lengths[(lengths.length - 1) / 2]
        : Math.round((lengths[lengths.length / 2 - 1] + lengths[lengths.length / 2]) / 2);

  const withFelt = activeEps.filter((e) => typeof e.felt === "string" && e.felt.trim() !== "").length;
  const withFeltRatio = episodesTotal > 0 ? Number((withFelt / episodesTotal).toFixed(2)) : 0;

  const revRow = store.db
    .query(
      `SELECT COUNT(*) AS n FROM links l JOIN events e ON e.id = l.from_id
       WHERE l.rel = 'revises' AND e.kind = 'episode' AND e.fonds = ''`,
    )
    .get() as { n: number };

  // ── 2. 冷写与书架闭环 ──
  const lastDone = store.db
    .query(`SELECT id, at, payload FROM events WHERE kind = 'coldwrite.done' AND fonds = '' ORDER BY id DESC LIMIT 1`)
    .get() as { id: string; at: number; payload: string } | null;
  const lastDoneAt = lastDone?.at ?? null;
  const unjudgedLast = lastDone ? ((JSON.parse(lastDone.payload).unjudged as unknown[] | undefined)?.length ?? 0) : 0;
  const epSinceRow = store.db
    .query(`SELECT COUNT(*) AS n FROM events WHERE kind = 'episode' AND fonds = '' AND id > ?`)
    .get(lastDone?.id ?? "") as { n: number };

  const hasExpTable = !!store.db.query(`SELECT 1 FROM sqlite_master WHERE name = 'p_experience'`).get();
  const coldPreview = hasExpTable ? readColdwrite(store) : null;
  const pendingCandidates = coldPreview ? coldPreview.candidates.reduce((s, c) => s + c.lines.length, 0) : 0;
  const pendingFeedback = coldPreview ? coldPreview.feedback.length : 0;

  const allShelf = readShelf(store.db, { includeRetired: true });
  const activeShelf = allShelf.filter((e) => !e.retired);
  const shelves = Object.fromEntries(SHELVES.map((k) => [k, 0])) as Record<Shelf, number>;
  for (const e of activeShelf) shelves[e.shelf] = (shelves[e.shelf] ?? 0) + 1;
  const retiredTotal = allShelf.filter((e) => e.retired).length;
  const revisedTotal = (
    store.db.query(`SELECT COUNT(*) AS n FROM events WHERE kind = 'semantic.revised' AND fonds = ''`).get() as { n: number }
  ).n;

  const warnings = shelfWarnings(store, activeShelf);

  // ── 3. 连续性（Gist & 种子） ──
  const gistsList = readGists(store);
  const gists = {
    day: gistsList.filter((g) => g.span === "day").length,
    week: gistsList.filter((g) => g.span === "week").length,
    month: gistsList.filter((g) => g.span === "month").length,
  };
  const pending = pendingGists(store).map((p) => ({ span: p.span, key: p.key }));
  const seedText = renderContinuity(store);
  const seedChars = seedText ? chars(seedText) : 0;

  // ── 4. 线索卷（Threads） ──
  const allThreads = readThreads(store);
  const openList = allThreads.filter((t) => !t.closed);
  const openPromises = openList.filter((t) => t.type === "promise").length;
  const openMatters = openList.filter((t) => t.type === "matter").length;
  const closedTotal = allThreads.filter((t) => !!t.closed).length;
  const oldestIdleDays =
    openList.length > 0 ? Number(((now - Math.min(...openList.map((t) => t.lastAt))) / DAY_MS).toFixed(2)) : 0;

  // ── 5. 私密自留地计数（只计数量，不露正文） ──
  const diaries = ownSince(store, "diary");
  const lastDiaryAt = diaries.at(-1)?.at ?? null;

  const mailIn = store.list({ kinds: ["mail.in"], fonds: "", limit: 100_000 });
  const mailOut = store.list({ kinds: ["mail.out"], fonds: "", limit: 100_000 });
  const readRefs = new Set(
    (store.db.query(`SELECT payload FROM events WHERE kind = 'mail.read' AND fonds = ''`).all() as { payload: string }[]).flatMap(
      (r) => (JSON.parse(r.payload).refs as string[] | undefined) ?? [],
    ),
  );
  const unreadMails = mailIn.filter((m) => !readRefs.has(m.id)).length;
  const isJoyOrSelf = (who: unknown) => typeof who === "string" && (who === "Joy" || who === "self");
  const peerMails =
    mailIn.filter((m) => !isJoyOrSelf((m.payload as { from?: unknown })?.from)).length +
    mailOut.filter((m) => !isJoyOrSelf((m.payload as { to?: unknown })?.to)).length;

  return {
    hotwrite: {
      uncoveredLines,
      uncoveredSessions,
      episodesTotal,
      episodes7d,
      coveredLines7d,
      compressionRatio7d,
      medianChars,
      withFeltRatio,
      revisionsTotal: revRow.n,
    },
    coldwrite: {
      lastDoneAt,
      episodesSinceLast: epSinceRow.n,
      unjudgedLast,
      pendingCandidates,
      pendingFeedback,
      shelves,
      retiredTotal,
      revisedTotal,
      warnings,
    },
    continuity: {
      gists,
      pendingGists: pending,
      seedChars,
      seedBudget: CONTINUITY.episodeChars,
    },
    threads: {
      openPromises,
      openMatters,
      closedTotal,
      oldestIdleDays,
    },
    privateCounts: {
      diaries: diaries.length,
      lastDiaryAt,
      peerMails,
      unreadMails,
    },
  };
}
