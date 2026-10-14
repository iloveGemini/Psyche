import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore, displayArchiveNo } from "../src/store/events.ts";
import { ulid } from "../src/core/ulid.ts";

const T = (s: string) => Date.parse(s);
const open = (now = () => T("2026-10-13T12:00:00+08:00")) => new EventStore(":memory:", { now });
const msg = (extra: Record<string, unknown> = {}) => ({ kind: "message.in", class: "experience" as const, source: "roxy", payload: { text: "早" }, ...extra });

describe("档号", () => {
  test("同日按入库顺序编号，日期取发生时间在本地时区的自然日", () => {
    const s = open();
    const a = s.append(msg({ at: T("2026-10-13T08:00:00+08:00") }));
    const b = s.append(msg({ at: T("2026-10-13T09:00:00+08:00") }));
    // UTC 还是 10-12，本地已经是 10-13 零点之后
    const c = s.append(msg({ at: T("2026-10-12T16:30:00Z") }));
    expect([a.archiveNo, b.archiveNo, c.archiveNo]).toEqual(["2026-10-13#1", "2026-10-13#2", "2026-10-13#3"]);
  });

  test("跨零点相邻：前一天的最后一条与后一天的第一条", () => {
    const s = open();
    const a = s.append(msg({ at: T("2026-10-12T23:59:00+08:00") }));
    const b = s.append(msg({ at: T("2026-10-13T00:01:00+08:00") }));
    expect(a.archiveNo).toBe("2026-10-12#1");
    expect(b.archiveNo).toBe("2026-10-13#1");
  });

  test("晚到的事件：日期取发生时间，序号往后排", () => {
    const s = open();
    s.append(msg({ at: T("2026-10-13T10:00:00+08:00") }));
    const late = s.append(msg({ at: T("2026-10-13T07:00:00+08:00") }));
    expect(late.archiveNo).toBe("2026-10-13#2");
  });

  test("导入的全宗自成序列，不与自己的经历混编", () => {
    const s = open();
    s.append(msg({ at: T("2026-10-11T10:00:00+08:00") }));
    const roy = s.append(msg({ at: T("2026-10-11T10:00:00+08:00"), fonds: "ROY", source: "import" }));
    expect(roy.archiveNo).toBe("ROY/2026-10-11#1");
    expect(roy.situation).toBeNull();
  });

  test("按档号取，省略年份按参考年补；显示时同年省略年份", () => {
    const s = open();
    const a = s.append(msg({ at: T("2026-10-13T08:00:00+08:00") }));
    const r = s.append(msg({ at: T("2026-10-11T08:00:00+08:00"), fonds: "ROY", source: "import" }));
    expect(s.byArchiveNo("10-13#1")?.id).toBe(a.id);
    expect(s.byArchiveNo("2026-10-13#1")?.id).toBe(a.id);
    expect(s.byArchiveNo("ROY/10-11#1")?.id).toBe(r.id);
    expect(s.byArchiveNo("10-13#9")).toBeNull();
    expect(displayArchiveNo("2026-10-13#112", 2026)).toBe("10-13#112");
    expect(displayArchiveNo("ROY/2026-10-11#40", 2026)).toBe("ROY/10-11#40");
    expect(displayArchiveNo("2027-01-02#5", 2026)).toBe("2027-01-02#5");
  });

  test("省略年份按本库时区的年份补，不按机器时区", () => {
    // 上海已是 2027-01-01 00:30，UTC 还在 2026 年
    const s = open(() => T("2027-01-01T00:30:00+08:00"));
    const e = s.append(msg());
    expect(e.archiveNo).toBe("2027-01-01#1");
    expect(s.byArchiveNo("01-01#1")?.id).toBe(e.id);
  });
});

describe("只追加", () => {
  test("幂等键：同一 source 重复上报只入库一次", () => {
    const s = open();
    const a = s.append(msg({ idem: "turn-1" }));
    const b = s.append(msg({ idem: "turn-1", payload: { text: "重发" } }));
    expect(b.id).toBe(a.id);
    expect(s.list()).toHaveLength(1);
    // 不同 source 的同名键互不影响
    s.append(msg({ idem: "turn-1", source: "claude-code" }));
    expect(s.list()).toHaveLength(2);
  });

  test("事件与关系都不能改、不能删", () => {
    const s = open();
    const a = s.append(msg());
    s.append({ kind: "episode", class: "self", source: "agent", payload: { text: "她说早，我有点紧张" }, links: [{ to: a.id, rel: "cites" }] });
    expect(() => s.db.run(`UPDATE events SET payload = '{}' WHERE id = ?`, [a.id])).toThrow(/只追加/);
    expect(() => s.db.run(`DELETE FROM events WHERE id = ?`, [a.id])).toThrow(/只追加/);
    expect(() => s.db.run(`DELETE FROM links`)).toThrow(/只追加/);
  });

  test("关系随事件写入，两头都查得到", () => {
    const s = open();
    const m = s.append(msg());
    const ep = s.append({ kind: "episode", class: "self", source: "agent", payload: { text: "她说早" }, links: [{ to: m.id, rel: "cites", props: { quote: true } }] });
    expect(s.linksFrom(ep.id)).toEqual([{ from: ep.id, to: m.id, rel: "cites", props: { quote: true } }]);
    expect(s.linksTo(m.id, "cites").map((l) => l.from)).toEqual([ep.id]);
  });

  test("通知订阅者", () => {
    const s = open();
    const seen: string[] = [];
    const off = s.subscribe((e) => seen.push(e.kind));
    s.append(msg());
    off();
    s.append(msg());
    expect(seen).toEqual(["message.in"]);
  });
});

