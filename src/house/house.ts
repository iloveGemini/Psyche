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

export const TICK_MS = 30_000;

export function openHouse(dataDir: string, residents: Viewer[], now: () => number = Date.now) {
  const file = join(dataDir, "house.json");
  const saved = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { joyMood?: string }) : {};
  const joy: { lastSeen?: number; mood?: string } = { mood: saved.joyMood || undefined };
  const save = () => writeFileSync(file, JSON.stringify({ joyMood: joy.mood ?? "" }, null, 2));

  const tick = () => houseTick(residents, joy, now());

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
    return Response.json({ error: "没有这个口子" }, { status: 404 });
  };

  return { joy, tick, handle, who: JOY };
}
