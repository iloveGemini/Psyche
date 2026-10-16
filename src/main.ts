/**
 * 启动 Psyche 服务。
 *
 * 环境变量：
 *   PSYCHE_DATA_DIR  数据目录（缺省 ~/.psyche/data）
 *   PSYCHE_TOKEN     REST 鉴权（不设 = 不鉴权，只该在本机用）
 *   PSYCHE_TZ        档号日期按哪个时区切（缺省 Asia/Shanghai）
 *   PSYCHE_PORT      端口（缺省 7450）
 *   PSYCHE_EMBED_*   嵌入服务（archive/vectors.ts）；不设 = 只用字面检索
 *   PSYCHE_SCHEDULER 设成 1 才开调度器（m5.md §六：缺省关，开着才会醒）
 *   PSYCHE_MODEL     这个 Agent 的模型，出生时没记下的库用它（睡着时整理用）
 *   SOMA_URL         它的家（Soma，如 http://127.0.0.1:30151）：醒来推到这里。不设 = 只做睡着时的整理，不叫醒
 *   PSYCHE_EMAIL     设成 1 才收它自己的邮箱（agently-cli，m6.md §〇.1）；AGENTLY_WORKSPACE 缺省 psyche
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

const dataDir = process.env.PSYCHE_DATA_DIR ?? join(homedir(), ".psyche/data");
mkdirSync(dataDir, { recursive: true });

const store = new EventStore(join(dataDir, "psyche.db"), { timeZone: process.env.PSYCHE_TZ });
const projections = new Projections(store);
projections.register(experienceProjector);
projections.register(shelfProjector);
projections.live();

const port = Number(process.env.PSYCHE_PORT ?? 7450);
const embedder = embedderFromEnv();
// 向量不是投影（要调外部服务）：后台慢慢补，失败了下次再补
if (embedder)
  setInterval(() => {
    syncVectors(store.db, embedder, 256).catch((e) => console.error(`补向量失败：${e instanceof Error ? e.message : e}`));
  }, 10_000);
// 写给人的信：按通道设置投递（soma-note 不用做什么——留言页自己读 /v1/mail）
const outbox = (ev: PsycheEvent) => {
  const to = (ev.payload as { to: string }).to;
  for (const ch of getChannels(store).channels[to] ?? []) if (ch === "email") void deliverEmail(store, ev);
};
const app = createApp({ store, projections, token: process.env.PSYCHE_TOKEN, embedder, outbox });
Bun.serve({ port, hostname: "127.0.0.1", fetch: app.fetch });
console.log(`Psyche 在 http://127.0.0.1:${port}，数据在 ${dataDir}${embedder ? `，向量：${embedder.model}` : "，没配向量"}`);

if (process.env.PSYCHE_EMAIL === "1") {
  startEmailWatch(store, { onError: (e) => console.error(`收邮件出错：${e.message}`) });
  console.log(`收邮件（agently-cli，workspace ${WORKSPACE}）`);
}

// 调度器（m5.md §二；10-16 家 = Soma）：每分钟判一次。醒来推给 Soma（同一条会话）；补写、整理在睡着时另起无头会话
if (process.env.PSYCHE_SCHEDULER === "1") {
  const model = bornRecord(store)?.model ?? process.env.PSYCHE_MODEL;
  const soma = process.env.SOMA_URL?.replace(/\/+$/, "");
  if (!model) console.error("调度器没开：不知道这个 Agent 的模型（出生时没记，也没设 PSYCHE_MODEL）");
  else {
    let asleep = false;
    // Soma 在不在：不在 = 当它睡着，醒来不推、不记账，等它回来
    const bodyUp = async () => {
      if (!soma) return false;
      try {
        return (await fetch(`${soma}/api/line/wake`, { signal: AbortSignal.timeout(3_000) })).ok;
      } catch {
        return false;
      }
    };
    setInterval(async () => {
      const d = tick(store, { asleep, bodyUp: await bodyUp() });
      if (!d || !("wake" in d)) return;
      const { by, note, session, key } = d.wake;
      if (!asleepWork(d.wake)) {
        console.log(`叫醒（${BY_NAME[by] ?? by}${note ? `：${note}` : ""}）→ Soma`);
        fetch(`${soma}/api/line/wake`, {
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
            console.error(`推给 Soma 没成：${e instanceof Error ? e.message : e}`);
          });
        return;
      }
      asleep = true;
      console.log(`睡着时${BY_NAME[by] ?? by}${session ? `（${session}）` : ""}`);
      runAsleep({ base: `http://127.0.0.1:${port}`, token: process.env.PSYCHE_TOKEN, model, wake: { by, note, session } })
        .then((run) => {
          const produced = logRun(store, key, run);
          console.log(`整理完：${JSON.stringify({ ...run, produced })}`);
        })
        .catch((e) => {
          store.syslog("wake.run", { key, error: String(e) });
          console.error(`整理没跑成：${e instanceof Error ? e.message : e}`);
        })
        .finally(() => (asleep = false));
    }, 60_000);
    console.log(`调度器开着（${model}${soma ? `，家在 ${soma}` : "，没设 SOMA_URL：只做睡着时的整理"}）`);
  }
}
