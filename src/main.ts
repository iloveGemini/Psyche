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
import { bornRecord } from "./self/self.ts";
import { logRun, tick } from "./heartbeat/scheduler.ts";
import { runAsleep } from "./asleep.ts";
import { asleepWork, BY_NAME } from "./heartbeat/scheduler.ts";
import { getChannels } from "./channel/mailbox.ts";
import { deliverEmail, startEmailWatch, WORKSPACE } from "./channel/email.ts";
import type { PsycheEvent } from "./store/events.ts";
import { readResidents, type Resident, type ResidentConfig } from "./house/residents.ts";
import { createHouse } from "./server/house.ts";

const dataDir = process.env.PSYCHE_DATA_DIR ?? join(homedir(), ".psyche/data");
mkdirSync(dataDir, { recursive: true });

const port = Number(process.env.PSYCHE_PORT ?? 7450);
const embedder = embedderFromEnv();
const residents = readResidents(dataDir);
if (residents.length === 0) console.error(`${dataDir} 里还没住人：建一个 <id>/ 子目录，或写 agents.json`);
const tokens = residents.map((r) => r.config.token).filter(Boolean);
if (new Set(tokens).size < tokens.length) console.error("有人共用一个 token：A 的 token 能进 B 的门。每人在 agents.json 里设自己的");
if (residents.filter((r) => r.config.email).length > 1) console.error("不止一个人收房子的邮箱：按 @ 分信还没做（S6），先只给一个人开");

const apps = new Map<string, (req: Request) => Response | Promise<Response>>();
for (const r of residents) apps.set(r.id, openResident(r).fetch);
Bun.serve({ port, hostname: "127.0.0.1", fetch: createHouse(apps) });
console.log(
  `Psyche 在 http://127.0.0.1:${port}，数据在 ${dataDir}，住着 ${residents.map((r) => r.id).join("、") || "（没人）"}${embedder ? `，向量：${embedder.model}` : "，没配向量"}`,
);

/** 一个人的库、app、调度器、邮箱 */
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
    for (const ch of getChannels(store).channels[to] ?? []) if (ch === "email") void deliverEmail(store, ev);
  };
  const app = createApp({ store, projections, token: config.token, embedder, outbox });

  if (config.email) {
    startEmailWatch(store, { onError: (e) => console.error(`${tag}收邮件出错：${e.message}`) });
    console.log(`${tag}收邮件（agently-cli，workspace ${WORKSPACE}）`);
  }
  if (process.env.PSYCHE_SCHEDULER === "1") startScheduler(id, store, config, tag);
  return app;
}

// 调度器（m5.md §二；10-16 家 = Soma）：每人一个，每分钟判一次。醒来推给他的 Soma（同一条会话）；补写、整理在睡着时另起无头会话
function startScheduler(id: string, store: EventStore, config: ResidentConfig, tag: string) {
  const model = bornRecord(store)?.model ?? config.model;
  const soma = config.soma?.replace(/\/+$/, "");
  // Soma 里住着几个人：醒来按 id 推到他那条线（Soma residents.ts）
  const wakeUrl = `${soma}/api/line/wake?agent=${encodeURIComponent(id)}`;
  if (!model) {
    console.error(`${tag}调度器没开：不知道他的模型（出生时没记，agents.json 里也没写 model）`);
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
    console.log(`${tag}睡着时${BY_NAME[by] ?? by}${session ? `（${session}）` : ""}`);
    runAsleep({ base: `http://127.0.0.1:${port}`, agent: id, token: config.token, model, wake: { by, note, session } })
      .then((run) => {
        const produced = logRun(store, key, run);
        console.log(`${tag}整理完：${JSON.stringify({ ...run, produced })}`);
      })
      .catch((e) => {
        store.syslog("wake.run", { key, error: String(e) });
        console.error(`${tag}整理没跑成：${e instanceof Error ? e.message : e}`);
      })
      .finally(() => (asleep = false));
  }, 60_000);
  console.log(`${tag}调度器开着（${model}${soma ? `，家在 ${soma}` : "，没设家：只做睡着时的整理"}）`);
}
