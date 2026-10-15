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
 *   PSYCHE_MODEL     这个 Agent 的模型，出生时没记下的库用它（家里醒来用）
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
import { runHome } from "./home.ts";

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
const app = createApp({ store, projections, token: process.env.PSYCHE_TOKEN, embedder });
Bun.serve({ port, hostname: "127.0.0.1", fetch: app.fetch });
console.log(`Psyche 在 http://127.0.0.1:${port}，数据在 ${dataDir}${embedder ? `，向量：${embedder.model}` : "，没配向量"}`);

// 调度器（m5.md §二）：每分钟判一次；叫醒 = 在家起一个无头会话，跑完记下留下了什么
if (process.env.PSYCHE_SCHEDULER === "1") {
  const model = bornRecord(store)?.model ?? process.env.PSYCHE_MODEL;
  if (!model) console.error("调度器没开：不知道这个 Agent 的模型（出生时没记，也没设 PSYCHE_MODEL）");
  else {
    let running = false;
    setInterval(() => {
      const d = tick(store, { homeRunning: running });
      if (!d || !("wake" in d)) return;
      running = true;
      const { by, note, session, key } = d.wake;
      console.log(`醒来（${by}${note ? `：${note}` : ""}）`);
      runHome({ base: `http://127.0.0.1:${port}`, token: process.env.PSYCHE_TOKEN, model, wake: { by, note, session } })
        .then((run) => {
          const produced = logRun(store, key, run);
          console.log(`家里跑完：${JSON.stringify({ ...run, produced })}`);
        })
        .catch((e) => {
          store.syslog("wake.run", { key, error: String(e) });
          console.error(`家里没跑成：${e instanceof Error ? e.message : e}`);
        })
        .finally(() => (running = false));
    }, 60_000);
    console.log(`调度器开着（${model}）`);
  }
}
