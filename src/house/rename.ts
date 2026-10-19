/**
 * 给住户改 id / 改名字（全套自动迁移）：
 * - Psyche：<数据目录>/<from>/ → <数据目录>/<to>/，更新 agents.json（含 home 路径替换）与 files.json 快照
 * - 可选同时调 nameSelf 写入 named 事件改显示名
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ID_PATTERN, type ResidentConfig } from "./residents.ts";

export interface RenameResidentInput {
  from: string;
  to: string;
  /** 新的 Soma home 路径；不传则自动把旧 home 里的 /agents/<from>/home 换成 /agents/<to>/home */
  home?: string;
}

export function renameResidentFiles(dataDir: string, input: RenameResidentInput): ResidentConfig {
  const from = input.from.trim();
  const to = input.to.trim();
  if (!ID_PATTERN.test(from)) throw new Error(`原 id 格式不对：${from}`);
  if (!ID_PATTERN.test(to)) throw new Error(`新 id 格式不对：${to}（小写字母、数字、- _，最多 32 位）`);
  if (from === to) throw new Error("新旧 id 相同，无需更改");

  const file = join(dataDir, "agents.json");
  const listed: Record<string, ResidentConfig> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const fromDir = join(dataDir, from);
  const toDir = join(dataDir, to);

  if (!listed[from] && !existsSync(fromDir)) {
    throw new Error(`Psyche 里没有住户 ${from}`);
  }
  if (listed[to] || existsSync(toDir)) {
    throw new Error(`Psyche 里已经有 ${to} 了`);
  }

  if (existsSync(fromDir)) {
    renameSync(fromDir, toDir);
  }

  const prev = listed[from] ?? {};
  const autoHome = prev.home ? prev.home.replace(new RegExp(`/agents/${from}(/|$)`), `/agents/${to}$1`) : undefined;
  const nextConfig: ResidentConfig = {
    ...prev,
    ...(input.home ? { home: input.home } : autoHome ? { home: autoHome } : {}),
  };

  // 保持 agents.json 原有键顺序
  const nextListed: Record<string, ResidentConfig> = {};
  let replaced = false;
  for (const [k, v] of Object.entries(listed)) {
    if (k === from) {
      nextListed[to] = nextConfig;
      replaced = true;
    } else {
      nextListed[k] = v;
    }
  }
  if (!replaced) nextListed[to] = nextConfig;
  writeFileSync(file, `${JSON.stringify(nextListed, null, 2)}\n`);

  // 更新 files.json 里的 owner key（home:<from>）
  const snapFile = join(dataDir, "files.json");
  if (existsSync(snapFile)) {
    try {
      const snaps = JSON.parse(readFileSync(snapFile, "utf8")) as Record<string, unknown>;
      const nextSnaps: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(snaps)) {
        if (k === `home:${from}`) nextSnaps[`home:${to}`] = v;
        else if (k === from) nextSnaps[to] = v;
        else nextSnaps[k] = v;
      }
      writeFileSync(snapFile, JSON.stringify(nextSnaps, null, 2));
    } catch {}
  }

  return nextConfig;
}
