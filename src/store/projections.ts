/**
 * 投影：由事件算出、存派生表、可删可重建（events.md §七）。
 *
 * 两条原则：
 * 1. 确定性，重放绝不调 LLM。apply 是同步函数——返回 Promise 直接报错，从签名上堵住"等一下模型"。
 * 2. 与时间相关的不存，读时算；投影只存原料。
 *
 * 每个投影有自己的游标（处理到哪条事件）和版本号。版本号一变 = 投影逻辑改了，自动清空重放，记系统日志。
 */
import type { Database } from "bun:sqlite";
import type { EventStore, PsycheEvent } from "./events.ts";

export interface Projector {
  name: string;
  /** 逻辑改了就 +1，下次注册时自动重建 */
  version: number;
  /** 只关心这些 kind；缺省 = 全部 */
  kinds?: string[];
  /** 建表（幂等） */
  setup(db: Database): void;
  /** 清空派生数据 */
  reset(db: Database): void;
  /** 应用一条事件。必须同步、确定 */
  apply(db: Database, ev: PsycheEvent): void;
}

const BATCH = 500;

export class Projections {
  private projectors = new Map<string, Projector>();
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly store: EventStore) {}

  /** 注册并追平。版本变了先重建 */
  register(p: Projector): void {
    const db = this.store.db;
    p.setup(db);
    this.projectors.set(p.name, p);
    const cur = db.query(`SELECT version FROM projection_cursors WHERE name = ?`).get(p.name) as { version: number } | null;
    if (!cur) db.query(`INSERT INTO projection_cursors (name, version, last_id) VALUES (?, ?, '')`).run(p.name, p.version);
    else if (cur.version !== p.version) {
      this.rebuild(p.name, `版本 ${cur.version} → ${p.version}`);
      return;
    }
    this.catchUp(p.name);
  }

  /** 把投影追到最新一条事件 */
  catchUp(name: string): number {
    const p = this.must(name);
    const db = this.store.db;
    let applied = 0;
    for (;;) {
      const { last_id } = db.query(`SELECT last_id FROM projection_cursors WHERE name = ?`).get(name) as { last_id: string };
      const batch = this.store.list({ afterId: last_id || undefined, limit: BATCH });
      if (!batch.length) return applied;
      db.transaction(() => {
        for (const ev of batch) {
          if (!p.kinds || p.kinds.includes(ev.kind)) {
            const r = p.apply(db, ev) as unknown;
            if (r && typeof (r as Promise<unknown>).then === "function") throw new Error(`投影 ${name} 的 apply 返回了 Promise：投影必须同步、确定，不许调模型`);
            applied++;
          }
        }
        db.query(`UPDATE projection_cursors SET last_id = ? WHERE name = ?`).run(batch.at(-1)!.id, name);
      })();
    }
  }

  /** 清空重放 */
  rebuild(name: string, reason = "手动"): void {
    const p = this.must(name);
    const db = this.store.db;
    db.transaction(() => {
      p.reset(db);
      db.query(`INSERT INTO projection_cursors (name, version, last_id) VALUES (?, ?, '')
                ON CONFLICT (name) DO UPDATE SET version = excluded.version, last_id = ''`).run(name, p.version);
    })();
    const applied = this.catchUp(name);
    this.store.syslog("projection.rebuilt", { name, version: p.version, reason, applied });
  }

  /** 写入即应用：订阅库房，每条新事件追平所有投影 */
  live(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.store.subscribe(() => {
      for (const name of this.projectors.keys()) this.catchUp(name);
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private must(name: string): Projector {
    const p = this.projectors.get(name);
    if (!p) throw new Error(`没有注册投影 ${name}`);
    return p;
  }
}
