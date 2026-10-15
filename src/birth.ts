/**
 * 出生（notes/plan/m4.md §一）：冻结初我，只能一次。正式库的创建由 Joy 决定，手动跑。
 * 以后多 Agent（一个 Agent 对应一个模型）时，"添加 Agent" 直接调 self.ts 的 birth()。
 *
 *   PSYCHE_DATA_DIR=~/.psyche/test bun run src/birth.ts [--user <Joy 改过的初我全文文件>]
 *
 * 直接开库写系统日志，不经 REST；Psyche 服务开着也行（每次请求现查系统日志）。
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { EventStore } from "./store/events.ts";
import { birth, SelfError } from "./self/self.ts";

const args = process.argv.slice(2);
const i = args.indexOf("--user");
const userText = i >= 0 ? readFileSync(args[i + 1], "utf8") : undefined;
const dataDir = process.env.PSYCHE_DATA_DIR ?? join(homedir(), ".psyche/data");
const store = new EventStore(join(dataDir, "psyche.db"), { timeZone: process.env.PSYCHE_TZ });
try {
  const b = birth(store, { userText });
  console.log(`出生了（${dataDir}）：初我第 ${b.system.version} 版${b.user ? " + Joy 的改动" : ""}，机制第 ${b.mechanism.version} 版${b.upTo ? "；之前的事件照旧在，出生前的自述改动和名字不算" : ""}。`);
} catch (e) {
  if (!(e instanceof SelfError)) throw e;
  console.error(e.message);
  process.exitCode = 1;
} finally {
  store.close();
}
