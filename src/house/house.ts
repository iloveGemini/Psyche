/**
 * 屋子（m8.md §二、dashboard.md §4.2.1）：每 30 秒看一圈谁变了；Joy 在不在家、她的个签记在这里，不进谁的库。
 *
 * - Joy 的 Soma 页面有动静就报一声（POST /v1/house/joy/seen）；只留最后一次的时刻，不存明细。
 * - 她的个签存 <数据目录>/house.json（重启不丢）；变了下一圈作为 percept 进其他人的库。
 * - GET /v1/house：此刻全屋的样子（给 Soma 和 Dashboard 显示），现算。
 * - POST /v1/house/residents：添加新住户或为未出生的住户触发 birth()，热挂载入屋。
 * - POST /v1/house/percept：地方报来的外头的事实（m8.md §6.3），记进收件人的库。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { houseTick, joyPresence, presenceOf, JOY, MOOD_MAX, type Viewer } from "./presence.ts";
import { birth, currentName, letterText, nameSelf, SelfError, type BornDetail } from "../self/self.ts";
import { readLetter, registerResident } from "./add.ts";
import { renameResidentFiles } from "./rename.ts";
import { nowPlaying } from "../perception/sound.ts";
import { netease, type MusicSource } from "../perception/netease.ts";
import { filesTick, loadSnaps, saveSnaps, type Place } from "./files.ts";
import { PerceptError, recordPercept } from "../perception/outside.ts";
import { getSettings } from "../heartbeat/schedule.ts";
import { budgetUsedToday, nextWake } from "../heartbeat/scheduler.ts";
import { pulseOf } from "../reading/health.ts";
import { ID_PATTERN, type Resident, type ResidentConfig } from "./residents.ts";
import { EventStore } from "../store/events.ts";
import { Projections } from "../store/projections.ts";
import { experienceProjector } from "../archive/experience.ts";
import { shelfProjector } from "../reading/shelf.ts";

export const TICK_MS = 30_000;

export interface HouseOptions {
  promptsDir?: string;
  /** 新建住户时由宿主挂载 app 与调度器；缺省直接开库挂进 viewers */
  onAddResident?: (r: Resident) => Viewer;
  /** 改 id 时由宿主重开并替换内存里的 app 与 viewer */
  onRenameResident?: (from: string, to: string, config: ResidentConfig) => Viewer;
}

