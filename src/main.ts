/**
 * 启动 Psyche 服务：一个进程，每人一个库（P1，notes/design/soma2.md §八.1；谁住在这见 house/residents.ts）。
 *
 * 环境变量：
 *   PSYCHE_DATA_DIR  数据目录（缺省 ~/.psyche/data）：每人一个子目录 <id>/psyche.db，设置在 agents.json
 *   PSYCHE_TOKEN     REST 鉴权（不设 = 不鉴权，只该在本机用）；agents.json 里没单独设 token 的人用它
 *   PSYCHE_TZ        档号日期按哪个时区切（缺省 Asia/Shanghai）
 *   PSYCHE_PORT      端口（缺省 7450）
 *   PSYCHE_EMBED_*   嵌入服务（archive/vectors.ts）；不设 = 只用字面检索。大家共用
 *   PSYCHE_SCHEDULER 设成 1 才开调度器（m5.md §六：缺省关，开着才会醒）；每人一个
 *   PSYCHE_COMMONS   公共文件夹（Soma 的 commons）：屋里人人看得到它的文件变化（m8.md §6.2）；每人的 home 写在 agents.json
 *   PSYCHE_NCM_COOKIE 网易云登录（cookies.json 的路径，Roxy 那份的格式）：全屋共用一个账号放歌（m8.md §三）
 *   只住一个人时给他当缺省（住几个人就写进 agents.json）：
 *   PSYCHE_MODEL     他的模型，出生时没记下的库用它（睡着时整理用）
 *   SOMA_URL         他的家（Soma，如 http://127.0.0.1:30151）：醒来推到这里。不设 = 只做睡着时的整理，不叫醒
 *   PSYCHE_EMAIL     设成 1 才收房子的邮箱（agently-cli，m6.md §〇.1）；AGENTLY_WORKSPACE 缺省 psyche
 */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { EventStore } from "./store/events.ts";
import { Projections } from "./store/projections.ts";
import { experienceProjector } from "./archive/experience.ts";
import { shelfProjector } from "./reading/shelf.ts";
import { createApp } from "./server/app.ts";
import { embedderFromEnv, syncVectors } from "./archive/vectors.ts";
import { logRun, tick } from "./heartbeat/scheduler.ts";
import { asleepWork, BY_NAME } from "./heartbeat/scheduler.ts";
import { getChannels } from "./channel/mailbox.ts";
import { deliverEmail, startEmailWatch, takeHouseEmail, WORKSPACE } from "./channel/email.ts";
import { currentName } from "./self/self.ts";
import type { PsycheEvent } from "./store/events.ts";
import { readResidents, type Resident, type ResidentConfig } from "./house/residents.ts";
import { createHouse } from "./server/house.ts";
import { openHouse, TICK_MS } from "./house/house.ts";

const dataDir = process.env.PSYCHE_DATA_DIR ?? join(homedir(), ".psyche/data");
mkdirSync(dataDir, { recursive: true });

const port = Number(process.env.PSYCHE_PORT ?? 7450);
const embedder = embedderFromEnv();
const residents = readResidents(dataDir);
if (residents.length === 0) console.error(`${dataDir} 里还没住人：建一个 <id>/ 子目录，或写 agents.json`);
const tokens = residents.map((r) => r.config.token).filter(Boolean);
if (new Set(tokens).size < tokens.length) console.error("有人共用一个 token：A 的 token 能进 B 的门。每人在 agents.json 里设自己的");

