/**
 * 全套自动给住户改 id / 改名字（Psyche + Soma + 房间记录 + 议题 + Claude 会话目录）：
 *
 *   bun scripts/rename-resident.ts --from roy --to a3 --name "Argon" --data-dir ~/.psyche/data --soma-home ~/.soma
 *   bun scripts/rename-resident.ts --from a3 --name "小三" --data-dir ~/.psyche/data --soma-home ~/.soma   # 只改显示名，不改 id
 *
 * - Psyche 开着时调 POST /v1/house/residents/rename 热更新内存与磁盘；没开或旧进程未重启时直接改磁盘 + SQLite named 事件。
 * - Soma 同步改 agents/<id>、Claude Code projects 目录、所有 rooms/*.json(l) 与 *.agenda.json，并通知运行中的 Soma 刷新内存缓存。
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { EventStore } from "../src/store/events.ts";
import { currentName, nameSelf } from "../src/self/self.ts";
import { ID_PATTERN, type ResidentConfig } from "../src/house/residents.ts";
import { renameResidentFiles } from "../src/house/rename.ts";
import { renameSomaResident } from "../../Soma/lib/soma/rename.ts";

const args = process.argv.slice(2);
const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const expand = (p: string) => resolve(p.replace(/^~(?=\/|$)/, homedir()));
const fail = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

const from = opt("--from") ?? fail("要 --from <原id>");
const to = opt("--to") ?? from;
const name = opt("--name");
const why = opt("--why");
if (from === to && !name) fail("至少给 --to <新id> 或 --name <新显示名>");
if (!ID_PATTERN.test(from)) fail(`原 id 格式不对：${from}`);
if (!ID_PATTERN.test(to)) fail(`新 id 格式不对：${to}`);

const dataDir = opt("--data-dir") ? expand(opt("--data-dir")!) : fail("要 --data-dir（如 ~/.psyche/data）");
const somaHome = opt("--soma-home") ? expand(opt("--soma-home")!) : fail("要 --soma-home（如 ~/.soma）");
const psycheUrl = (opt("--psyche-url") ?? process.env.PSYCHE_URL ?? "http://127.0.0.1:7470").replace(/\/+$/, "");

const agentsFile = join(dataDir, "agents.json");
const listed: Record<string, ResidentConfig> = existsSync(agentsFile) ? JSON.parse(readFileSync(agentsFile, "utf8")) : {};
const anyToken = process.env.PSYCHE_TOKEN ?? Object.values(listed).find((c) => c.token)?.token;
const somaUrl = opt("--soma-url") ?? listed[from]?.soma ?? Object.values(listed).find((c) => c.soma)?.soma ?? "http://127.0.0.1:30151";
const newHome = join(somaHome, "agents", to, "home");

// 1. 先改 Soma（优先走 Soma PATCH /api/residents 清内存缓存，若未挂载该路由则本地直接改）
if (from !== to) {
  let somaDone = false;
  try {
    const res = await fetch(`${somaUrl.replace(/\/+$/, "")}/api/residents`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from, to }),
      signal: AbortSignal.timeout(3_000),
    });
    if (res.ok) {
      const j = (await res.json()) as { soma?: { roomsUpdated?: string[] } };
      console.log(`Soma：已在线改名 ${from} → ${to}（更新群聊：${j.soma?.roomsUpdated?.join(", ") || "无"}）`);
      somaDone = true;
    }
  } catch {}
  if (!somaDone) {
    const r = renameSomaResident(from, to, somaHome);
    console.log(`Soma：已改盘上目录与群聊 ${from} → ${to}（更新群聊：${r.roomsUpdated.join(", ") || "无"}）`);
  }
}

// 2. 再改 Psyche（优先走 POST /v1/house/residents/rename 热切换，若返回 404 则直接改盘）
let psycheDone = false;
if (anyToken) {
  try {
    const res = await fetch(`${psycheUrl}/v1/house/residents/rename`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${anyToken}` },
      body: JSON.stringify({ from, to, ...(name ? { name } : {}), ...(why ? { why } : {}), home: newHome }),
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      const j = (await res.json()) as { from: string; to: string; name: string; archiveNo?: string };
      console.log(`Psyche：已热更新 id=${j.to}，显示名=${j.name}${j.archiveNo ? `（${j.archiveNo}）` : ""}`);
      psycheDone = true;
    }
  } catch {}
}

if (!psycheDone) {
  if (from !== to) {
    renameResidentFiles(dataDir, { from, to, home: newHome });
    console.log(`Psyche：已改盘上目录与 agents.json（${from} → ${to}）`);
  }
  if (name) {
    const store = new EventStore(join(dataDir, to, "psyche.db"), { timeZone: process.env.PSYCHE_TZ });
    try {
      const res = nameSelf(store, { name, why: why ?? (from !== to ? `改 id ${from} → ${to}` : "改名") });
      console.log(`Psyche：已写显示名 "${res.name}"（${res.archiveNo}）`);
    } finally {
      store.close();
    }
  } else {
    const store = new EventStore(join(dataDir, to, "psyche.db"), { timeZone: process.env.PSYCHE_TZ });
    try {
      console.log(`Psyche：当前显示名 "${currentName(store) ?? to}"`);
    } finally {
      store.close();
    }
  }
}
