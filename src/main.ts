/**
 * 启动 Psyche 服务。
 *
 * 环境变量：
 *   PSYCHE_DATA_DIR  数据目录（缺省 ~/.psyche/data）
 *   PSYCHE_TOKEN     REST 鉴权（不设 = 不鉴权，只该在本机用）
 *   PSYCHE_TZ        档号日期按哪个时区切（缺省 Asia/Shanghai）
 *   PSYCHE_PORT      端口（缺省 7450）
 */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { EventStore } from "./store/events.ts";
import { Projections } from "./store/projections.ts";
import { experienceProjector } from "./archive/experience.ts";
import { shelfProjector } from "./reading/shelf.ts";
import { createApp } from "./server/app.ts";

const dataDir = process.env.PSYCHE_DATA_DIR ?? join(homedir(), ".psyche/data");
mkdirSync(dataDir, { recursive: true });

const store = new EventStore(join(dataDir, "psyche.db"), { timeZone: process.env.PSYCHE_TZ });
const projections = new Projections(store);
projections.register(experienceProjector);
projections.register(shelfProjector);
projections.live();

const port = Number(process.env.PSYCHE_PORT ?? 7450);
const app = createApp({ store, projections, token: process.env.PSYCHE_TOKEN });
Bun.serve({ port, hostname: "127.0.0.1", fetch: app.fetch });
console.log(`Psyche 在 http://127.0.0.1:${port}，数据在 ${dataDir}`);
