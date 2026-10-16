/**
 * 冷写里的观察（m8.md §4.2）：它当场记下的 notice，和**后来**同样的环境又出现时发生的事摆在一起。
 *
 * 系统只摆、不判：同一首歌后来又响了几次、那时它写了什么（情节 / 观察）；观察的是某个住户 / Joy，就摆那人后来的样子（在场变化、放的歌）。
 * 归纳成规律由它写（coldwrite 引这些档号当证据）。被书架条目引过的观察就不再摆（已经用上了）；60 天前的也不摆。
 */
import type { EventStore, PsycheEvent } from "../store/events.ts";
import { displayArchiveNo } from "../store/events.ts";
import { localDay, wallClock } from "../core/time.ts";
import { hearings, type Env } from "../perception/env.ts";
import { describe as describePresence, type Presence } from "../house/presence.ts";
import type { Track } from "../perception/netease.ts";

export interface Observation {
  archiveNo: string;
  at: number;
  text: string;
  about?: string;
  env: Env;
  later: { archiveNo?: string; at: number; text: string }[];
}

const DAY = 86_400_000;
const MAX_LATER = 8;
const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (at: number, tz: string) => {
  const w = wallClock(at, tz);
  return `${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)}`;
};

export function observationsFor(store: EventStore, upTo: string, storeOf?: (id: string) => EventStore | undefined): Observation[] {
  const now = store.now();
  const tz = store.timeZone;
  const year = Number(localDay(now, tz).slice(0, 4));
  const used = new Set(
    (store.db
      .query(`SELECT l.to_id AS id FROM links l JOIN events e ON e.id = l.from_id WHERE e.kind LIKE 'semantic.%' AND l.rel = 'evidence'`)
      .all() as { id: string }[]).map((r) => r.id),
  );
  const notices = store.list({ kinds: ["notice"], fonds: "", limit: 100_000 }).filter((n) => n.id <= upTo && !used.has(n.id) && now - n.at < 60 * DAY);
  const written = (from: number, to: number) =>
    store
      .list({ kinds: ["episode", "notice"], fonds: "", limit: 100_000 })
      .filter((e) => e.at >= from - 10 * 60_000 && e.at <= to + 10 * 60_000)
      .map((e) => ({ archiveNo: displayArchiveNo(e.archiveNo, year), at: e.at, text: (e.payload as { text: string }).text }));

  return notices.map((n) => {
    const p = n.payload as { text: string; about?: string; env?: Env };
    const env = p.env ?? { tracks: [], people: [] };
    const later: Observation["later"] = [];

    // 同一首歌后来又响起：每次一行，带那时写下的
    for (const t of env.tracks) {
      // 记下观察时正在放的那一遍不算"又听到"
      for (const h of hearings(store, t.id, n.at, now, storeOf).filter((h) => h.began > n.at)) {
        later.push({ at: h.from, text: `又听到《${t.title}》${t.artist}（${stamp(h.from, tz)}–${stamp(h.to, tz).slice(6)}）` });
        for (const w of written(h.from, h.to).filter((w) => w.archiveNo !== displayArchiveNo(n.archiveNo, year))) later.push({ ...w, text: `  那时：${w.text}` });
      }
    }

    // 观察的是某个人：他后来的样子（在场变化；住户的话还有他放的歌）
    if (p.about && p.about !== "self") {
      const seen = store
        .list({ kinds: ["percept"], fonds: "", limit: 100_000 })
        .filter((e) => e.at > n.at && (e.payload as { subject?: string }).subject === p.about)
        .slice(-MAX_LATER)
        .map((e) => {
          const q = e.payload as { subject: string; name: string; value: Presence };
          return { at: e.at, text: `${stamp(e.at, tz)} ${describePresence(q.subject, q.name, q.value)}` };
        });
      later.push(...seen);
      const theirs = storeOf?.(p.about);
      if (theirs)
        for (const ev of theirs.list({ kinds: ["played"], fonds: "", limit: 100_000 }).filter((e: PsycheEvent) => e.at > n.at).slice(-MAX_LATER)) {
          const ts = (ev.payload as { tracks: Track[]; playlist?: string }).tracks;
          const pl = (ev.payload as { playlist?: string }).playlist;
          later.push({ at: ev.at, text: `${stamp(ev.at, tz)} ${p.about} 放了${pl ? `歌单「${pl}」，从` : ""}《${ts[0]?.title}》${ts[0]?.artist ?? ""}` });
        }
    }

    return { archiveNo: displayArchiveNo(n.archiveNo, year), at: n.at, text: p.text, ...(p.about ? { about: p.about } : {}), env, later: later.slice(-MAX_LATER * 2) };
  });
}
