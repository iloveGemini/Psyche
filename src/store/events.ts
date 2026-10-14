/**
 * 库房：只追加的事件日志 + 随事件写入的关系 + 资料库 + 系统日志。
 *
 * 设计见 notes/design/events.md、archive.md。要点：
 * - 事件不可变（表上有触发器兜底）；内容的任何变化只能以新事件出现。
 * - 档号 = [全宗/]日期#当日序号，入库时定下，永不改；日期取发生时间 at 的自然日。
 * - 幂等键：同一 source 内唯一，harness 重试、hook 重复触发不会重复入库。
 * - 处境只在变化时写一条，之后的事件自动挂上当前处境 id。
 */
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { ulid } from "../core/ulid.ts";
import { localDay } from "../core/time.ts";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.ts";

export type EventClass = "experience" | "self" | "situation";

export interface LinkInput {
  to: string;
  rel: string;
  props?: unknown;
}

export interface AppendInput {
  kind: string;
  class: EventClass;
  source: string;
  payload: unknown;
  /** 发生时间；缺省 = 写入时间 */
  at?: number;
  producer?: string;
  v?: number;
  idem?: string;
  /** 全宗；缺省 = 它自己的经历 */
  fonds?: string;
  /** 缺省 = 当前处境（导入的旧卷宗没有处境，传 null） */
  situation?: string | null;
  links?: LinkInput[];
}

export interface PsycheEvent {
  id: string;
  at: number;
  recorded: number;
  kind: string;
  class: EventClass;
  source: string;
  producer: string | null;
  situation: string | null;
  v: number;
  payload: unknown;
  fonds: string;
  day: string;
  seq: number;
  /** 规范档号：`[全宗/]YYYY-MM-DD#序号` */
  archiveNo: string;
}

export interface Link {
  from: string;
  to: string;
  rel: string;
  props: unknown;
}

export interface ListQuery {
  from?: number;
  to?: number;
  kinds?: string[];
  classes?: EventClass[];
  fonds?: string;
  /** 按 id（写入顺序）翻页 */
  afterId?: string;
  limit?: number;
}

export interface StoreOptions {
  /** 档号日期按哪个时区切，缺省 Asia/Shanghai */
  timeZone?: string;
  now?: () => number;
}

type Row = {
  id: string;
  at: number;
  recorded: number;
  kind: string;
  class: EventClass;
  source: string;
  producer: string | null;
  situation: string | null;
  v: number;
  payload: string;
  fonds: string;
  day: string;
  seq: number;
};

export function archiveNoOf(fonds: string, day: string, seq: number): string {
  return `${fonds ? `${fonds}/` : ""}${day}#${seq}`;
}

/** 给人看的档号：与参考年份同年时省略年份（`10-13#112`），跨年保留（`2027-01-02#5`） */
export function displayArchiveNo(archiveNo: string, refYear: number): string {
  return archiveNo.replace(new RegExp(`(^|/)${refYear}-`), "$1");
}

function toEvent(r: Row): PsycheEvent {
  return {
    ...r,
    payload: JSON.parse(r.payload),
    archiveNo: archiveNoOf(r.fonds, r.day, r.seq),
  };
}

/** 稳定序列化：键排序，用于比较处境是否变化 */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

export type Listener = (ev: PsycheEvent) => void;

export class EventStore {
  readonly db: Database;
  readonly timeZone: string;
  /** 此刻（测试可注入固定时钟） */
  readonly now: () => number;
  private currentSituation: PsycheEvent | null;
  private listeners: Listener[] = [];

  constructor(path: string, opts: StoreOptions = {}) {
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA_SQL);
    const ver = this.db.query(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as { value: string } | null;
    if (!ver) this.db.query(`INSERT INTO meta (key, value) VALUES ('schema_version', ?)`).run(String(SCHEMA_VERSION));
    else if (Number(ver.value) !== SCHEMA_VERSION)
      throw new Error(`库的 schema 版本是 ${ver.value}，代码是 ${SCHEMA_VERSION}`);
    this.timeZone = opts.timeZone ?? "Asia/Shanghai";
    this.now = opts.now ?? Date.now;
    const sit = this.db.query(`SELECT * FROM events WHERE class = 'situation' AND fonds = '' ORDER BY id DESC LIMIT 1`).get() as Row | null;
    this.currentSituation = sit ? toEvent(sit) : null;
  }

