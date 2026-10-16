/**
 * 屋子（m8.md §二）：每 30 秒看一圈谁变了；Joy 在不在家、她的个签记在这里，不进谁的库。
 *
 * - Joy 的 Soma 页面有动静就报一声（POST /v1/house/joy/seen）；只留最后一次的时刻，不存明细。
 * - 她的个签存 <数据目录>/house.json（重启不丢）；变了下一圈作为 percept 进其他人的库。
 * - GET /v1/house：此刻全屋的样子（给 Soma 显示），现算。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { houseTick, joyPresence, presenceOf, JOY, MOOD_MAX, type Viewer } from "./presence.ts";
import { currentName } from "../self/self.ts";
import { nowPlaying } from "../perception/sound.ts";
import { netease, type MusicSource } from "../perception/netease.ts";
import { filesTick, loadSnaps, saveSnaps, type Place } from "./files.ts";

export const TICK_MS = 30_000;

export function openHouse(dataDir: string, residents: Viewer[], now: () => number = Date.now, music: MusicSource = netease, places: Place[] = []) {
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

  const handle = async (req: Request): Promise<Response> => {
    const path = new URL(req.url).pathname;
    if (req.method === "GET" && path === "/v1/house") {
      const t = now();
      return Response.json({
        residents: residents.map((r) => ({ id: r.id, name: currentName(r.store) ?? r.id, ...presenceOf(r.store, t) })),
        joy: joyPresence(residents.map((r) => r.store), joy, t),
      });
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
