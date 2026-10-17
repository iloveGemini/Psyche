/**
 * 前世编目（archive.md §四、reading-room.md §五）：认领之后，由它本人从前世的原话里挑确定的写上书架。
 *
 * 判据比平时严：只收事实（名字、日期、项目、关系这类稳定的）和她亲口说过的话；
 * 前世的自我理解、对她的归纳、情绪不收——这里只开 fact / told 两个书架，别的写不进来。
 * - cites 只认这份前世全宗里的原话；明说的规矩的 quote 必须逐字出现在所引的她的某句话里。
 * - 写成的条目带 past（全宗名），书架上标「前世」；印证照常用冷写记（证据是今生的经历），
 *   印证够 2 次（PAST_OWN）就不再标，算转为自己的；被推翻就照常作废或改写。
 */
import type { EventStore, PsycheEvent } from "../store/events.ts";
import { claimedFonds, PastError } from "../archive/past.ts";

export const PAST_SHELVES = ["fact", "told"] as const;
/** 今生印证几次算转为自己的（同新规律的门槛，reading-room.md §五） */
export const PAST_OWN = 2;

interface Entry {
  shelf?: unknown;
  text?: unknown;
  quote?: unknown;
  about?: unknown;
  cites?: unknown;
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

export function writePastCatalog(store: EventStore, body: { fonds?: unknown; entries?: unknown }): PsycheEvent[] {
  if (typeof body.fonds !== "string") throw new PastError("缺 fonds（前世卷宗的名字）");
  const fonds = body.fonds;
  if (!claimedFonds(store).includes(fonds)) throw new PastError(`${fonds} 还没认领：认领了才能编目`);
  if (!Array.isArray(body.entries) || !body.entries.length) throw new PastError("entries 应为非空数组");

  const planned = (body.entries as Entry[]).map((e, i) => {
    const at = `第 ${i + 1} 条`;
    if (!PAST_SHELVES.includes(e.shelf as never)) throw new PastError(`${at}：前世只能编进 fact（事实）或 told（明说的规矩）`);
    if (!nonEmpty(e.text)) throw new PastError(`${at}缺 text`);
    if (!Array.isArray(e.cites) || !e.cites.length) throw new PastError(`${at}要挂 cites：依据的前世原话档号`);
    const cited = e.cites.map((c) => {
      const ev = typeof c === "string" ? store.byArchiveNo(c.trim().replace(/^\[|\]$/g, "")) : null;
      if (!ev) throw new PastError(`${at}引的 ${String(c)} 查不到`);
      if (ev.fonds !== fonds || !["message.in", "message.out"].includes(ev.kind)) throw new PastError(`${at}引的 ${c} 不是 ${fonds} 的前世原话`);
      return ev;
    });
    if (e.shelf === "told") {
      if (!nonEmpty(e.quote)) throw new PastError(`${at}是明说的规矩，要写 quote：她的原话，逐字`);
      const said = cited.filter((ev) => ev.kind === "message.in").map((ev) => (ev.payload as { text: string }).text);
      if (!said.some((t) => t.includes(e.quote as string))) throw new PastError(`${at}的 quote 在所引的她的话里找不到（要逐字，且引她说的那句）`);
    } else if (e.quote !== undefined) throw new PastError(`${at}：quote 只给明说的规矩`);
    if (e.about !== undefined && !nonEmpty(e.about)) throw new PastError(`${at}的 about 应为非空字符串`);
    return {
      payload: { shelf: e.shelf, text: e.text, ...(nonEmpty(e.quote) ? { quote: e.quote } : {}), ...(nonEmpty(e.about) ? { about: e.about } : {}), past: fonds },
      cited,
    };
  });

  return store.db.transaction(() =>
    planned.map((p) =>
      store.append({
        kind: "semantic.proposed",
        class: "self",
        source: "agent",
        payload: p.payload,
        links: p.cited.map((ev) => ({ to: ev.id, rel: "evidence", props: { past: true } })),
      }),
    ),
  )();
}
