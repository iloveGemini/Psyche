/**
 * 自我的确定性考卷（notes/plan/m4.md §七.1）：出生冻结、只能一次、闸、历史、/v1/prompt 拼法。
 * 只考系统；它改不改、改成什么，不考。
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "../src/store/events.ts";
import { Projections } from "../src/store/projections.ts";
import { intake } from "../src/archive/intake.ts";
import { experienceProjector, readExperience } from "../src/archive/experience.ts";
import { createApp } from "../src/server/app.ts";
import { birth, filePrompt, letterText, lineDiff } from "../src/self/self.ts";
import { gather } from "../src/heartbeat/scheduler.ts";

const T = (s: string) => Date.parse(`${s}+08:00`);
const JSON_H = { "content-type": "application/json" };
const doc = (version: number, body: string) => `---\nversion: ${version}\nauthor: system\n---\n${body}\n`;

function setup() {
  let clock = T("2026-10-15T10:00:00");
  const store = new EventStore(":memory:", { now: () => clock });
  const projections = new Projections(store);
  projections.register(experienceProjector);
  projections.live();
  const dir = mkdtempSync(join(tmpdir(), "psyche-self-"));
  writeFileSync(join(dir, "mechanism.md"), doc(1, "# 机制\n记忆怎么运转。"));
  writeFileSync(join(dir, "self-v0.md"), doc(2, "## 起点\n你们是同伴。"));
  const app = createApp({ store, projections, promptsDir: dir });
  store.setSituation({ harness: "soma", session: "S1", selfPromptVersion: 0 }, "soma");
  const her = (text: string) => intake(store, { kind: "message.in", source: "soma", payload: { from: "Joy", text } });
  const get = async (path: string) => (await app.request(path)).json();
  const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers: JSON_H, body: JSON.stringify(body) });
  const no = (ev: { archiveNo: string }) => ev.archiveNo.replace(/^2026-/, "");
  const tick = (ms = 60_000) => (clock += ms);
  return { store, app, dir, her, get, post, no, tick };
}

describe("/v1/prompt 拼法", () => {
  test("没出生：机制 + 现读的初我，第 0 版；改文件立刻生效", async () => {
    const { get, dir } = setup();
    expect(await get("/v1/prompt")).toEqual({ text: "# 机制\n记忆怎么运转。\n\n## 起点\n你们是同伴。", version: 0, mechanismVersion: 1, born: false });
    writeFileSync(join(dir, "self-v0.md"), doc(3, "## 起点\n改过了。"));
    expect((await get("/v1/prompt")).text).toEndWith("改过了。");
    expect(filePrompt(dir)).toBe("# 机制\n记忆怎么运转。\n\n## 起点\n改过了。");
  });

  test("仓库里的提示词：只有机制段（10-17 起初我是空的，自述由它自己写）", () => {
    const t = filePrompt();
    expect(t.startsWith("# 你的记忆")).toBe(true);
    expect(t).not.toContain("## 你和 Joy");
  });
});

describe("出生", () => {
  test("冻结：之后改文件不影响；机制段照旧现读", async () => {
    const { store, get, dir } = setup();
    birth(store, { promptsDir: dir });
    writeFileSync(join(dir, "self-v0.md"), doc(3, "## 起点\n出厂的改了。"));
    writeFileSync(join(dir, "mechanism.md"), doc(2, "# 机制\n新版机制。"));
    const p = await get("/v1/prompt");
    expect(p).toEqual({ text: "# 机制\n新版机制。\n\n## 起点\n你们是同伴。", version: 0, mechanismVersion: 2, born: true });
  });

  test("只能一次", () => {
    const { store, dir } = setup();
    birth(store, { promptsDir: dir });
    expect(() => birth(store, { promptsDir: dir })).toThrow("只能出生一次");
    expect(store.readSyslog({ kind: "born" }).length).toBe(1);
  });

  test("不占档号：没有事件写进去", () => {
    const { store, dir } = setup();
    const before = store.list().length;
    birth(store, { promptsDir: dir });
    expect(store.list().length).toBe(before);
  });

  test("Joy 改过的初我：v0 是 Joy 那份，origin 两份都在、带 diff；和出厂一样就当没改", async () => {
    const a = setup();
    birth(a.store, { promptsDir: a.dir, userText: "## 起点\n你们是同伴。\n她喜欢猫。" });
    const s = await a.get("/v1/self");
    expect(s.prompt.text).toBe("## 起点\n你们是同伴。\n她喜欢猫。");
    expect(s.origin).toEqual({ system: "## 起点\n你们是同伴。", user: "## 起点\n你们是同伴。\n她喜欢猫。", diff: "  ## 起点\n  你们是同伴。\n+ 她喜欢猫。" });
    const b = setup();
    expect(birth(b.store, { promptsDir: b.dir, userText: "## 起点\n你们是同伴。\n" }).user).toBeNull();
  });

  test("出生前的改动和名字不带过去", async () => {
    const { store, get, post, her, no, dir } = setup();
    const ev = her("你可以改自己的提示词");
    expect((await post("/v1/self/prompt", { text: "测试时改的", why: "试试", cites: [no(ev)], baseVersion: 0 })).status).toBe(200);
    expect((await post("/v1/self/name", { name: "试名" })).status).toBe(200);
    expect((await get("/v1/prompt")).text).toEndWith("测试时改的");
    birth(store, { promptsDir: dir });
    const s = await get("/v1/self");
    expect([s.name, s.prompt.version, s.prompt.text, s.history]).toEqual([null, 0, "## 起点\n你们是同伴。", []]);
  });
});

describe("改自述的闸", () => {
  test("交全文 + why + 证据 → 新版；/v1/prompt 用新版；历史全文可取回", async () => {
    const { store, get, post, her, no, dir, tick } = setup();
    birth(store, { promptsDir: dir });
    const ev = her("你太客气了");
    tick();
    const r = await (await post("/v1/self/prompt", { text: "## 我\n说话直接。", why: "她说我太客气", cites: [no(ev)], baseVersion: 0 })).json();
    expect(r).toEqual({ version: 1, archiveNo: expect.stringMatching(/^10-15#\d+$/) });
    tick();
    await post("/v1/self/prompt", { text: "## 我\n说话直接，也会问。", why: "补一句", cites: [no(ev)], baseVersion: 1 });
    const p = await get("/v1/prompt");
    expect([p.version, p.text]).toEqual([2, "# 机制\n记忆怎么运转。\n\n## 我\n说话直接，也会问。"]);
    const s = await get("/v1/self");
    expect(s.prompt).toMatchObject({ version: 2, why: "补一句", evidence: [no(ev)], chars: 14 });
    expect(s.history.map((h: { version: number; chars: number }) => [h.version, h.chars])).toEqual([[1, 10], [2, 14]]);
    expect((await get("/v1/self/prompt/1")).text).toBe("## 我\n说话直接。");
    expect((await get("/v1/self/prompt/0")).text).toBe("## 起点\n你们是同伴。");
    expect((await app404(get, "/v1/self/prompt/9"))).toBe(true);
  });

  test("baseVersion 不是现行版本：拒", async () => {
    const { post, her, no } = setup();
    const ev = her("x");
    await post("/v1/self/prompt", { text: "一", why: "w", cites: [no(ev)], baseVersion: 0 });
    const r = await post("/v1/self/prompt", { text: "二", why: "w", cites: [no(ev)], baseVersion: 0 });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain("现行是第 1 版");
  });

  test("没挂证据 / 没写 why / 空全文：拒", async () => {
    const { post, her, no } = setup();
    const ev = her("x");
    for (const body of [
      { text: "一", why: "w", cites: [], baseVersion: 0 },
      { text: "一", why: "w", baseVersion: 0 },
      { text: "一", why: " ", cites: [no(ev)], baseVersion: 0 },
      { text: "", why: "w", cites: [no(ev)], baseVersion: 0 },
      { text: "一", why: "w", cites: [no(ev)] },
    ])
      expect((await post("/v1/self/prompt", body)).status).toBe(400);
  });

  test("引书架条目、处境、别的全宗：拒；情节可以引", async () => {
    const { store, post, her, no } = setup();
    const ev = her("x");
    const sem = store.append({ kind: "semantic.proposed", class: "self", source: "agent", payload: { shelf: "fact", text: "她喜欢猫" } });
    const roy = store.append({ kind: "message.in", class: "experience", source: "import", payload: { from: "Joy", text: "y" }, fonds: "ROY", situation: null });
    const ep = store.append({ kind: "episode", class: "self", source: "agent", payload: { text: "她说了 x" }, links: [{ to: ev.id, rel: "cites" }] });
    for (const c of [no(sem), no(store.situation!), roy.archiveNo]) {
      const r = await post("/v1/self/prompt", { text: "一", why: "w", cites: [c], baseVersion: 0 });
      expect([r.status, (await r.json()).error]).toEqual([400, expect.stringContaining("不能当证据")]);
    }
    expect((await post("/v1/self/prompt", { text: "一", why: "w", cites: [no(ep)], baseVersion: 0 })).status).toBe(200);
  });

  test("prompt.changed / named 不走上报口", () => {
    const { store } = setup();
    expect(() => intake(store, { kind: "prompt.changed", source: "agent", payload: { doc: { hash: "h" }, version: 1, why: "w" } })).toThrow("不走上报");
    expect(() => intake(store, { kind: "named", source: "agent", payload: { name: "某" } })).toThrow("不走上报");
  });
});

describe("名字", () => {
  test("取名、改名：现行是最新的，旧的留着；去空白、单行", async () => {
    const { store, get, post } = setup();
    expect((await get("/v1/self")).name).toBeNull();
    await post("/v1/self/name", { name: "  阿一 " });
    await post("/v1/self/name", { name: "阿二", why: "换个" });
    expect((await get("/v1/self")).name).toBe("阿二");
    expect(store.list({ kinds: ["named"] }).map((e) => (e.payload as { name: string }).name)).toEqual(["阿一", "阿二"]);
    expect((await post("/v1/self/name", { name: "两\n行" })).status).toBe(400);
    expect((await post("/v1/self/name", { name: " " })).status).toBe(400);
  });
});

describe("和别处的接线", () => {
  test("经历里：改自述、取名都有一行", async () => {
    const { store, post, her, no } = setup();
    const ev = her("x");
    await post("/v1/self/prompt", { text: "一", why: "她说我太客气", cites: [no(ev)], baseVersion: 0 });
    await post("/v1/self/name", { name: "阿一" });
    const texts = readExperience(store.db, {}).map((l) => l.text);
    expect(texts).toContainEqual(expect.stringMatching(/^我改写了自己那段提示词（第 1 版）\[\^\w{8}\]：她说我太客气$/));
    expect(texts).toContain("我给自己取名「阿一」");
  });

  test("<now>：这次会话用的版本比现行旧，才报一行", async () => {
    const { store, get, post, her, no } = setup();
    expect((await get("/v1/now")).text).not.toContain("自述");
    await post("/v1/self/prompt", { text: "一", why: "w", cites: [no(her("x"))], baseVersion: 0 });
    expect((await get("/v1/now")).text).toContain("自述：第 1 版，下次醒来生效（这次是第 0 版）");
    store.setSituation({ harness: "soma", session: "S2", selfPromptVersion: 1 }, "soma");
    expect((await get("/v1/now")).text).not.toContain("自述");
  });

  test("经历里：看自述不抄全文；改自述的调用不抄全文", async () => {
    const { renderExperience } = await import("../src/archive/render.ts");
    const ev = (kind: string, payload: object) => ({ kind, payload }) as Parameters<typeof renderExperience>[0];
    expect(renderExperience(ev("tool.call", { name: "mcp__psyche__self", callId: "1", args: {} }))).toBe("我看了看自己那段自述");
    expect(renderExperience(ev("tool.result", { name: "mcp__psyche__self", callId: "1", ok: true, text: "<self>…" }))).toBeNull();
    expect(renderExperience(ev("tool.call", { name: "mcp__psyche__rewrite_self", callId: "2", args: { text: "很长", baseVersion: 2 } }))).toBe("我交了一版新的自述（在第 2 版上改）");
  });

  test("lineDiff：一样返回 null", () => {
    expect(lineDiff("a\nb", "a\nb")).toBeNull();
    expect(lineDiff("a\nb", "a\nc")).toBe("  a\n- b\n+ c");
  });
});

async function app404(get: (p: string) => Promise<{ error?: string }>, path: string) {
  return (await get(path)).error === "没有这一版";
}

describe("出生时自述是空的、自己写（10-17）", () => {
  test("Joy 的信去掉注释后放进收件箱，是出生后的第一件经历；空的不递", () => {
    const { store, dir } = setup();
    writeFileSync(join(dir, "self-v0.md"), doc(3, ""));
    expect(letterText("<!-- 说明 -->\n\n")).toBe("");
    birth(store, { promptsDir: dir, letter: letterText("<!-- 写在下面 -->\n你好，欢迎来。") });
    const mails = store.list({ kinds: ["mail.in"] });
    expect(mails.map((e) => e.payload)).toEqual([{ from: "Joy", text: "你好，欢迎来。", via: "soma-note" }]);
    const other = setup();
    birth(other.store, { promptsDir: other.dir, letter: "" });
    expect(other.store.list({ kinds: ["mail.in"] })).toHaveLength(0);
  });

  test("调度器：出生了、自述空的 → 一次「出生」（排在来信前面）；带着系统初我出生的、没出生的不叫", () => {
    const { store } = setup();
    expect(gather(store).candidates.some((c) => c.by === "birth")).toBe(false);
    const empty = mkdtempSync(join(tmpdir(), "psyche-self-"));
    writeFileSync(join(empty, "mechanism.md"), doc(1, "# 机制"));
    writeFileSync(join(empty, "self-v0.md"), doc(3, ""));
    birth(store, { promptsDir: empty, letter: "欢迎" });
    const c = gather(store).candidates;
    expect(c[0]).toEqual({ by: "birth", key: "birth" });
    expect(c.some((x) => x.by === "mail")).toBe(true);
    const old = setup();
    birth(old.store, { promptsDir: old.dir });
    expect(gather(old.store).candidates.some((x) => x.by === "birth")).toBe(false);
  });
});

