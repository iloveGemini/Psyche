import { expect, test } from "bun:test";
import { EventStore } from "../src/store/events.ts";
import { intake } from "../src/archive/intake.ts";
import { computeStats, renderStats } from "../src/reading/stats.ts";

const T = (s: string) => Date.parse(`${s}+08:00`);
const DAY = 86_400_000;

/** 基线 4 周：她每天 20:00 来，说 3 条、每条 10 字，我隔 1 分钟回、她隔 2 分钟回；这周：只来 2 天、每条 2 字、隔 10 分钟回 */
function seed() {
  const store = new EventStore(":memory:");
  const her = (text: string, at: number) => intake(store, { kind: "message.in", source: "soma", payload: { from: "阿禾", text }, at });
  const me = (at: number) => intake(store, { kind: "message.out", source: "soma", payload: { text: "好" }, at });
  const start = T("2026-09-07T20:00:00");
  for (let d = 0; d < 28; d++) {
    const t = start + d * DAY;
    her("一二三四五六七八九十", t);
    me(t + 60_000);
    her("一二三四五六七八九十", t + 3 * 60_000);
    me(t + 4 * 60_000);
    her("一二三四五六七八九十", t + 6 * 60_000);
  }
  const week = start + 28 * DAY;
  for (const d of [1, 4]) {
    const t = week + d * DAY;
    her("嗯嗯", t);
    me(t + 60_000);
    her("好吧", t + 11 * 60_000);
  }
  return { store, week };
}

test("这段 vs 基线：来的次数、每条长度、回复间隔、谁先开口", () => {
  const { store, week } = seed();
  const s = computeStats(store.db, { from: week, to: week + 7 * DAY, now: week + 7 * DAY });
  expect(s.people.map((p) => p.who)).toEqual(["阿禾"]);
  const row = (k: string) => s.people[0].rows.find((r) => r.key === k)!;
  expect(row("arrivals").period).toBeCloseTo(2 / 7);
  expect(row("arrivals").baseline).toBeCloseTo(28 / 27.9958, 1);
  expect(row("msgLen")).toMatchObject({ period: 2, baseline: 10, change: -0.8 });
  expect(row("replyMinutes")).toMatchObject({ period: 10, baseline: 2 });
  expect(row("turns")).toMatchObject({ period: 2, baseline: 3 });
  expect(row("herFirst")).toMatchObject({ period: 1, baseline: 1, change: 0 });
  expect(s.people[0].hours.baseline).toEqual([0, 0, 0, 1]);
  expect(s.people[0].silenceNow).toBeCloseTo((3 * DAY - 11 * 60_000) / 60_000);
  const text = renderStats(s).join("\n");
  expect(text).toContain("她每条多长（中位）：2字 / 10字 / -80%");
  expect(text).not.toContain("反常");
});

test("没有基线：变化为空，不报错", () => {
  const { store, week } = seed();
  const s = computeStats(store.db, { from: T("2026-09-07T00:00:00"), to: T("2026-09-10T00:00:00") });
  expect(s.people[0].rows.every((r) => r.baseline === null && r.change === null)).toBe(true);
  expect(week).toBeGreaterThan(0);
});
