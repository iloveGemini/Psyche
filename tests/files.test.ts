/**
 * 全屋的东西的确定性考卷（m8.md §6.2）：扫描比对、谁动的只在说得准时说、自己动的不报给自己、home 只主人看得到、递成一行行。
 */
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "../src/store/events.ts";
import { Projections } from "../src/store/projections.ts";
import { intake } from "../src/archive/intake.ts";
import { experienceProjector, readExperience } from "../src/archive/experience.ts";
import { filesTick, deliverFiles, diff, scan } from "../src/house/files.ts";

function setup() {
  const clock = { t: Date.parse("2026-10-16T21:00:00+08:00") };
  const mk = () => {
    const store = new EventStore(":memory:", { now: () => clock.t });
    const p = new Projections(store);
    p.register(experienceProjector);
    p.live();
    return store;
  };
  const a1 = mk();
  const a2 = mk();
  const root = mkdtempSync(join(tmpdir(), "files-"));
  const home1 = join(root, "a1-home");
  const commons = join(root, "commons");
  mkdirSync(home1, { recursive: true });
  mkdirSync(join(commons, "projects", "x"), { recursive: true });
  writeFileSync(join(home1, "门牌.md"), "a1");
  const residents = [
    { id: "a1", store: a1 },
    { id: "a2", store: a2 },
  ];
  const places = [
    { label: "home", dir: home1, owner: "a1" },
    { label: "commons", dir: commons, git: true },
  ];
  const state = { snaps: {} };
  const tick = () => filesTick(residents, places, state, clock.t);
  const percepts = (s: EventStore) => s.list({ kinds: ["percept"], fonds: "", limit: 100 }).map((e) => e.payload as any);
  const toolOn = (s: EventStore, args: unknown) => intake(s, { kind: "tool.call", source: "soma", payload: { name: "Write", callId: String(Math.random()), args } });
  return { clock, a1, a2, home1, commons, tick, percepts, toolOn, root };
}

test("扫描比对：多了、改了、没了；跳过点开头的", () => {
  const dir = mkdtempSync(join(tmpdir(), "scan-"));
  writeFileSync(join(dir, "a.md"), "1");
  mkdirSync(join(dir, ".git"));
  writeFileSync(join(dir, ".git", "x"), "1");
  const before = scan(dir);
  expect(Object.keys(before)).toEqual(["a.md"]);
  writeFileSync(join(dir, "a.md"), "22");
  writeFileSync(join(dir, "b.md"), "1");
  expect(diff(before, scan(dir))).toEqual([
    { path: "a.md", change: "modified" },
    { path: "b.md", change: "added" },
  ]);
  rmSync(join(dir, "a.md"));
  expect(diff(before, scan(dir)).map((d) => d.change)).toContain("removed");
});

test("第一圈只建快照；谁动的说得准才说；自己动的不报给自己；home 只主人看", () => {
  const h = setup();
  expect(h.tick()).toBe(0);
  // 有人改了 a1 的门牌，没有谁的工具碰过它
  writeFileSync(join(h.home1, "门牌.md"), "改过了");
  h.tick();
  expect(h.percepts(h.a1)).toEqual([{ sensor: "files", subject: "home/门牌.md", value: "modified" }]);
  expect(h.percepts(h.a2)).toEqual([]); // 别人的 home 看不到
  // a2 用工具在 commons 写了 STATE.md：a1 看得到是 a2，a2 自己不报
  const abs = join(h.commons, "projects", "x", "STATE.md");
  h.toolOn(h.a2, { file_path: abs, content: "…" });
  writeFileSync(abs, "a2 的一节");
  h.tick();
  expect(h.percepts(h.a1).at(-1)).toEqual({ sensor: "files", subject: "commons/projects/x/STATE.md", value: "added", by: "a2" });
  expect(h.percepts(h.a2)).toEqual([]);
  // a1 在自己 home 里用相对路径写：认得出是它，不报给它
  h.toolOn(h.a1, { command: "echo hi > 笔记.md" });
  writeFileSync(join(h.home1, "笔记.md"), "hi");
  h.tick();
  expect(h.percepts(h.a1).some((p) => p.subject === "home/笔记.md")).toBe(false);
});

test("递：压成一行行，说谁动的或不知道；递到的不进经历", () => {
  const h = setup();
  h.a1.setSituation({ harness: "soma", session: "s1" }, "soma");
  h.tick();
  writeFileSync(join(h.home1, "门牌.md"), "改1");
  h.tick();
  h.clock.t += 60_000;
  writeFileSync(join(h.home1, "门牌.md"), "改22");
  h.tick();
  const abs = join(h.commons, "projects", "x", "STATE.md");
  h.toolOn(h.a2, { file_path: abs });
  writeFileSync(abs, "x");
  h.tick();
  const text = deliverFiles(h.a1, "s1", (id) => (id === "a2" ? "Argon" : id))!;
  expect(text.split("\n")).toEqual([
    "全屋的东西：",
    "- home/门牌.md：被改过（这段时间变了 2 次），不知道是谁（21:01）",
    "- commons/projects/x/STATE.md：新出现，Argon动的（21:01）",
  ]);
  expect(deliverFiles(h.a1, "s1")).toBeNull();
  // 新会话（换段、睡着那段）：s1 递过的不再递；之后的变化照递，第二天看带日期
  expect(deliverFiles(h.a1, "s2")).toBeNull();
  writeFileSync(abs, "xy");
  h.tick();
  h.clock.t = Date.parse("2026-10-17T08:00:00+08:00");
  expect(deliverFiles(h.a1, "s3")).toBe("全屋的东西：\n- commons/projects/x/STATE.md：被改过，a2动的（10-16 21:01）");
  const lines = readExperience(h.a1.db, {}).map((l) => l.text);
  expect(lines.some((l) => l.includes("全屋的东西") || l.includes("感知"))).toBe(false);
});

test("commons 用 git：建库时把已有的提交一次；之后按谁动的分组提交，作者是住户（取了名用名字），认不出写「没认出」", () => {
  const h = setup();
  writeFileSync(join(h.commons, "README.md"), "约定");
  h.tick();
  const log = () =>
    Bun.spawnSync(["git", "-C", h.commons, "log", "--format=%an|%s", "--name-status"]).stdout.toString().trim().split("\n").filter(Boolean);
  expect(log()[0]).toBe("房子|房子：建库时已有的");
  h.a2.append({ kind: "named", class: "self", source: "agent", payload: { name: "Argon" } });
  const abs = join(h.commons, "projects", "x", "STATE.md");
  h.toolOn(h.a2, { file_path: abs });
  writeFileSync(abs, "x");
  writeFileSync(join(h.commons, "README.md"), "约定 2");
  h.tick();
  const l = log();
  expect(l).toContain("Argon|Argon：放了 projects/x/STATE.md");
  expect(l).toContain("没认出|没认出：改了 README.md");
  // 删了也记；home 不进 git
  h.clock.t += 10 * 60_000;
  rmSync(abs);
  h.tick();
  expect(log()[0]).toBe("没认出|没认出：删了 projects/x/STATE.md");
  expect(existsSync(join(h.home1, ".git"))).toBe(false);
});

