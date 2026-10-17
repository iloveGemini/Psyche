/**
 * 出生（notes/plan/m4.md §一，10-17 改）：冻结初我（v3 是空的，自述由它自己写），只能一次。正式库的创建由 Joy 决定，手动跑。
 * Joy 出生那天的信：缺省读 letters/birth.md（去掉注释后空的就不递），--letter 指定别的文件。
 * 调度器开着时，出生后会另开一段让它自己看看、写不写自述由它（m4.md、m5.md §三）。
 *
 *   PSYCHE_DATA_DIR=~/.psyche/test bun run src/birth.ts --model claude-opus-5-5 [--agent a3] [--letter <文件>] [--user <Joy 改过的初我全文文件>]
 *
 * 直接开库写系统日志，不经 REST；Psyche 服务开着也行（每次请求现查系统日志）。
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { EventStore } from "./store/events.ts";
import { birth, letterText, SelfError } from "./self/self.ts";

const args = process.argv.slice(2);
const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const userText = opt("--user") ? readFileSync(opt("--user")!, "utf8") : undefined;
const model = opt("--model");
if (!model) throw new Error("要 --model：一个模型 = 一个 Agent，出生时记下它是谁（m5.md §三）");
const letterFile = opt("--letter") ?? join(import.meta.dir, "..", "letters", "birth.md");
if (opt("--letter") && !existsSync(letterFile)) throw new Error(`没有这封信：${letterFile}`);
const letter = existsSync(letterFile) ? letterText(readFileSync(letterFile, "utf8")) : "";
const dataDir = process.env.PSYCHE_DATA_DIR ?? join(homedir(), ".psyche/data");
// 一个房子住几个人：<数据目录>/<id>/psyche.db（house/residents.ts）
const agent = opt("--agent");
const store = new EventStore(agent ? join(dataDir, agent, "psyche.db") : join(dataDir, "psyche.db"), { timeZone: process.env.PSYCHE_TZ });
try {
  const b = birth(store, { userText, model, letter });
  console.log(
    `出生了（${dataDir}${agent ? `/${agent}` : ""}）：${b.model}，初我第 ${b.system.version} 版${b.user ? " + Joy 的改动" : ""}，机制第 ${b.mechanism.version} 版${letter ? "；Joy 的信已放进收件箱" : "；没有信"}${b.upTo ? "；之前的事件照旧在，出生前的自述改动和名字不算" : ""}。`,
  );
} catch (e) {
  if (!(e instanceof SelfError)) throw e;
  console.error(e.message);
  process.exitCode = 1;
} finally {
  store.close();
}