  close() {
    this.db.close();
  }

  // ── 写 ──

  append(input: AppendInput): PsycheEvent {
    const existing = input.idem
      ? (this.db.query(`SELECT * FROM events WHERE source = ? AND idem = ?`).get(input.source, input.idem) as Row | null)
      : null;
    if (existing) return toEvent(existing);

    const recorded = this.now();
    const at = input.at ?? recorded;
    const fonds = input.fonds ?? "";
    const day = localDay(at, this.timeZone);
    const situation =
      input.situation !== undefined ? input.situation : input.class === "situation" || fonds ? null : this.situationAt(at);
    const id = ulid(recorded);

    const tx = this.db.transaction(() => {
      const { seq } = this.db
        .query(
          `INSERT INTO archive_counters (fonds, day, seq) VALUES (?, ?, 1)
           ON CONFLICT (fonds, day) DO UPDATE SET seq = seq + 1 RETURNING seq`,
        )
        .get(fonds, day) as { seq: number };
      this.db
        .query(
          `INSERT INTO events (id, at, recorded, kind, class, source, producer, situation, v, payload, fonds, day, seq, idem)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, at, recorded, input.kind, input.class, input.source, input.producer ?? null, situation, input.v ?? 1, JSON.stringify(input.payload ?? null), fonds, day, seq, input.idem ?? null);
      const link = this.db.query(`INSERT INTO links (from_id, to_id, rel, props) VALUES (?, ?, ?, ?)`);
      for (const l of input.links ?? []) link.run(id, l.to, l.rel, l.props === undefined ? null : JSON.stringify(l.props));
    });
    tx();

    const ev = this.get(id)!;
    // 晚报的处境（at 比当前的还早）不顶替当前处境，只给那段时间的事件挂
    if (ev.class === "situation" && !fonds && (!this.currentSituation || ev.at >= this.currentSituation.at)) this.currentSituation = ev;
    for (const fn of this.listeners) fn(ev);
    return ev;
  }

  /** 处境只在变化时写一条（events.md §三）；没变就返回当前那条 */
  setSituation(payload: Record<string, unknown>, source = "psyche", at?: number): PsycheEvent {
    if (this.currentSituation && stable(this.currentSituation.payload) === stable(payload)) return this.currentSituation;
    return this.append({ kind: "situation", class: "situation", source, payload, at });
  }

  get situation(): PsycheEvent | null {
    return this.currentSituation;
  }

  /** 发生时间 at 那一刻有效的处境 id：晚到的事件挂当时的处境，不挂此刻的 */
  situationAt(at: number): string | null {
    const cur = this.currentSituation;
    if (!cur || cur.at <= at) return cur?.id ?? null;
    const r = this.db.query(`SELECT id FROM events WHERE class = 'situation' AND fonds = '' AND at <= ? ORDER BY at DESC, id DESC LIMIT 1`).get(at) as { id: string } | null;
    return r?.id ?? null;
  }

  /** 写入后通知（进程内总线）。返回取消订阅函数 */
  subscribe(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== fn);
    };
  }

  // ── 读 ──

  get(id: string): PsycheEvent | null {
    const r = this.db.query(`SELECT * FROM events WHERE id = ?`).get(id) as Row | null;
    return r ? toEvent(r) : null;
  }

  /** 按档号取：接受 `ROY/2026-10-11#40`，也接受省略年份的 `10-13#112`（按 refYear 补） */
  byArchiveNo(no: string, refYear: number = Number(localDay(this.now(), this.timeZone).slice(0, 4))): PsycheEvent | null {
    const m = no.match(/^(?:([^/]+)\/)?((?:\d{4}-)?\d{2}-\d{2})#(\d+)$/);
    if (!m) return null;
    const day = m[2].length === 5 ? `${refYear}-${m[2]}` : m[2];
    const r = this.db.query(`SELECT * FROM events WHERE fonds = ? AND day = ? AND seq = ?`).get(m[1] ?? "", day, Number(m[3])) as Row | null;
    return r ? toEvent(r) : null;
  }

  list(q: ListQuery = {}): PsycheEvent[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (q.from !== undefined) (where.push("at >= ?"), args.push(q.from));
    if (q.to !== undefined) (where.push("at < ?"), args.push(q.to));
    if (q.kinds?.length) (where.push(`kind IN (${q.kinds.map(() => "?").join(",")})`), args.push(...q.kinds));
    if (q.classes?.length) (where.push(`class IN (${q.classes.map(() => "?").join(",")})`), args.push(...q.classes));
    if (q.fonds !== undefined) (where.push("fonds = ?"), args.push(q.fonds));
    if (q.afterId) (where.push("id > ?"), args.push(q.afterId));
    const sql = `SELECT * FROM events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id LIMIT ?`;
    return (this.db.query(sql).all(...args, q.limit ?? 1000) as Row[]).map(toEvent);
  }

  linksFrom(id: string): Link[] {
    return (this.db.query(`SELECT * FROM links WHERE from_id = ?`).all(id) as any[]).map(toLink);
  }

  linksTo(to: string, rel?: string): Link[] {
    const rows = rel
      ? this.db.query(`SELECT * FROM links WHERE to_id = ? AND rel = ?`).all(to, rel)
      : this.db.query(`SELECT * FROM links WHERE to_id = ?`).all(to);
    return (rows as any[]).map(toLink);
  }

  // ── 资料库（不褪色，经历里的角标指向它） ──

  putMaterial(content: string | Uint8Array, mime = "text/plain"): string {
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
    const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    this.db
      .query(`INSERT OR IGNORE INTO materials (hash, mime, content, size, created) VALUES (?, ?, ?, ?, ?)`)
      .run(hash, mime, bytes, bytes.length, this.now());
    return hash;
  }

  getMaterial(hash: string): { mime: string; content: Uint8Array; text(): string } | null {
    const r = this.db.query(`SELECT mime, content FROM materials WHERE hash = ?`).get(hash) as { mime: string; content: Uint8Array } | null;
    return r ? { ...r, text: () => new TextDecoder().decode(r.content) } : null;
  }

  /** 硬盘文件：存路径 + 此刻内容的快照哈希 */
  snapshotFile(path: string, mime = "text/plain"): { path: string; hash: string } {
    const hash = this.putMaterial(readFileSync(path), mime);
    this.db.query(`INSERT OR IGNORE INTO file_snapshots (path, hash, taken) VALUES (?, ?, ?)`).run(path, hash, this.now());
    return { path, hash };
  }

  // ── 系统日志：不进事件流、不占档号、不推送；Agent 可以查 ──

  syslog(kind: string, detail: unknown = {}): void {
    this.db.query(`INSERT INTO system_log (at, kind, detail) VALUES (?, ?, ?)`).run(this.now(), kind, JSON.stringify(detail));
  }

  readSyslog(opts: { kind?: string; limit?: number } = {}): { at: number; kind: string; detail: unknown }[] {
    const rows = opts.kind
      ? this.db.query(`SELECT at, kind, detail FROM system_log WHERE kind = ? ORDER BY id DESC LIMIT ?`).all(opts.kind, opts.limit ?? 100)
      : this.db.query(`SELECT at, kind, detail FROM system_log ORDER BY id DESC LIMIT ?`).all(opts.limit ?? 100);
    return (rows as { at: number; kind: string; detail: string }[]).map((r) => ({ ...r, detail: JSON.parse(r.detail) }));
  }
}

function toLink(r: { from_id: string; to_id: string; rel: string; props: string | null }): Link {
  return { from: r.from_id, to: r.to_id, rel: r.rel, props: r.props === null ? null : JSON.parse(r.props) };
}