const apps = new Map<string, (req: Request) => Response | Promise<Response>>();
const viewers: { id: string; store: EventStore }[] = [];
// 屋里别人的库：一起听要跨住户读播放器、记 ear.*（openResident 时还没全开，用到时才查）
const storeOf = (id: string) => viewers.find((v) => v.id === id)?.store;
for (const r of residents) {
  const { app, store } = openResident(r);
  apps.set(r.id, app.fetch);
  viewers.push({ id: r.id, store });
}
// 屋子：每 30 秒看一圈谁变了，记进其他人的库（m8.md §二）
const expand = (p: string) => p.replace(/^~(?=\/)/, homedir());
const places = [
  ...residents.filter((r) => r.config.home).map((r) => ({ label: "home", dir: expand(r.config.home!), owner: r.id })),
  ...(process.env.PSYCHE_COMMONS ? [{ label: "commons", dir: expand(process.env.PSYCHE_COMMONS) }] : []),
];
const houseTokens = residents.map((r) => r.config.token).filter((t): t is string => !!t);
const agentTokens: Record<string, string> = Object.fromEntries(
  residents.map((r) => [r.id, r.config.token]).filter((entry): entry is [string, string] => !!entry[1]),
);
const house = openHouse(dataDir, viewers, Date.now, undefined, places, {
  onAddResident: (r) => {
    const resolved: Resident = { ...r, config: { ...r.config, token: r.config.token ?? process.env.PSYCHE_TOKEN } };
    const { app, store } = openResident(resolved);
    apps.set(r.id, app.fetch);
    if (resolved.config.token && !houseTokens.includes(resolved.config.token)) houseTokens.push(resolved.config.token);
    if (resolved.config.token) agentTokens[resolved.id] = resolved.config.token;
    const v = { id: r.id, store };
    viewers.push(v);
    return v;
  },
});
// 房子的一个邮箱（soma2.md §8.2）：只起一个 +watch，来信按 [名字] / @名字 / 同一话题分，都不是给第一个开了 email 的人
const mailer = residents.find((r) => r.config.email)?.id;
if (mailer) {
  const people = () => viewers.map((v) => ({ id: v.id, store: v.store, name: currentName(v.store) }));
  startEmailWatch(
    {
      take: (m) => {
        for (const r of takeHouseEmail(people(), m, mailer)) if (r.result === "taken") console.log(`收到一封邮件 → ${r.to}`);
      },
      seen: (id) => viewers.some((v) => !!v.store.db.query(`SELECT 1 FROM events WHERE source = 'email' AND idem = ?`).get(`email:${id}`)),
    },
    { onError: (e) => console.error(`收邮件出错：${e.message}`) },
  );
  console.log(`收邮件（agently-cli，workspace ${WORKSPACE}；没 @ 的给 ${mailer}）`);
}
house.tick();
setInterval(() => {
  try {
    house.tick();
  } catch (e) {
    console.error(`屋子看一圈出错：${e instanceof Error ? e.message : e}`);
  }
}, TICK_MS);
Bun.serve({ port, hostname: "127.0.0.1", fetch: createHouse(apps, { tokens: houseTokens, handle: house.handle, agentTokens }) });
console.log(
  `Psyche 在 http://127.0.0.1:${port}，数据在 ${dataDir}，住着 ${residents.map((r) => r.id).join("、") || "（没人）"}${embedder ? `，向量：${embedder.model}` : "，没配向量"}`,
);

/** 一个人的库、app、调度器（邮箱是房子的，见上） */
function openResident({ id, dir, config }: Resident) {
  const tag = residents.length > 1 ? `[${id}] ` : "";
  const store = new EventStore(join(dir, "psyche.db"), { timeZone: process.env.PSYCHE_TZ });
  const projections = new Projections(store);
  projections.register(experienceProjector);
  projections.register(shelfProjector);
  projections.live();

  // 向量不是投影（要调外部服务）：后台慢慢补，失败了下次再补
  if (embedder)
    setInterval(() => {
      syncVectors(store.db, embedder, 256).catch((e) => console.error(`${tag}补向量失败：${e instanceof Error ? e.message : e}`));
    }, 10_000);
  // 写给人的信：按通道设置投递（soma-note 不用做什么——留言页自己读 /v1/mail）
  const outbox = (ev: PsycheEvent) => {
    const to = (ev.payload as { to: string }).to;
    // 住了不止一个人：主动写的信主题前加 [名字]（她认得出是谁，回信也分得回来）
    const tag = residents.length > 1 ? (currentName(store) ?? id) : undefined;
    for (const ch of getChannels(store).channels[to] ?? []) if (ch === "email") void deliverEmail(store, ev, undefined, tag);
  };
  const app = createApp({ store, projections, token: config.token, embedder, outbox, storeOf, selfId: id, residentIds: () => viewers.map((v) => v.id) });

  if (process.env.PSYCHE_SCHEDULER === "1") startScheduler(id, store, config, tag);
  return { app, store };
}

