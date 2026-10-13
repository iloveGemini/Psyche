import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { EventStore } from "../src/store/events.ts";
import { Projections, type Projector } from "../src/store/projections.ts";

const msg = (text: string) => ({ kind: "message.in", class: "experience" as const, source: "roxy", payload: { text } });

/** 测试用投影：每个 kind 数一数 */
const counter = (version = 1, kinds?: string[]): Projector => ({
  name: "counts",
  version,
  kinds,
  setup: (db: Database) => db.run(`CREATE TABLE IF NOT EXISTS p_counts (kind TEXT PRIMARY KEY, n INTEGER NOT NULL)`),
  reset: (db: Database) => db.run(`DELETE FROM p_counts`),
  apply: (db: Database, ev) =>
    void db.run(`INSERT INTO p_counts (kind, n) VALUES (?, 1) ON CONFLICT (kind) DO UPDATE SET n = n + 1`, [ev.kind]),
});
const counts = (s: EventStore) =>
  Object.fromEntries((s.db.query(`SELECT kind, n FROM p_counts`).all() as { kind: string; n: number }[]).map((r) => [r.kind, r.n]));

describe("投影", () => {
  test("注册时追平历史，之后手动 catchUp 只处理新事件", () => {
    const s = new EventStore(":memory:");
    s.append(msg("一"));
    s.append(msg("二"));
    const p = new Projections(s);
    p.register(counter());
    expect(counts(s)).toEqual({ "message.in": 2 });
    s.append(msg("三"));
    expect(p.catchUp("counts")).toBe(1);
    expect(counts(s)).toEqual({ "message.in": 3 });
  });

  test("live：写入即应用", () => {
    const s = new EventStore(":memory:");
    const p = new Projections(s);
    p.register(counter());
    p.live();
    s.append(msg("一"));
    s.append({ kind: "diary", class: "self", source: "agent", payload: {} });
    expect(counts(s)).toEqual({ "message.in": 1, diary: 1 });
  });

  test("只关心的 kind 才应用，但游标照样前进", () => {
    const s = new EventStore(":memory:");
    s.append({ kind: "diary", class: "self", source: "agent", payload: {} });
    s.append(msg("一"));
    const p = new Projections(s);
    p.register(counter(1, ["message.in"]));
    expect(counts(s)).toEqual({ "message.in": 1 });
    expect(p.catchUp("counts")).toBe(0);
  });

  test("版本号变了：清空重放，并记系统日志", () => {
    const s = new EventStore(":memory:");
    s.append(msg("一"));
    new Projections(s).register(counter(1));
    // 模拟派生表被弄脏
    s.db.run(`UPDATE p_counts SET n = 99`);
    new Projections(s).register(counter(2));
    expect(counts(s)).toEqual({ "message.in": 1 });
    expect(s.readSyslog({ kind: "projection.rebuilt" })[0].detail).toMatchObject({ name: "counts", version: 2, applied: 1 });
  });

  test("apply 返回 Promise 直接报错：投影不许调模型", () => {
    const s = new EventStore(":memory:");
    s.append(msg("一"));
    const bad: Projector = { ...counter(), name: "bad", apply: (async () => {}) as unknown as Projector["apply"] };
    expect(() => new Projections(s).register(bad)).toThrow(/不许调模型/);
  });
});
