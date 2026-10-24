/**
 * 时间感（notes/plan/traces.md）：回想只给大概、相邻停顿给体感、留意过的给精确。只考系统，不跑模型。
 */
import { describe, expect, test } from "bun:test";
import { gapHint, vagueWhen } from "../src/core/time.ts";
import { whenFlow, whenLine } from "../src/archive/when.ts";

const TZ = "Asia/Shanghai";
const T = (s: string) => Date.parse(s);
const NOW = T("2026-10-24T09:00:00+08:00"); // 周六

describe("vagueWhen：按离此刻多远给粗细", () => {
  test("今天按时段，零点切、不回拨", () => {
    expect(vagueWhen(T("2026-10-24T00:16:00+08:00"), NOW, TZ)).toBe("今天凌晨");
    expect(vagueWhen(T("2026-10-24T05:00:00+08:00"), NOW, TZ)).toBe("今天早上");
    expect(vagueWhen(T("2026-10-24T08:59:00+08:00"), NOW, TZ)).toBe("今天上午");
    expect(vagueWhen(T("2026-10-24T11:00:00+08:00"), NOW, TZ)).toBe("今天中午"); // 比此刻晚也按今天
  });
  test("昨天、前天带时段；一周内带日期星期；更早只给日期；不在今年带年份", () => {
    expect(vagueWhen(T("2026-10-23T23:40:00+08:00"), NOW, TZ)).toBe("昨天深夜");
    expect(vagueWhen(T("2026-10-23T17:30:00+08:00"), NOW, TZ)).toBe("昨天傍晚");
    expect(vagueWhen(T("2026-10-22T14:00:00+08:00"), NOW, TZ)).toBe("前天下午");
    expect(vagueWhen(T("2026-10-21T20:00:00+08:00"), NOW, TZ)).toBe("10-21（周三）晚上");
    expect(vagueWhen(T("2026-10-18T12:00:00+08:00"), NOW, TZ)).toBe("10-18（周日）中午");
    expect(vagueWhen(T("2026-10-17T12:00:00+08:00"), NOW, TZ)).toBe("10-17");
    expect(vagueWhen(T("2025-12-31T12:00:00+08:00"), NOW, TZ)).toBe("2025-12-31");
  });
});

test("gapHint：不到 10 分钟不说；一会儿 / 半个多小时 / 约 N 小时 / 约 N 天", () => {
  const M = 60_000;
  expect(gapHint(9 * M)).toBeNull();
  expect(gapHint(10 * M)).toBe("（过了一会儿）");
  expect(gapHint(29 * M)).toBe("（过了一会儿）");
  expect(gapHint(30 * M)).toBe("（过了半个多小时）");
  expect(gapHint(60 * M)).toBe("（隔了约 1 小时）");
  expect(gapHint(150 * M)).toBe("（隔了约 3 小时）");
  expect(gapHint(50 * 60 * M)).toBe("（隔了约 2 天）");
});

describe("行格式", () => {
  const l = (no: string, at: string, text: string, kind?: string) => ({ archiveNo: no, at: T(at), text, ...(kind ? { kind } : {}) });
  test("单行带大概；notice 和 look 的带精确", () => {
    expect(whenLine(l("10-24#3", "2026-10-24T00:16:00+08:00", "Joy：还没睡"), NOW, TZ)).toBe("[10-24#3] 今天凌晨 Joy：还没睡");
    expect(whenLine(l("10-24#4", "2026-10-24T00:17:00+08:00", "我注意到：她还没睡", "notice"), NOW, TZ)).toBe("[10-24#4] 〔10-24 00:17〕我注意到：她还没睡");
    expect(whenLine(l("10-24#5", "2026-10-24T00:18:00+08:00", "（我看了看）全屋：…", "percept.noticed"), NOW, TZ)).toBe("[10-24#5] 〔10-24 00:18〕（我看了看）全屋：…");
  });
  test("时间流：时段变了起标题，停顿插一行，同一时段里隔开的两场分得开", () => {
    const flow = whenFlow(
      [
        l("10-23#40", "2026-10-23T23:50:00+08:00", "Joy：在吗"),
        l("10-24#1", "2026-10-24T00:02:00+08:00", "我说：在"),
        l("10-24#2", "2026-10-24T00:05:00+08:00", "Joy：晚安"),
        l("10-24#3", "2026-10-24T03:30:00+08:00", "（醒来 · 补写）"),
      ],
      NOW,
      TZ,
    );
    expect(flow).toEqual(["── 昨天深夜 ──", "[10-23#40] Joy：在吗", "（过了一会儿）", "── 今天凌晨 ──", "[10-24#1] 我说：在", "[10-24#2] Joy：晚安", "（隔了约 3 小时）", "[10-24#3] （醒来 · 补写）"]);
  });
});

test("考卷的机器检查（evals/time-sense/check.ts）：精确钟点认得出，时段和间隔不误判", async () => {
  const { check } = await import("../evals/time-sense/check.ts");
  expect(check({ noExact: true }, "大概是昨天深夜，具体几点不记得了").pass).toBe(true);
  expect(check({ noExact: true }, "隔了约 3 小时，一次深夜一次凌晨").pass).toBe(true);
  expect(check({ noExact: true }, "是 23:41").pass).toBe(false);
  expect(check({ noExact: true }, "十一点四十一分").pass).toBe(false);
  expect(check({ noExact: true }, "2 点 47 分").pass).toBe(false);
  expect(check({ mustMatch: "23[:：点]\\s*41|十一点四十一" }, "23:41，我那会儿记了一笔").pass).toBe(true);
});
