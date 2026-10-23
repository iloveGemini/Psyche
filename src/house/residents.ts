/**
 * 谁住在这（P1，notes/design/soma2.md §八.1）：一个进程，每人一个库。
 *
 * 数据目录下每人一个子目录：<PSYCHE_DATA_DIR>/<id>/psyche.db。id 不是模型名，也不是名字——名字由他自己取。
 * 隔离靠文件：A 的请求只碰得到 A 的库；每人一个 token，A 的 token 进不了 B 的门（server/house.ts）。
 *
 * 每人的设置在 <PSYCHE_DATA_DIR>/agents.json（可以没有）：
 *   { "<id>": { "token": "…", "soma": "http://127.0.0.1:30151", "model": "claude-opus-5-5", "home": "~/.soma/agents/<id>/home", "email": true,
 *               "past": [{ "fonds": "ROY", "path": "~/…/state.db" }] } }
 * 列在里面的人没有目录就建一个（还没出生的空库）。
 *
 * 只住一个人时，环境变量（PSYCHE_TOKEN / SOMA_URL / PSYCHE_MODEL / PSYCHE_EMAIL=1）给他当缺省，跟一代一样。
 * 住几个人时，token 没单独设的才用 PSYCHE_TOKEN（会提醒：共用 token 就隔不开了）；家、模型、邮箱必须各写各的。
 *
 * 一代的布局（数据目录下直接是 psyche.db）还认：当成一个人，id 取 PSYCHE_AGENT（缺省 default）。考卷都是这样起的。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkPastConfig, type PastConfig } from "../archive/past.ts";

export interface ResidentConfig {
  token?: string;
  /** 他的家（Soma）：醒来推到这里 */
  soma?: string;
  /** 他的模型，出生时没记下的库用它 */
  model?: string;
  /** 他的 home 目录（Soma 的 agents/<id>/home）：全屋的东西从这里看（m8.md §6.2） */
  home?: string;
  /** 开房子那个邮箱（有一个人开就收）：没 @ 也认不出给谁的信，给第一个开了的人（soma2.md §8.2） */
  email?: boolean;
  /** 前世卷宗（archive/past.ts）：翻得到，认领了才导进库 */
  past?: PastConfig[];
}

export interface Resident {
  id: string;
  dir: string;
  config: ResidentConfig;
}

export const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export function readResidents(dataDir: string, env: Record<string, string | undefined> = process.env): Resident[] {
  const file = join(dataDir, "agents.json");
  const listed: Record<string, ResidentConfig> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  for (const id of Object.keys(listed)) {
    if (!ID_PATTERN.test(id)) throw new Error(`agents.json 里的 id 不对：${id}（小写字母、数字、- _，最多 32 位）`);
    if (listed[id].past !== undefined) listed[id].past = checkPastConfig(listed[id].past);
  }

  let residents: Resident[];
  if (existsSync(join(dataDir, "psyche.db"))) {
    const id = env.PSYCHE_AGENT ?? "default";
    residents = [{ id, dir: dataDir, config: listed[id] ?? {} }];
  } else {
    const ids = new Set(Object.keys(listed));
    if (existsSync(dataDir))
      for (const d of readdirSync(dataDir, { withFileTypes: true }))
        if (d.isDirectory() && ID_PATTERN.test(d.name) && existsSync(join(dataDir, d.name, "psyche.db"))) ids.add(d.name);
    residents = [...ids].sort().map((id) => {
      const dir = join(dataDir, id);
      mkdirSync(dir, { recursive: true });
      return { id, dir, config: listed[id] ?? {} };
    });
  }

  const alone = residents.length === 1;
  return residents.map((r) => ({
    ...r,
    config: {
      ...r.config,
      token: r.config.token ?? env.PSYCHE_TOKEN,
      ...(alone
        ? {
            soma: r.config.soma ?? env.SOMA_URL,
            model: r.config.model ?? env.PSYCHE_MODEL,
            email: r.config.email ?? env.PSYCHE_EMAIL === "1",
          }
        : {}),
    },
  }));
}
