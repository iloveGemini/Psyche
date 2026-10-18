/**
 * 向量（m3.md 〈向量〉，10-14 定）：经历可见行和书架条目的向量，给 recall 与浮现做语义匹配。
 *
 * 算向量要调外部模型（异步、要网络），所以**不是投影**：投影必须同步、确定。这里是投影旁边的派生缓存——
 * 按 (ref, model) 存，换模型就整套重算；删了能重建。没配嵌入服务就没有向量，recall 和浮现退回只用字面。
 *
 * 隐私：算向量时发出去的是**原文**（不是向量）。测试库先用硅基流动；正式库出生前另定（STATE）。
 *
 * 环境变量（OpenAI 兼容的 /embeddings）：
 *   PSYCHE_EMBED_URL    如 https://api.siliconflow.cn/v1
 *   PSYCHE_EMBED_MODEL  如 BAAI/bge-m3
 *   PSYCHE_EMBED_KEY    密钥；不设则读 PSYCHE_EMBED_KEY_ENV 指的那个变量（缺省 SILICONFLOW_API_KEY）
 */
import type { Database } from "bun:sqlite";
import { renderEntry, readShelf } from "../reading/shelf.ts";

export interface Embedder {
  /** 模型标识：存向量的键之一，换了就重算 */
  model: string;
  embed(texts: string[]): Promise<Float32Array[]>;
}

export function embedderFromEnv(env: Record<string, string | undefined> = process.env): Embedder | undefined {
  const url = env.PSYCHE_EMBED_URL;
  const model = env.PSYCHE_EMBED_MODEL;
  const key = env.PSYCHE_EMBED_KEY ?? env[env.PSYCHE_EMBED_KEY_ENV ?? "SILICONFLOW_API_KEY"];
  if (!url || !model || !key) return undefined;
  return openaiEmbedder(url, model, key, fetchV4Fallback);
}

/**
 * 连不上时改走 IPv4 再试一次（10-18：硅基流动的 IPv6 握手被重置，curl 会自己退回 IPv4，Bun 的 fetch 不会，
 * 报成 unknown certificate verification error，浮现拖过 Soma 等 <now> 的 3 秒）。HTTP 层的错照常返回，不重试。
 * 退回过一次，之后半小时直接走 IPv4：每次先等 IPv6 失败要好几秒（10-18 测到冷连接 7.6 秒），<now> 照样超时。
 */
const V4_STICKY_MS = 30 * 60_000;
const v4Until = new Map<string, number>();

async function viaV4(u: URL, init?: RequestInit): Promise<Response | undefined> {
  const ips = await import("node:dns").then((d) => d.promises.resolve4(u.hostname)).catch(() => [] as string[]);
  if (!ips.length || u.protocol !== "https:") return undefined;
  const host = u.host;
  const v4 = new URL(u);
  v4.hostname = ips[0];
  return fetch(v4, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers).entries()), host }, tls: { serverName: host.split(":")[0] } } as RequestInit);
}

export const fetchV4Fallback: typeof fetch = Object.assign(
  async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
    if ((v4Until.get(u.hostname) ?? 0) > Date.now()) {
      const res = await viaV4(u, init).catch(() => undefined);
      if (res) return res;
      v4Until.delete(u.hostname);
    }
    try {
      return await fetch(input, init);
    } catch (err) {
      const res = await viaV4(u, init);
      if (!res) throw err;
      v4Until.set(u.hostname, Date.now() + V4_STICKY_MS);
      return res;
    }
  },
  { preconnect: fetch.preconnect },
);

export function openaiEmbedder(url: string, model: string, key: string, doFetch: typeof fetch = fetch): Embedder {
  const endpoint = `${url.replace(/\/+$/, "")}/embeddings`;
  return {
    model,
    async embed(texts) {
      if (!texts.length) return [];
      const res = await doFetch(endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model, input: texts, encoding_format: "float" }),
      });
      if (!res.ok) throw new Error(`嵌入服务 ${res.status}：${(await res.text()).slice(0, 300)}`);
      const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
      return json.data.sort((a, b) => a.index - b.index).map((d) => normalize(Float32Array.from(d.embedding)));
    },
  };
}

export function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

/** 两个已归一化的向量：点积 = 余弦 */
export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

const toBlob = (v: Float32Array) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
export const fromBlob = (b: Uint8Array) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

export function setupVectors(db: Database) {
  db.run(`CREATE TABLE IF NOT EXISTS p_vec (
    ref    TEXT NOT NULL,              -- 经历行的 event_id，或书架条目现行版的 id
    model  TEXT NOT NULL,
    vec    BLOB NOT NULL,              -- Float32，已归一化
    PRIMARY KEY (ref, model)
  )`);
}

const BATCH = 32;
/** 嵌入时截到多长：情节和原话都不长；工具返回已在渲染时截过 */
const MAX_CHARS = 1000;

/** 还没有向量的：经历可见行（不含处境）+ 现行书架条目 */
function missing(db: Database, model: string, limit: number): { ref: string; text: string }[] {
  const exp = db
    .query(
      `SELECT p.event_id AS ref, p.text FROM p_experience p
       WHERE p.covered = 0 AND p.class <> 'situation'
         AND NOT EXISTS (SELECT 1 FROM p_vec v WHERE v.ref = p.event_id AND v.model = ?)
       ORDER BY p.event_id LIMIT ?`,
    )
    .all(model, limit) as { ref: string; text: string }[];
  if (exp.length >= limit) return exp;
  const has = db.query(`SELECT 1 FROM p_vec WHERE ref = ? AND model = ?`);
  const shelf = readShelf(db)
    .filter((e) => !has.get(e.current, model))
    .slice(0, limit - exp.length)
    .map((e) => ({ ref: e.current, text: renderEntry(e) }));
  return [...exp, ...shelf];
}

/** 补齐向量；返回这次补了几条。出错（网络、额度）向上抛，调用方决定要不要吞 */
export async function syncVectors(db: Database, embedder: Embedder, max = 2000): Promise<number> {
  setupVectors(db);
  let done = 0;
  while (done < max) {
    const rows = missing(db, embedder.model, Math.min(BATCH, max - done));
    if (!rows.length) break;
    const vecs = await embedder.embed(rows.map((r) => Array.from(r.text).slice(0, MAX_CHARS).join("")));
    const put = db.query(`INSERT OR REPLACE INTO p_vec (ref, model, vec) VALUES (?, ?, ?)`);
    db.transaction(() => rows.forEach((r, i) => put.run(r.ref, embedder.model, toBlob(vecs[i]))))();
    done += rows.length;
  }
  return done;
}

export function vectorOf(db: Database, ref: string, model: string): Float32Array | null {
  const r = db.query(`SELECT vec FROM p_vec WHERE ref = ? AND model = ?`).get(ref, model) as { vec: Uint8Array } | null;
  return r ? fromBlob(r.vec) : null;
}
