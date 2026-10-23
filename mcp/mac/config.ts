/**
 * 这一路的配置。
 *
 * - 给谁开放哪几样（键鼠与锁屏 desk、前台应用 app、看屏幕 screen）是 Joy 给**每个住户各自**的，存在 Psyche 那个人的设置里
 *   （`mac`，m8.md §6.5；她在 dashboard 上改），这里不管。
 * - 这里只有全屋共用的：天气看哪儿。`~/.psyche/mac.json`，每次现读：
 *     { "weather": { "latitude": 29.48, "longitude": 106.48, "place": "重庆大渡口" } }   // 不写 = 不报天气
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface MacConfig {
  weather?: { latitude: number; longitude: number; place: string };
}
export interface Grant {
  desk: boolean;
  app: boolean;
  screen: boolean;
}

export const CONFIG_FILE = process.env.PSYCHE_MAC_CONFIG || join(homedir(), ".psyche", "mac.json");

export function readConfig(file = CONFIG_FILE): MacConfig {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    // 没有文件或写坏了：不报天气
  }
  const w = raw.weather as { latitude?: unknown; longitude?: unknown; place?: unknown } | undefined;
  return w && typeof w.latitude === "number" && typeof w.longitude === "number"
    ? { weather: { latitude: w.latitude, longitude: w.longitude, place: typeof w.place === "string" && w.place.trim() ? w.place.trim() : "外面" } }
    : {};
}

/** 全屋有没有人被开放了这一样：有一个就读，一个都没有就不读（关了的不读，不是读了再藏） */
export function anyGranted(grants: Record<string, Grant>): { desk: boolean; app: boolean } {
  const all = Object.values(grants);
  return { desk: all.some((g) => g.desk), app: all.some((g) => g.app) };
}

/** 读 token：PSYCHE_TOKEN_FILE 优先，再 PSYCHE_TOKEN */
export function token(): string | undefined {
  const file = process.env.PSYCHE_TOKEN_FILE;
  if (file)
    try {
      return readFileSync(file, "utf8").trim() || undefined;
    } catch {
      return undefined;
    }
  return process.env.PSYCHE_TOKEN || undefined;
}
