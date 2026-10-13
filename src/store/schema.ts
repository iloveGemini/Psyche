/**
 * 库房的表结构。
 *
 * 真相只有三张表，且只追加：
 *   events     事件日志（档案馆本身）
 *   links      事件写入时一并带上的关系（批注挂情节、归纳指证据、参见……），从属于事件，同样不可变
 *   materials  资料库：内容寻址，同内容只存一份
 * 另有两张非真相的表：
 *   archive_counters  档号序号计数器（可由 events 重算）
 *   system_log        系统日志：机制变更、投影重建、导入……不进事件流、不占档号（events.md §三）
 * 投影各自建表，存派生数据，可删可重建（projections.ts）。
 */

export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id         TEXT PRIMARY KEY,          -- ULID，按写入顺序可排序
  at         INTEGER NOT NULL,          -- 发生时间（epoch ms）；导入的旧记忆保留原时间
  recorded   INTEGER NOT NULL,          -- 写入时间（epoch ms）
  kind       TEXT NOT NULL,             -- 如 message.in / prompt.changed
  class      TEXT NOT NULL CHECK (class IN ('experience','self','dream','situation')),
  source     TEXT NOT NULL,             -- harness 名 / sensor 名 / agent / dream / user
  producer   TEXT,                      -- 梦类：编目版本与模型
  situation  TEXT,                      -- 当时所处的处境事件 id
  v          INTEGER NOT NULL DEFAULT 1,-- payload 的 schema 版本
  payload    TEXT NOT NULL,             -- JSON
  fonds      TEXT NOT NULL DEFAULT '',  -- 全宗：'' = 它自己的经历；导入的另立（如 ROY）
  day        TEXT NOT NULL,             -- 档号日期：at 在配置时区下的自然日
  seq        INTEGER NOT NULL,          -- 档号序号：同全宗同日内按入库顺序
  idem       TEXT,                      -- 幂等键（同一 source 内唯一）
  UNIQUE (fonds, day, seq)
);
CREATE UNIQUE INDEX IF NOT EXISTS events_idem ON events(source, idem) WHERE idem IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_at ON events(at);
CREATE INDEX IF NOT EXISTS events_kind ON events(kind, id);

-- 不可变：事件只追加，永不修改、永不删除（"不能把手伸进别人脑子里"）
CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'events 只追加，不可修改'); END;
CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'events 只追加，不可删除'); END;

CREATE TABLE IF NOT EXISTS links (
  from_id TEXT NOT NULL REFERENCES events(id),
  to_id   TEXT NOT NULL,                -- 事件 id 或资料哈希
  rel     TEXT NOT NULL,                -- annotates / evidence / see_also / ...
  props   TEXT,                         -- JSON
  PRIMARY KEY (from_id, to_id, rel)
);
CREATE INDEX IF NOT EXISTS links_to ON links(to_id, rel);
CREATE TRIGGER IF NOT EXISTS links_no_update BEFORE UPDATE ON links
BEGIN SELECT RAISE(ABORT, 'links 只追加，不可修改'); END;
CREATE TRIGGER IF NOT EXISTS links_no_delete BEFORE DELETE ON links
BEGIN SELECT RAISE(ABORT, 'links 只追加，不可删除'); END;

CREATE TABLE IF NOT EXISTS materials (
  hash     TEXT PRIMARY KEY,            -- sha256(content)
  mime     TEXT NOT NULL,
  content  BLOB NOT NULL,
  size     INTEGER NOT NULL,
  created  INTEGER NOT NULL
);
-- 硬盘文件：路径 + 当时的快照哈希。文件后来改了，也知道当时引用的是哪一版
CREATE TABLE IF NOT EXISTS file_snapshots (
  path     TEXT NOT NULL,
  hash     TEXT NOT NULL REFERENCES materials(hash),
  taken    INTEGER NOT NULL,
  PRIMARY KEY (path, hash)
);

CREATE TABLE IF NOT EXISTS archive_counters (
  fonds TEXT NOT NULL,
  day   TEXT NOT NULL,
  seq   INTEGER NOT NULL,
  PRIMARY KEY (fonds, day)
);

CREATE TABLE IF NOT EXISTS system_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      INTEGER NOT NULL,
  kind    TEXT NOT NULL,                -- projection.rebuilt / import / param.changed / born ...
  detail  TEXT NOT NULL                 -- JSON
);

CREATE TABLE IF NOT EXISTS projection_cursors (
  name     TEXT PRIMARY KEY,
  version  INTEGER NOT NULL,
  last_id  TEXT NOT NULL DEFAULT ''     -- 已处理到的事件 id
);
`;