// 调度器（m5.md §二；10-16 家 = Soma）：每人一个，每分钟判一次。醒来推给他的 Soma（同一条会话）；补写、整理、梗概也推给 Soma 另开一段（10-17）
function startScheduler(id: string, store: EventStore, config: ResidentConfig, tag: string) {
  const soma = config.soma?.replace(/\/+$/, "");
  // Soma 里住着几个人：醒来按 id 推到他那条线（Soma residents.ts）
  const wakeUrl = `${soma}/api/line/wake?agent=${encodeURIComponent(id)}`;
  const asleepUrl = `${soma}/api/line/asleep?agent=${encodeURIComponent(id)}`;
  if (!soma) {
    console.error(`${tag}调度器没开：没设家（agents.json 的 soma / SOMA_URL）——醒来和睡着都在 Soma 跑`);
    return;
  }
  let asleep = false;
  // Soma 在不在：不在 = 当它睡着，醒来不推、不记账，等它回来
  const bodyUp = async () => {
    if (!soma) return false;
    try {
      return (await fetch(wakeUrl, { signal: AbortSignal.timeout(3_000) })).ok;
    } catch {
      return false;
    }
  };
  setInterval(async () => {
    const d = tick(store, { asleep, bodyUp: await bodyUp() });
    if (!d || !("wake" in d)) return;
    const { by, note, session, key } = d.wake;
    if (!asleepWork(d.wake)) {
      console.log(`${tag}叫醒（${BY_NAME[by] ?? by}${note ? `：${note}` : ""}）→ Soma`);
      fetch(wakeUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ by, key, ...(note ? { note } : {}) }),
        signal: AbortSignal.timeout(10_000),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
        })
        .catch((e) => {
          store.syslog("wake.run", { key, error: `推给 Soma 没成：${e instanceof Error ? e.message : e}` });
          console.error(`${tag}推给 Soma 没成：${e instanceof Error ? e.message : e}`);
        });
      return;
    }
    asleep = true;
    console.log(`${tag}睡着时${BY_NAME[by] ?? by}${session ? `（${session}）` : ""} → Soma`);
    // Soma 用醒着的同一个身体另开一段，跑完才回（m5.md §三 10-17 改）
    fetch(asleepUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ by, key, ...(note ? { note } : {}), ...(session ? { session } : {}) }),
      signal: AbortSignal.timeout(20 * 60_000),
    })
      .then(async (res) => {
        const run = (await res.json().catch(() => ({}))) as { session?: string; costUsd?: number; ms?: number; error?: string };
        if (!res.ok && !run.session) throw new Error(`${res.status} ${run.error ?? ""}`);
        const produced = logRun(store, key, { session: run.session ?? "", ms: run.ms ?? 0, ...(run.costUsd !== undefined ? { costUsd: run.costUsd } : {}), ...(run.error ? { error: run.error } : {}) });
        console.log(`${tag}整理完：${JSON.stringify({ ...run, produced })}`);
      })
      .catch((e) => {
        store.syslog("wake.run", { key, error: `推给 Soma 没成：${e instanceof Error ? e.message : e}` });
        console.error(`${tag}整理没跑成：${e instanceof Error ? e.message : e}`);
      })
      .finally(() => (asleep = false));
  }, 60_000);
  console.log(`${tag}调度器开着（家在 ${soma}）`);
}
