/**
 * 添加住户（notes/howto/add-resident.md）：在 agents.json 里登记、建目录。出生另调 birth()。
 * 屋子的口子 POST /v1/house/residents（Psyche 开着、热挂进屋）和 scripts/add-resident.ts（没开时直接写）都用这里。
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { letterText } from "../self/self.ts";
import { ID_PATTERN, type ResidentConfig } from "./residents.ts";
import { checkPastConfig, type PastConfig } from "../archive/past.ts";

export interface NewResident {
  id: string;
  model: string;
  soma?: string;
  home?: string;
  /** 不给就生成一个（每人一个 token，A 的进不了 B 的门） */
  token?: string;
  email?: boolean;
  /** 前世卷宗（archive/past.ts）；给了就整份替换 */
  past?: PastConfig[];
}

/** 写进 agents.json（已有的字段保留，给了的覆盖），建 <数据目录>/<id>/。返回登记好的设置 */
export function registerResident(dataDir: string, r: NewResident): ResidentConfig {
  if (!ID_PATTERN.test(r.id)) throw new Error("id 格式不对（小写字母、数字、- _，最多 32 位）");
  if (!r.model.trim()) throw new Error("要填 model（一个模型 = 一个 Agent）");
  if (existsSync(join(dataDir, "psyche.db"))) throw new Error(`${dataDir} 是一代布局（直接放着 psyche.db），住不了第二个人；先把它挪进 <数据目录>/<id>/`);
  const file = join(dataDir, "agents.json");
  const listed: Record<string, ResidentConfig> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const prev = listed[r.id] ?? {};
  const config: ResidentConfig = {
    ...prev,
    model: r.model.trim(),
    token: r.token ?? prev.token ?? randomUUID(),
    ...(r.soma ? { soma: r.soma } : {}),
    ...(r.home ? { home: r.home } : {}),
    ...(r.email !== undefined ? { email: r.email } : {}),
    ...(r.past !== undefined ? { past: checkPastConfig(r.past) } : {}),
  };
  listed[r.id] = config;
  mkdirSync(join(dataDir, r.id), { recursive: true });
  writeFileSync(file, `${JSON.stringify(listed, null, 2)}\n`);
  return config;
}

/** 出生那天的信：给了文件读那个，没给读仓库的 letters/birth.md；去掉注释后空的 = 没有 */
export function readLetter(file?: string): string {
  const path = file ?? join(import.meta.dir, "..", "..", "letters", "birth.md");
  if (!existsSync(path)) {
    if (file) throw new Error(`没有这封信：${file}`);
    return "";
  }
  return letterText(readFileSync(path, "utf8"));
}
