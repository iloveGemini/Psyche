/**
 * 常驻：每 30 秒看一眼这台 Mac（Joy 开放了的那几样），每 30 分钟看一眼天气，变了就报给 Psyche（`POST /v1/house/percept`，全屋）。
 * 读不读：Joy 给每个住户各自开放（Psyche 设置 `mac`，`GET /v1/house/mac`）——有一个人被开放了才读；记给谁，Psyche 按开放的分。
 * 住户各自收不收、递不递，归他们自己的感知设置（m8.md §6.4）。天气看哪儿在 `~/.psyche/mac.json`（config.ts）。
 *
 *   bun mcp/mac/feed.ts            常驻
 *   bun mcp/mac/feed.ts --once     看一圈就退（试跑）
 *
 * 环境变量：PSYCHE_URL（缺省 http://127.0.0.1:7450）、PSYCHE_TOKEN_FILE（全屋任何一个住户的 token）、PSYCHE_MAC_CONFIG。
 * 状态只在内存：重启后第一圈照常报一遍，Psyche 那边读数没变的不记。
 */
import { anyGranted, readConfig, token, type Grant } from "./config.ts";
import { fetchWeather, readMac, step, weatherStep, type FeedState, type Report, type WeatherState } from "./sense.ts";

const URL_ = process.env.PSYCHE_URL || "http://127.0.0.1:7450";
const TICK_MS = 30_000;
const WEATHER_MS = 30 * 60_000;

const auth = (): Record<string, string> => {
  const t = token();
  return t ? { authorization: `Bearer ${t}` } : {};
};

/** 全屋给谁开放了什么；问不到就当都没开（不读） */
async function grants(): Promise<Record<string, Grant>> {
  try {
    const res = await fetch(`${URL_}/v1/house/mac`, { headers: auth(), signal: AbortSignal.timeout(5000) });
    return res.ok ? ((await res.json()) as { grants: Record<string, Grant> }).grants : {};
  } catch {
    return {};
  }
}

async function send(r: Report): Promise<void> {
  try {
    const res = await fetch(`${URL_}/v1/house/percept`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth() },
      body: JSON.stringify(r),
      signal: AbortSignal.timeout(5000),
    });
    const body = await res.text();
    console.log(`${new Date().toISOString()} ${r.sensor}:${r.subject} ${r.text} → ${res.status} ${body}`);
  } catch (e) {
    console.error(`${new Date().toISOString()} 报不出去（${e instanceof Error ? e.message : e}）：${r.text}`);
  }
}

const state: FeedState = {};
const weather: WeatherState = {};
let weatherAt = 0;

async function tick(now = Date.now()) {
  const cfg = readConfig();
  const open = anyGranted(await grants());
  for (const r of step(state, readMac(open), open)) await send(r);
  if (cfg.weather && now - weatherAt >= WEATHER_MS) {
    weatherAt = now;
    const w = await fetchWeather(cfg.weather.latitude, cfg.weather.longitude);
    const r = w && weatherStep(weather, w, cfg.weather.place, now, WEATHER_MS);
    if (r) await send(r);
  }
}

if (process.argv.includes("--once")) {
  // 应用要连着两圈才报：试跑时隔一下再看一圈
  await tick();
  await new Promise((r) => setTimeout(r, 2000));
  await tick();
} else {
  console.log(`看这台 Mac，报给 ${URL_}；给谁开放了哪几样看 Psyche 的设置，天气看 ${process.env.PSYCHE_MAC_CONFIG || "~/.psyche/mac.json"}`);
  await tick();
  setInterval(() => void tick(), TICK_MS);
}
