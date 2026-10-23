/**
 * Dashboard 观测与管理台确定性考卷（notes/design/dashboard.md §五）：
 * 1. GET /v1/house 扩展字段与 GET /dashboard 静态壳
 * 2. POST /v1/house/residents 出生冻结与新住户热挂载
 * 3. GET /v1/health 记忆体检指标、闭环预警 (no_against / stale)、私密封条计数
 * 4. GET /v1/shelf/:no 演变与证据链、GET /v1/gist 已写梗概列表
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "../src/store/events.ts";
import { Projections } from "../src/store/projections.ts";
import { experienceProjector } from "../src/archive/experience.ts";
import { shelfProjector } from "../src/reading/shelf.ts";
import { createApp } from "../src/server/app.ts";
import { createHouse } from "../src/server/house.ts";
import { openHouse } from "../src/house/house.ts";
import { intake } from "../src/archive/intake.ts";

const T = (s: string) => Date.parse(`${s}+08:00`);
const JSON_H = { "content-type": "application/json" };

function mkResident(clock: { t: number }, token?: string) {
  const store = new EventStore(":memory:", { now: () => clock.t });
  const projections = new Projections(store);
  projections.register(experienceProjector);
  projections.register(shelfProjector);
  projections.live();
  const app = createApp({ store, projections, token });
  return { store, projections, app };
}

describe("Dashboard：全屋总览与住户出生", () => {
  test("GET /dashboard 免鉴权返回静态面板；GET /v1/house 带 born / wake / pulse", async () => {
    const clock = { t: T("2026-10-16T10:00:00") };
    const dir = mkdtempSync(join(tmpdir(), "psyche-dash-"));
    const a1 = mkResident(clock);
    const viewers = [{ id: "a1", store: a1.store }];
    const apps = new Map([["a1", a1.app.fetch]]);
    const house = openHouse(dir, viewers, () => clock.t);
    const server = createHouse(apps, { tokens: [], handle: house.handle });

    // 静态入口
    const htmlRes = await server(new Request("http://psyche/dashboard"));
    expect(htmlRes.status).toBe(200);
    expect(htmlRes.headers.get("content-type")).toContain("text/html");
    expect(await htmlRes.text()).toContain("Psyche 档案馆与阅览室");

    // 未出生时的脉搏与状态
    a1.store.setSituation({ harness: "soma", session: "s1" }, "soma");
    intake(a1.store, { kind: "message.in", source: "soma", payload: { from: "Joy", text: "早安" } });
    intake(a1.store, { kind: "message.out", source: "soma", payload: { text: "早！" } });

    const h1 = await (await server(new Request("http://psyche/v1/house"))).json();
    expect(h1.residents[0]).toMatchObject({
      id: "a1",
      born: null,
      wake: { paused: false, heartbeat: false, budget: { used: 0, of: 3 } },
      pulse: { episodes: 0, uncoveredLines: 2, shelf: 0, openThreads: 0 },
    });
  });

  test("POST /v1/house/residents：给已有住户出生、热挂载新住户、重复出生与非法 id 被拒", async () => {
    const clock = { t: T("2026-10-16T11:00:00") };
    const dir = mkdtempSync(join(tmpdir(), "psyche-dash-birth-"));
    const a1 = mkResident(clock);
    const viewers = [{ id: "a1", store: a1.store }];
    const apps = new Map<string, (req: Request) => Response | Promise<Response>>([["a1", a1.app.fetch]]);
    const house = openHouse(dir, viewers, () => clock.t, undefined, [], {
      onAddResident: (r) => {
        const store = new EventStore(join(r.dir, "psyche.db"), { now: () => clock.t });
        const projections = new Projections(store);
        projections.register(experienceProjector);
        projections.register(shelfProjector);
        projections.live();
        const app = createApp({ store, projections });
        apps.set(r.id, app.fetch);
        return { id: r.id, store };
      },
    });
    const server = createHouse(apps, { tokens: [], handle: house.handle });

    const postResident = (body: unknown) =>
      server(new Request("http://psyche/v1/house/residents", { method: "POST", headers: JSON_H, body: JSON.stringify(body) }));

    // 1. 已有空库住户 a1 出生
    const r1 = await postResident({ id: "a1", model: "claude-opus-5-5" });
    expect(r1.status).toBe(200);
    expect(await r1.json()).toMatchObject({
      id: "a1",
      born: { model: "claude-opus-5-5", hasUserDiff: false },
    });

    // 重复出生被拒
    expect((await postResident({ id: "a1", model: "claude-opus-5-5" })).status).toBe(400);

    // 2. 新住户 a2 自动建库、写 agents.json 并热挂载
    const r2 = await postResident({ id: "a2", model: "gemini-4-argon", userText: "Joy 定制的初我起点。" });
    expect(r2.status).toBe(200);
    expect(await r2.json()).toMatchObject({
      id: "a2",
      born: { model: "gemini-4-argon", hasUserDiff: true },
    });
    expect(existsSync(join(dir, "a2", "psyche.db"))).toBe(true);
    const agentsJson = JSON.parse(readFileSync(join(dir, "agents.json"), "utf8"));
    expect(agentsJson.a2.model).toBe("gemini-4-argon");

    // 无需重启即可调 a2 的 /v1/self
    const selfRes = await server(new Request("http://psyche/v1/self?agent=a2"));
    expect(selfRes.status).toBe(200);
    const selfData = await selfRes.json();
    expect(selfData.born).toBe(true);
    expect(selfData.origin.diff).toContain("+ Joy 定制的初我起点。");

    // 3. 非法 id 或缺 model 返回 400
    expect((await postResident({ id: "Bad Id!", model: "x" })).status).toBe(400);
    expect((await postResident({ id: "a3", model: "" })).status).toBe(400);
  });
});

describe("Dashboard：记忆体检、闭环预警与书架证据链", () => {
  test("GET /v1/health、GET /v1/shelf/:no 与 GET /v1/gist 完整闭环", async () => {
    const clock = { t: T("2026-10-14T23:30:00") };
    const { store, app } = mkResident(clock);
    const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers: JSON_H, body: JSON.stringify(body) });

    // 1. 产生 3 段不同时间的对话
    store.setSituation({ harness: "soma", session: "s1" }, "soma");
    const m1 = intake(store, { kind: "message.in", source: "soma", payload: { from: "Joy", text: "困" } });
    const m2 = intake(store, { kind: "message.out", source: "soma", payload: { text: "早点休息" } });

    // 热写前：2 行未覆盖
    let health = await (await app.request("/v1/health")).json();
    expect(health.hotwrite.uncoveredLines).toBe(2);
    expect(health.hotwrite.uncoveredSessions).toBe(1);

    // 热写第 1 段（2 行压成 1 条带 felt 的情节）
    const seg1 = await (await app.request("/v1/hotwrite?session=s1")).json();
    const hw1 = await (
      await post("/v1/hotwrite", {
        session: "s1",
        upTo: seg1.upTo,
        entries: [{ text: "深夜她说困了，我劝她早点休息。", felt: "温和", cites: [m1.archiveNo, m2.archiveNo] }],
      })
    ).json();
    const ep1No = hw1.episodes[0].archiveNo;

    // 热写后：未覆盖清零，压缩比 2:1，带感受占比 1
    health = await (await app.request("/v1/health")).json();
    expect(health.hotwrite.uncoveredLines).toBe(0);
    expect(health.hotwrite.episodesTotal).toBe(1);
    expect(health.hotwrite.compressionRatio7d).toBe(2);
    expect(health.hotwrite.withFeltRatio).toBe(1);

    // 2. 次日与第三日再产生两段独立经历，用于提议规律并攒满 3 次印证
    clock.t = T("2026-10-15T23:40:00");
    store.setSituation({ harness: "soma", session: "s2" }, "soma");
    const m3 = intake(store, { kind: "message.in", source: "soma", payload: { from: "Joy", text: "嗯" } });

    clock.t = T("2026-10-16T08:00:00");
    store.setSituation({ harness: "soma", session: "s3" }, "soma");
    const m4 = intake(store, { kind: "message.in", source: "soma", payload: { from: "Joy", text: "好" } });

    // 冷写：提议一条 mirror，挂 3 个不同会话的证据（for = 3, against = 0, revisions = 0）
    const cw1 = await (await app.request("/v1/coldwrite")).json();
    const cwRes = await post("/v1/coldwrite", {
      upTo: cw1.upTo,
      entries: [
        {
          op: "propose",
          shelf: "mirror",
          text: "她回单字时是不耐烦",
          when: "她只回一个字",
          then: "她不想继续聊",
          observe: "随后不再回复",
          watch: ["困", "嗯", "好"],
          cites: [ep1No, m3.archiveNo, m4.archiveNo],
        },
      ],
    });
    expect(cwRes.status).toBe(200);
    const mirrorNo = (await cwRes.json()).written[0].archiveNo;

    // 此时 for = 3, against = 0, revisions = 0 → 触发 no_against 闭环预警！
    health = await (await app.request("/v1/health")).json();
    expect(health.coldwrite.warnings).toEqual([
      expect.objectContaining({
        archiveNo: mirrorNo,
        shelf: "mirror",
        reason: "no_against",
        for: 3,
        against: 0,
        revisions: 0,
      }),
    ]);

    // 3. 出现一条反例并 revise 收窄条件 → 预警自动解除
    clock.t = T("2026-10-16T12:00:00");
    const m5 = intake(store, { kind: "message.in", source: "soma", payload: { from: "Joy", text: "刚才回单字是因为困，不是烦你" } });
    const cw2 = await (await app.request("/v1/coldwrite")).json();
    const cwRes2 = await post("/v1/coldwrite", {
      upTo: cw2.upTo,
      entries: [
        { op: "evidence", target: mirrorNo, stance: "against", note: "她说明深夜单字是困", cites: [m5.archiveNo] },
        { op: "revise", target: mirrorNo, why: "区分深夜犯困与白天单字", when: "白天她只回一个字", cites: [m5.archiveNo] },
      ],
    });
    expect(cwRes2.status).toBe(200);

    health = await (await app.request("/v1/health")).json();
    expect(health.coldwrite.warnings).toEqual([]);

    // 4. GET /v1/shelf/:no 完整返回两个版本与 4 条证据（3 for + 1 against）
    const detailRes = await app.request(`/v1/shelf/${encodeURIComponent(mirrorNo)}`);
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json();
    expect(detail.versions).toHaveLength(2);
    expect(detail.versions[0].kind).toBe("semantic.proposed");
    expect(detail.versions[1]).toMatchObject({ kind: "semantic.revised", why: "区分深夜犯困与白天单字" });
    expect(detail.evidences.map((e: any) => e.stance)).toEqual(["for", "for", "for", "against"]);
    expect(detail.evidences[3].note).toBe("她说明深夜单字是困");

    // 5. 写天梗概后 GET /v1/gist 带出 gists 数组与字数
    const gistRes = await post("/v1/gist", { span: "day", key: "2026-10-14", text: "10-14 深夜她困了去睡。" });
    expect(gistRes.status).toBe(200);
    const gistData = await (await app.request("/v1/gist")).json();
    expect(gistData.gists).toEqual([
      expect.objectContaining({ span: "day", key: "2026-10-14", text: "10-14 深夜她困了去睡。", chars: 14 }),
    ]);

    // 6. 私密自留地计数：写日记、收未读信与住户间信，只返计数不露正文
    await post("/v1/diary", { title: "深夜随笔", text: "这是一段不应该出现在体检正文里的私人日记内容" });
    await post("/v1/mail/in", { from: "Joy", text: "给你的留言", via: "soma-note" });
    await post("/v1/mail/in", { from: "a2", text: "隔壁住户的私信", via: "soma-note" });

    health = await (await app.request("/v1/health")).json();
    expect(health.privateCounts).toMatchObject({
      diaries: 1,
      peerMails: 1,
      unreadMails: 2,
    });
    expect(JSON.stringify(health)).not.toContain("私人日记内容");
    expect(JSON.stringify(health)).not.toContain("隔壁住户的私信");
  });

  test("GET /v1/house/feed、GET /v1/archive/:no/context、GET /v1/surfaced 与经历检索", async () => {
    const clock = { t: T("2026-10-16T15:00:00") };
    const { store, app } = mkResident(clock);
    const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers: JSON_H, body: JSON.stringify(body) });

    // 1. 产生对话并写情节
    store.setSituation({ harness: "soma", session: "s_feed" }, "soma");
    const m1 = intake(store, { kind: "message.in", source: "soma", payload: { from: "Joy", text: "今天天气很好" } });
    const m2 = intake(store, { kind: "message.out", source: "soma", payload: { text: "适合散步" } });
    const seg = await (await app.request("/v1/hotwrite?session=s_feed")).json();
    const hw = await (
      await post("/v1/hotwrite", {
        session: "s_feed",
        upTo: seg.upTo,
        entries: [{ text: "晴天她提起天气，我建议去散步。", felt: "舒适", cites: [m1.archiveNo, m2.archiveNo] }],
      })
    ).json();
    const epNo = hw.episodes[0].archiveNo;

    // 2. 模拟一条潜意识浮现 surfaced 事件
    intake(store, {
      kind: "surfaced",
      source: "recall",
      payload: {
        ref: hw.episodes[0].id,
        score: 0.88,
        cue: "讨论周末去哪里玩",
        source: "recall",
      },
    });

    // 3. 测试 GET /v1/surfaced
    const surfRes = await (await app.request("/v1/surfaced")).json();
    expect(surfRes.surfaced).toHaveLength(1);
    expect(surfRes.surfaced[0]).toMatchObject({
      score: 0.88,
      cue: "讨论周末去哪里玩",
      ref: expect.objectContaining({
        archiveNo: expect.stringContaining("10-16#4"),
        kind: "episode",
        text: "晴天她提起天气，我建议去散步。",
      }),
    });

    // 4. 测试 GET /v1/archive/:no/context 展开上下文
    const ctxRes = await (await app.request(`/v1/archive/${encodeURIComponent(epNo)}/context`)).json();
    expect(ctxRes.event.archiveNo).toContain("10-16#4");
    expect(ctxRes.cited).toHaveLength(2);
    expect(ctxRes.context.length).toBeGreaterThanOrEqual(3);
    expect(ctxRes.context.some((c: any) => c.isSelf)).toBe(true);

    // 5. 测试 GET /v1/experience 增强参数（q / kind / order）
    const expQ = await (await app.request("/v1/experience?q=散步")).json();
    expect(expQ.lines).toHaveLength(1);
    expect(expQ.lines[0].archiveNo).toContain(epNo);

    const expEpisode = await (await app.request("/v1/experience?kind=episode")).json();
    expect(expEpisode.lines).toHaveLength(1);
    expect(expEpisode.lines[0].kind).toBe("episode");

    // 6. 全屋动态流 GET /v1/house/feed
    const dir = mkdtempSync(join(tmpdir(), "psyche-feed-"));
    const viewers = [{ id: "a1", store }];
    const house = openHouse(dir, viewers, () => clock.t);
    const feedRes = await house.handle(new Request("http://psyche/v1/house/feed"));
    expect(feedRes.status).toBe(200);
    const feedData = await feedRes.json();
    expect(feedData.feed.length).toBeGreaterThan(0);
    expect(feedData.feed.some((item: any) => item.kind === "episode" && item.residentId === "a1")).toBe(true);

    // 7. 常驻记忆区 GET /v1/pinned
    const pinRes = await app.request("/v1/pinned");
    expect(pinRes.status).toBe(200);
    const pinData = await pinRes.json();
    expect(pinData).toMatchObject({
      used: expect.any(Number),
      budget: 1200,
      entries: expect.any(Array),
      history: expect.any(Array),
    });
  });
});
