import { expect, test } from "bun:test";
import { EventStore } from "../src/store/events.ts";
import { build, lineTimes, loadScript, shanghai } from "../evals/cold-write/build.ts";

test("剧本时刻倒退 = 过了零点", () => {
  const t = lineTimes("2026-10-08", [["23:40", "her", "a"], ["00:40", "her", "b"]]);
  expect(t[1] - t[0]).toBe(60 * 60_000);
  expect(t[1]).toBe(shanghai("2026-10-09", "00:40"));
});

test("入到 s1 再到 s2：幂等，按会话挂处境", () => {
  const store = new EventStore(":memory:");
  const script = loadScript();
  expect(build(store, script, "s1")).toEqual(["cw-d1", "cw-d2", "cw-d3a", "cw-d3b"]);
  build(store, script, "s2");
  build(store, script, "s2");
  const msgs = script.sessions.reduce((n, s) => n + s.lines.length, 0);
  const n = store.db.query(`SELECT COUNT(*) AS n FROM events WHERE kind LIKE 'message.%'`).get() as { n: number };
  expect(n.n).toBe(msgs);
  const bad = store.db
    .query(`SELECT COUNT(*) AS n FROM events e JOIN events s ON s.id = e.situation
            WHERE e.kind LIKE 'message.%' AND json_extract(s.payload, '$.session') <> json_extract(e.payload, '$.session')`)
    .get() as { n: number };
  expect(bad.n).toBe(0);
});