export function openHouse(
  dataDir: string,
  residents: Viewer[],
  now: () => number = Date.now,
  music: MusicSource = netease,
  places: Place[] = [],
  opts: HouseOptions = {},
) {
  const storeOf = (id: string) => residents.find((r) => r.id === id)?.store;
  const file = join(dataDir, "house.json");
  const saved = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { joyMood?: string }) : {};
  const joy: { lastSeen?: number; mood?: string } = { mood: saved.joyMood || undefined };
  const save = () => writeFileSync(file, JSON.stringify({ joyMood: joy.mood ?? "" }, null, 2));

  // 屋里的东西（m8.md §6.2）：home、commons 的文件变化；快照存着，重启不丢
  const snapFile = join(dataDir, "files.json");
  const snaps = loadSnaps(snapFile);
  const tick = () => {
    const n = houseTick(residents, joy, now());
    if (places.length) {
      filesTick(residents, places, snaps, now());
      saveSnaps(snapFile, snaps);
    }
    return n;
  };

  const residentSummary = (r: Viewer, t: number) => {
    const bornLog = r.store.readSyslog({ kind: "born", limit: 1 })[0] as { at: number; detail: BornDetail } | undefined;
    const born = bornLog ? { at: bornLog.at, ...(bornLog.detail.model ? { model: bornLog.detail.model } : {}) } : null;
    const settings = getSettings(r.store);
    const next = nextWake(r.store);
    const wake = {
      paused: settings.paused,
      heartbeat: settings.heartbeat,
      budget: { used: budgetUsedToday(r.store), of: settings.wakeBudget },
      next: next ? { by: next.by, due: next.due!, ...(next.note ? { note: next.note } : {}) } : null,
    };
    return {
      id: r.id,
      name: currentName(r.store) ?? r.id,
      ...presenceOf(r.store, t),
      born,
      wake,
      pulse: pulseOf(r.store),
    };
  };

  const handle = async (req: Request): Promise<Response> => {
    const path = new URL(req.url).pathname;
    if (req.method === "GET" && path === "/v1/house") {
      const t = now();
      return Response.json({
        residents: residents.map((r) => residentSummary(r, t)),
        joy: joyPresence(residents.map((r) => r.store), joy, t),
      });
    }
    if (req.method === "GET" && path === "/v1/house/feed") {
      const limit = Math.min(Math.max(1, Number(new URL(req.url).searchParams.get("limit") || 40)), 100);
      const items: Array<{
        residentId: string;
        residentName: string;
        id: string;
        at: number;
        kind: string;
        archiveNo: string;
        payload: any;
      }> = [];
      for (const r of residents) {
        const name = currentName(r.store) ?? r.id;
        const rows = r.store.db
          .query(
            `SELECT id, at, kind, day, seq, payload FROM events
             WHERE kind IN ('woke', 'slept', 'coldwrite.done', 'mail.in', 'mail.out', 'semantic.proposed', 'semantic.revised', 'episode', 'mood.set', 'room.entered', 'named', 'thread.opened', 'thread.closed')
             ORDER BY at DESC LIMIT ?`,
          )
          .all(limit) as { id: string; at: number; kind: string; day: string; seq: number; payload: string }[];
        for (const row of rows) {
          items.push({
            residentId: r.id,
            residentName: name,
            id: row.id,
            at: row.at,
            kind: row.kind,
            archiveNo: `${row.day}#${row.seq}`,
            payload: JSON.parse(row.payload || "{}"),
          });
        }
      }
      items.sort((a, b) => b.at - a.at);
      return Response.json({ feed: items.slice(0, limit) });
    }
    if (req.method === "POST" && path === "/v1/house/residents") {
      const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      const id = typeof b?.id === "string" ? b.id.trim() : "";
      if (!ID_PATTERN.test(id)) {
        return Response.json({ error: "id 格式不对（小写字母、数字、- _，最多 32 位）" }, { status: 400 });
      }
      const model = typeof b?.model === "string" ? b.model.trim() : "";
      if (!model) {
        return Response.json({ error: "要填 model（一个模型 = 一个 Agent）" }, { status: 400 });
      }
      const userText = typeof b?.userText === "string" ? b.userText : undefined;
      const str = (k: string) => (typeof b?.[k] === "string" && (b[k] as string).trim() ? (b[k] as string).trim() : undefined);
      // 出生那天的信：给了用给的（空字符串 = 不递），没给读 letters/birth.md
      const letter = typeof b?.letter === "string" ? letterText(b.letter) : readLetter();
      let config: ResidentConfig;
      try {
        config = registerResident(dataDir, { id, model, soma: str("soma"), home: str("home"), token: str("token"), ...(typeof b?.email === "boolean" ? { email: b.email } : {}), ...(Array.isArray(b?.past) ? { past: b.past } : {}) });
      } catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
      }

      let viewer = residents.find((r) => r.id === id);
      if (!viewer) {
        const dir = join(dataDir, id);
        mkdirSync(dir, { recursive: true });
        if (opts.onAddResident) {
          viewer = opts.onAddResident({ id, dir, config });
          if (!residents.some((r) => r.id === id)) residents.push(viewer);
        } else {
          const store = new EventStore(join(dir, "psyche.db"), { now });
          const p = new Projections(store);
          p.register(experienceProjector);
          p.register(shelfProjector);
          p.live();
          viewer = { id, store };
          residents.push(viewer);
        }
      }

      try {
        const res = birth(viewer.store, { model, userText, letter, promptsDir: opts.promptsDir });
        return Response.json({
          id,
          born: {
            model,
            systemVersion: res.system.version,
            hasUserDiff: !!res.user,
            mechanismVersion: res.mechanism.version,
            letter: !!letter,
          },
        });
      } catch (e) {
        if (e instanceof SelfError) return Response.json({ error: e.message }, { status: 400 });
        throw e;
      }
    }
    if (req.method === "POST" && path === "/v1/house/residents/rename") {
      const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      const from = typeof b?.from === "string" ? b.from.trim() : "";
      const to = typeof b?.to === "string" && b.to.trim() ? b.to.trim() : from;
      const name = typeof b?.name === "string" && b.name.trim() ? b.name.trim() : undefined;
      const why = typeof b?.why === "string" && b.why.trim() ? b.why.trim() : undefined;
      const home = typeof b?.home === "string" && b.home.trim() ? b.home.trim() : undefined;
      if (!ID_PATTERN.test(from)) return Response.json({ error: "原 id 格式不对" }, { status: 400 });
      if (!ID_PATTERN.test(to)) return Response.json({ error: "新 id 格式不对" }, { status: 400 });
      const idx = residents.findIndex((r) => r.id === from);
      if (idx < 0) return Response.json({ error: `屋里没有 ${from}` }, { status: 404 });
      let viewer = residents[idx];
      if (from !== to) {
        try {
          viewer.store.close();
          const config = renameResidentFiles(dataDir, { from, to, home });
          if (opts.onRenameResident) {
            viewer = opts.onRenameResident(from, to, config);
            residents[idx] = viewer;
          } else {
            const store = new EventStore(join(dataDir, to, "psyche.db"), { now });
            const p = new Projections(store);
            p.register(experienceProjector);
            p.register(shelfProjector);
            p.live();
            viewer = { id: to, store };
            residents[idx] = viewer;
          }
          // 同步迁移各住户库里旧 id 的 presence 感知对象，避免 <now> 残留旧 id
          for (const r of residents) {
            try {
              r.store.db.exec("DROP TRIGGER IF EXISTS events_no_update;");
              r.store.db
                .query(`UPDATE events SET payload = json_set(payload, '$.subject', ?) WHERE kind = 'percept' AND json_extract(payload, '$.subject') = ?`)
                .run(to, from);
              r.store.db.exec("CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'events 只追加，不可修改'); END;");
            } catch {}
          }
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
        }
      }
      let named: { name: string; archiveNo: string } | undefined;
      if (name) {
        try {
          named = nameSelf(viewer.store, { name, why: why ?? (from !== to ? `改 id ${from} → ${to}` : "改名") });
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
        }
      }
      return Response.json({ from, to: viewer.id, name: currentName(viewer.store) ?? viewer.id, ...(named ? { archiveNo: named.archiveNo } : {}) });
    }
    // 外头来的事实（m8.md §6.3）：地方收进来报到这里，存和递在 Psyche
    if (req.method === "POST" && path === "/v1/house/percept") {
      const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!b || typeof b !== "object") return Response.json({ error: "要 JSON 对象" }, { status: 400 });
      try {
        return Response.json(recordPercept(residents, b, now()));
      } catch (e) {
        if (e instanceof PerceptError) return Response.json({ error: e.message }, { status: 400 });
        throw e;
      }
    }
    if (req.method === "POST" && path === "/v1/house/joy/seen") {
      joy.lastSeen = now();
      return Response.json({ ok: true });
    }
    if (req.method === "POST" && path === "/v1/house/joy/mood") {
      const b = (await req.json().catch(() => null)) as { text?: unknown } | null;
      if (typeof b?.text !== "string") return Response.json({ error: "text 应为字符串（空串 = 清空）" }, { status: 400 });
      const text = b.text.trim();
      if (Array.from(text).length > MOOD_MAX) return Response.json({ error: `个签最多 ${MOOD_MAX} 字` }, { status: 400 });
      joy.mood = text || undefined;
      save();
      tick();
      return Response.json({ mood: joy.mood ?? null });
    }
    // 分一只耳机（m8.md §3.3）：Joy 在 Soma 页面上戴上 / 摘下某人的
    if (req.method === "POST" && path === "/v1/house/listen") {
      const b = (await req.json().catch(() => null)) as { host?: unknown; on?: unknown; who?: unknown } | null;
      // 谁戴的由 Soma 页面说（?viewer=，缺省 Joy）；不替人认领（10-16 a1：测试时点的按钮被记成了 Joy）
      const who = typeof b?.who === "string" && b.who.trim() ? b.who.trim().slice(0, 40) : JOY;
      const host = typeof b?.host === "string" ? storeOf(b.host) : undefined;
      if (!host) return Response.json({ error: "屋里没有这个人" }, { status: 404 });
      host.append({ kind: b!.on === false ? "ear.left" : "ear.joined", class: "experience", source: "house", situation: null, payload: { who } });
      return Response.json({ ok: true });
    }
    // 某人此刻在放什么、放到哪、能放的地址（Soma 照这个真的出声）
    const m = path.match(/^\/v1\/house\/playing\/([^/]+)$/);
    if (req.method === "GET" && m) {
      const s = storeOf(decodeURIComponent(m[1]));
      if (!s) return Response.json({ error: "屋里没有这个人" }, { status: 404 });
      const p = nowPlaying(s, now());
      if (!p) return Response.json({ track: null });
      return Response.json({ track: p.track, pos: p.pos, url: (await music.url(p.track.id).catch(() => undefined)) ?? null });
    }
    return Response.json({ error: "没有这个口子" }, { status: 404 });
  };

  return { joy, tick, handle, who: JOY };
}
