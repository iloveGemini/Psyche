/**
 * 接着往下过（10-16，notes/design/lib-vs-harness.md「压缩不要摘要，拼它自己写过的」）：
 * Soma 换物理会话时，新会话从这里拼的上下文起头——都是它自己写过的，没有旁观者的摘要。
 *
 * 次序：月 → 周 → 天的梗概（越远越粗）→ 最近还没写进天梗概的情节 → 还开着的事（m7.md §二，全列）。自我（about_me / about_user）在系统提示词里，不在这。
 * 刚才的原话由 Soma 接在后面（它手里有原文）。长度在挑的时候管：梗概定长、条数有上限；情节从新往旧取到预算为止。
 */
import type { EventStore } from "../store/events.ts";
import { localDay } from "../core/time.ts";
import { currentEpisodes, monthOf, readGists, weekOf } from "../catalog/gist.ts";
import { readShelf, SHELF_NAME, SHELVES, shelfWarnings, stillPast, type Shelf } from "../reading/shelf.ts";
import { renderOpenThreads } from "../self/threads.ts";
import { renderPinned } from "../self/pinned.ts";

export const CONTINUITY = { days: 7, weeks: 4, months: 12, episodeChars: 6000 };

/**
 * 馆藏与书架概览（两级目录的第一级，常驻在 <continuity> 开头）：
 * 让 Agent 不用调工具就看得见自己有多少原始记录、情节、梗概、已认领前世，以及书架上各栏现行条数与预警。
 * 全空时返回 null。
 */
export function renderCatalog(store: EventStore): string | null {
  const rawCount = (
    store.db.query(`SELECT COUNT(*) AS n FROM events WHERE fonds = '' AND class = 'experience'`).get() as { n: number }
  ).n;
  const epCount = currentEpisodes(store).length;
  const gists = readGists(store);
  const gDay = gists.filter((g) => g.span === "day").length;
  const gWeek = gists.filter((g) => g.span === "week").length;
  const gMonth = gists.filter((g) => g.span === "month").length;
  const pastRows = store.db
    .query(`SELECT fonds, COUNT(*) AS n FROM events WHERE fonds != '' GROUP BY fonds ORDER BY fonds`)
    .all() as { fonds: string; n: number }[];
  const activeShelf = readShelf(store.db);

  if (!rawCount && !epCount && !gists.length && !pastRows.length && !activeShelf.length) return null;

  const gistText = `天 ${gDay} / 周 ${gWeek} / 月 ${gMonth}`;
  const pastText = pastRows.length ? ` · 前世：${pastRows.map((r) => `${r.fonds} ${r.n} 条`).join("、")}` : "";
  const archiveLine = `馆藏：原始记录 ${rawCount} 条 · 情节 ${epCount} 条 · 梗概：${gistText}${pastText}`;

  const counts = Object.fromEntries(SHELVES.map((k) => [k, 0])) as Record<Shelf, number>;
  for (const e of activeShelf) counts[e.shelf] = (counts[e.shelf] ?? 0) + 1;
  const shelfParts = SHELVES.map((k) => `${SHELF_NAME[k]} ${counts[k]}`);
  const pastShelfCount = activeShelf.filter(stillPast).length;

  const byAbout = new Map<string, number>();
  for (const e of activeShelf) {
    if (e.about) byAbout.set(e.about, (byAbout.get(e.about) ?? 0) + 1);
  }
  const aboutSuffix = byAbout.size ? `；按人：${[...byAbout].map(([who, n]) => `${who} ${n}`).join(" · ")}` : "";

  const warnings = shelfWarnings(store, activeShelf);
  const noAgainst = warnings.filter((w) => w.reason === "no_against");
  const stale = warnings.filter((w) => w.reason === "stale");
  const warnItems: string[] = [];
  if (noAgainst.length) warnItems.push(`待复核 ${noAgainst.length} 条 [${noAgainst.map((w) => w.archiveNo).join(", ")}]`);
  if (stale.length) warnItems.push(`久未验证 ${stale.length} 条 [${stale.map((w) => w.archiveNo).join(", ")}]`);
  const warnSuffix = warnItems.length ? `；预警：${warnItems.join(" · ")}` : "";

  const shelfLine = `书架：${shelfParts.join(" · ")}${pastShelfCount ? `（含前世待印证 ${pastShelfCount} 条）` : ""}${aboutSuffix}${warnSuffix}`;
  return ["【馆藏与书架】", archiveLine, shelfLine].join("\n");
}

export function renderContinuity(store: EventStore, limits = CONTINUITY): string | null {
  const gists = readGists(store);
  const days = gists.filter((g) => g.span === "day").slice(-limits.days);
  const oldestDay = days[0]?.key;
  const weeks = gists.filter((g) => g.span === "week" && (!oldestDay || g.key < weekOf(oldestDay))).slice(-limits.weeks);
  const oldestWeekMonth = weeks[0] ? monthOfWeek(weeks[0].key) : oldestDay ? monthOf(oldestDay) : undefined;
  const months = gists.filter((g) => g.span === "month" && (!oldestWeekMonth || g.key < oldestWeekMonth)).slice(-limits.months);

  // 最近的情节：最后一条天梗概之后的天（今天、还没写梗概的昨天……），从新往旧取到预算
  const lastGistDay = gists.filter((g) => g.span === "day").at(-1)?.key;
  const recent = currentEpisodes(store).filter((e) => !lastGistDay || e.day > lastGistDay);
  const kept: string[] = [];
  let used = 0;
  for (const e of [...recent].reverse()) {
    const n = Array.from(e.text).length;
    if (kept.length && used + n > limits.episodeChars) break;
    kept.unshift(e.text);
    used += n;
  }
  const dropped = recent.length - kept.length;

  const catalog = renderCatalog(store);
  const threads = renderOpenThreads(store);
  // 常驻区（self/pinned.ts）：它自己钉上的书架条目，每次醒来都在
  const pinned = renderPinned(store);
  if (!catalog && !months.length && !weeks.length && !days.length && !kept.length && !threads && !pinned) return null;
  const today = localDay(store.now(), store.timeZone);
  const short = (key: string) => (key.startsWith(today.slice(0, 5)) ? key.slice(5) : key);
  return [
    ...(pinned ? [pinned, ""] : []),
    ...(catalog ? [catalog, ""] : []),
    ...(months.length ? ["【月】", ...months.map((g) => `${g.key}：${g.text}`), ""] : []),
    ...(weeks.length ? ["【周】", ...weeks.map((g) => `${g.key}：${g.text}`), ""] : []),
    ...(days.length ? ["【天】", ...days.map((g) => `${short(g.key)}：${g.text}`), ""] : []),
    ...(kept.length ? ["【最近的情节】", ...(dropped ? [`（更早的 ${dropped} 条没放进来，要找用 recall）`] : []), ...kept, ""] : []),
    ...(threads ? [threads, ""] : []),
  ]
    .join("\n")
    .trim();
}

/** 周归到它周四所在的月（ISO 周的年月） */
function monthOfWeek(week: string): string {
  const [y, w] = week.split("-W").map(Number);
  const jan4 = Date.UTC(y, 0, 4);
  const week1Monday = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * 86_400_000;
  const thursday = week1Monday + ((w - 1) * 7 + 3) * 86_400_000;
  return new Date(thursday).toISOString().slice(0, 7);
}