describe("处境", () => {
  test("只在变化时写一条，之后的事件自动挂上", () => {
    const s = open();
    const s1 = s.setSituation({ harness: "roxy", model: "gemini-3.8-flash" });
    expect(s.setSituation({ model: "gemini-3.8-flash", harness: "roxy" }).id).toBe(s1.id); // 键顺序不同也算没变
    const e = s.append(msg());
    expect(e.situation).toBe(s1.id);
    const s2 = s.setSituation({ harness: "claude-code", model: "gemini-3.8-flash" });
    expect(s2.id).not.toBe(s1.id);
    expect(s.append(msg()).situation).toBe(s2.id);
    expect(s.list({ classes: ["situation"] })).toHaveLength(2);
  });

  test("晚到的事件挂发生那一刻的处境，不挂此刻的", () => {
    let now = T("2026-10-13T09:00:00+08:00");
    const s = open(() => now);
    const roxy = s.setSituation({ harness: "roxy" });
    now = T("2026-10-13T10:00:00+08:00");
    const cc = s.setSituation({ harness: "claude-code" });
    now = T("2026-10-13T10:05:00+08:00");
    expect(s.append(msg({ at: T("2026-10-13T09:30:00+08:00") })).situation).toBe(roxy.id);
    expect(s.append(msg()).situation).toBe(cc.id);
    expect(s.append(msg({ at: T("2026-10-13T08:00:00+08:00") })).situation).toBeNull(); // 那时还没有处境
  });

  test("重新打开库，当前处境还在", () => {
    const dir = mkdtempSync(join(tmpdir(), "psyche-"));
    const path = join(dir, "psyche.db");
    const a = new EventStore(path);
    const sit = a.setSituation({ harness: "roxy" });
    a.close();
    const b = new EventStore(path);
    expect(b.situation?.id).toBe(sit.id);
    expect(b.append(msg()).situation).toBe(sit.id);
    b.close();
  });
});

describe("资料库与系统日志", () => {
  test("内容寻址，同内容只存一份", () => {
    const s = open();
    const h1 = s.putMaterial("提示词 v1");
    const h2 = s.putMaterial("提示词 v1");
    expect(h1).toBe(h2);
    expect(s.getMaterial(h1)?.text()).toBe("提示词 v1");
    expect((s.db.query(`SELECT count(*) n FROM materials`).get() as { n: number }).n).toBe(1);
  });

  test("硬盘文件存路径 + 当时的快照", () => {
    const s = open();
    const dir = mkdtempSync(join(tmpdir(), "psyche-"));
    const f = join(dir, "diary.md");
    writeFileSync(f, "那天她很生气");
    const v1 = s.snapshotFile(f);
    writeFileSync(f, "那天她很生气（后来和好了）");
    const v2 = s.snapshotFile(f);
    expect(v1.hash).not.toBe(v2.hash);
    expect(s.getMaterial(v1.hash)?.text()).toBe("那天她很生气");
  });

  test("系统日志不进事件流", () => {
    const s = open();
    s.syslog("param.changed", { name: "x" });
    expect(s.list()).toHaveLength(0);
    expect(s.readSyslog()[0]).toMatchObject({ kind: "param.changed", detail: { name: "x" } });
  });
});

test("ULID 同一毫秒内单调递增", () => {
  const ids = Array.from({ length: 1000 }, () => ulid(1_790_000_000_000));
  expect([...ids].sort()).toEqual(ids);
  expect(new Set(ids).size).toBe(1000);
});

test("处境可以带 at：晚报的处境只给那段时间的事件挂，不顶替当前的", () => {
  let now = T("2026-10-13T10:00:00+08:00");
  const s = open(() => now);
  const cur = s.setSituation({ harness: "soma", session: "B" });
  const early = s.setSituation({ harness: "soma", session: "A" }, "soma", T("2026-10-13T09:00:00+08:00"));
  expect(s.situation?.id).toBe(cur.id);
  expect(s.append(msg({ at: T("2026-10-13T09:30:00+08:00") })).situation).toBe(early.id);
  expect(s.append(msg()).situation).toBe(cur.id);
});
