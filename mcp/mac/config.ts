/**
 * Joy 开放了哪些（她定的，住户改不了）：`~/.psyche/mac.json`，每次读都现读，改了下一圈生效。
 * 没有这个文件 / 没写的项 = 关。关了的不读——不是读了再藏。
 *
 *   {
 *     "desk": true,        // 键鼠多久没动、屏幕锁没锁
 *     "app": true,         // 前台是哪个应用（只在没锁屏、键鼠刚动过时读；只读名字，不读窗口标题）
 *     "screen": false,     // 看一眼屏幕（住户调 look_at_screen 时截一张）
 *     "weather": { "latitude": 31.23, "longitude": 121.47, "place": "上海" }   // 不写 = 不报天气
 *   }
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface MacConfig {
  desk: boolean;
  app: boolean;
  screen: boolean;
  weather?: { latitude: number; longitude: number; place: string };
}

export const CONFIG_FILE = process.env.PSYCHE_MAC_CONFIG || join(homedir(), ".psyche", "mac.json");

export function readConfig(file = CONFIG_FILE): MacConfig {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    // 没有文件或写坏了：全关
  }
  const w = raw.weather as { latitude?: unknown; longitude?: unknown; place?: unknown } | undefined;
  const weather =
    w && typeof w.latitude === "number" && typeof w.longitude === "number"
      ? { latitude: w.latitude, longitude: w.longitude, place: typeof w.place === "string" && w.place.trim() ? w.place.trim() : "外面" }
      : undefined;
  return { desk: raw.desk === true, app: raw.app === true, screen: raw.screen === true, ...(weather ? { weather } : {}) };
}
