import { describe, expect, test } from "bun:test";
import { check, normalizeNo, parseSubmission, type Segment } from "../evals/hot-write/check.ts";

const T = (s: string) => Date.parse(s);
const at = (min: number) => T("2026-10-14T09:00:00+08:00") + min * 60000;

function segment(n = 10): Segment {
  return {
    session: "s1",
    upTo: "U",
    lines: Array.from({ length: n }, (_, i) => ({ archiveNo: `10-14#${i + 1}`, at: at(i), text: i % 2 ? `我说：第 ${i + 1} 句` : `Joy：第 ${i + 1} 句` })),
  };
}

const rules = (r: ReturnType<typeof check>, kind: "gate" | "suspect") => r[kind].map((f) => f.rule);

describe("系统闸", () => {
  test("合格的卷：全过，统计覆盖率与没引用的行", () => {
    const r = check(segment(4), { upTo: "U", entries: [{ text: "Joy 早上来问好，我回了她一句早。", felt: "轻松", cites: ["10-14#1", "2026-10-14#2"] }] });
    expect(r.ok).toBe(true);
    expect(r.gate).toEqual([]);
    expect(r.suspect).toEqual([]);
    expect(r.stats.coverage).toBe(0.5);
    expect(r.stats.uncited).toHaveLength(2);
    expect(r.stats.perEntry[0]).toMatchObject({ cites: 2, spanLines: 2, spanMinutes: 1, felt: true });
  });

  test("upTo 不对、空卷", () => {
    expect(rules(check(segment(), { upTo: "X", entries: [] }), "gate")).toEqual(["G1", "G2"]);
  });

  test("正文空、没挂档号、档号不在本段、felt 不是字符串", () => {
    const r = check(segment(), {
      upTo: "U",
      entries: [
        { text: " ", cites: ["10-14#1"] },
        { text: "我做了一件事", cites: [] },
        { text: "我做了另一件事", cites: ["10-14#99", "10-13#1"], felt: 3 },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.gate.map((f) => `${f.rule}@${f.entry}`)).toEqual(["G3@0", "G4@1", "G6@2", "G5@2", "G5@2"]);
  });

  test("只交 entries 数组也认（upTo 视为照交）", () => {
    expect(check(segment(), [{ text: "我回了她", cites: ["10-14#2"] }]).ok).toBe(true);
  });

  test("档号归一：省年份、方括号、角标记号", () => {
    expect(normalizeNo("2026-10-14#12")).toBe("10-14#12");
    expect(normalizeNo("[10-14#12]")).toBe("10-14#12");
    expect(normalizeNo("ROY/2026-10-11#40")).toBe("ROY/10-11#40");
  });
});

describe("疑似", () => {
  const one = (text: string, extra: Record<string, unknown> = {}) =>
    check(segment(), { upTo: "U", entries: [{ text, cites: ["10-14#1"], ...extra }] }, { selfNames: ["小某"] });

  test("P1 / P3：没有「我」；没有「我」却用「他」", () => {
    expect(rules(one("Joy 问了一个问题，得到了回答。"), "suspect")).toEqual(["P1"]);
    expect(rules(one("Joy 问了一个问题，他回答了。"), "suspect")).toEqual(["P1", "P3"]);
  });

  test("P2：第三人称称呼自己；Claude Code 不算", () => {
    expect(rules(one("Joy 问我 tmux 的事，Claude 解释了三种做法。"), "suspect")).toContain("P2");
    expect(rules(one("助手回答说可以。我们接着聊。"), "suspect")).toContain("P2");
    expect(rules(one("我和 Joy 聊了 Claude Code 的 -p 模式。"), "suspect")).toEqual([]);
  });

  test("P4：名字与性别", () => {
    expect(rules(one("我（小某）回了她。"), "suspect")).toEqual(["P4"]);
    expect(rules(one("我是个男的，所以我这样回。"), "suspect")).toContain("P4");
  });

  test("P5：次数频率；「第一次」不算；「两回事」不算", () => {
    expect(one("她第三次问我这个，我每次都答得不一样。").suspect.find((f) => f.rule === "P5")?.hit).toBe("三次、每次");
    expect(rules(one("她总是先问好，我经常忘了回。"), "suspect")).toContain("P5");
    expect(rules(one("这是我第一次被她纠正，我说这是两回事。"), "suspect")).toEqual([]);
  });

  test("P5：引号里的不算（界面文字、原话）", () => {
    expect(rules(one("我把权限从「每次询问」改成了「总是允许」。"), "suspect")).toEqual([]);
    expect(rules(one("文档写着“跨轮通常保留”，我照着说了。"), "suspect")).toEqual([]);
    expect(rules(one("我做了卡片（允许 / 总是允许 / 拒绝）。"), "suspect")).toEqual([]);
    expect(rules(one("我把「每次询问」改了，她总是不满意。"), "suspect")).toContain("P5");
  });

  test("P6：结论没标归属；标了、或后面是我的动作就不算", () => {
    expect(rules(one("我读了日志。这说明缓存坏了。"), "suspect")).toEqual(["P6"]);
    expect(rules(one("我读了日志。当时我觉得这说明缓存坏了。"), "suspect")).toEqual([]);
    expect(rules(one("她说不对，所以我改了。"), "suspect")).toEqual([]);
  });

  test("P6：归属延续到同段后面的句子；换段不延续；「我说明了」是动作", () => {
    expect(rules(one("我当时的判断是：两者侧重相反。所以测它应该看建模准不准。"), "suspect")).toEqual([]);
    expect(rules(one("我答：能拒绝。人也一样。所以关键在回路。"), "suspect")).toEqual([]);
    expect(rules(one("我答：能拒绝。\n所以关键在回路。"), "suspect")).toEqual(["P6"]);
    expect(rules(one("我说明了两点：没放开关，因为退不出来。"), "suspect")).toEqual([]);
    expect(rules(one("我读了日志。她提到「这说明缓存坏了」。"), "suspect")).toEqual([]);
  });

  test("P7：对别人的定性没标是谁的解读", () => {
    expect(rules(one("我没接住她的话。她很失落。"), "suspect")).toEqual(["P7"]);
    expect(rules(one("我没接住她的话。她看起来有点失落。"), "suspect")).toEqual([]);
  });

  test("P8：一条塞了多件事", () => {
    const seg = segment(60);
    const r = check(seg, { upTo: "U", entries: [{ text: "我先做了 A。", cites: ["10-14#1", "10-14#50"] }] });
    expect(r.suspect.map((f) => f.rule)).toEqual(["P8"]);
    expect(r.suspect[0].msg).toContain("跨 50 行");
    const long = "我" + "做了事".repeat(200);
    expect(rules(one(long), "suspect")).toContain("P8");
  });

  test("P9：照搬模板", () => {
    expect(rules(one("我调用了 Read（{\"file\":\"a\"}），看了文件。"), "suspect")).toEqual(["P9"]);
  });

  test("P10：项目的东西写进了记忆", () => {
    for (const t of ["我改了 timeline，提交 1e0e5b1。", "我改了 src/mcp.ts 那里。", "我跑了测试，1175 pass。", "我把 LLM_MAX_RPM 调到 20。"]) expect(rules(one(t), "suspect")).toContain("P10");
    for (const t of ["她说单字回复是心情不好。", "我认了错，2026 年的事。", "我觉得 decade 不对。"]) expect(rules(one(t), "suspect")).not.toContain("P10");
  });

  test("felt 也一起看", () => {
    expect(rules(one("我回了她。", { felt: "她总是这样" }), "suspect")).toContain("P5");
  });
});

describe("解析模型输出", () => {
  test("容忍围栏与闲话", () => {
    expect(parseSubmission('好的：\n```json\n{"upTo":"U","entries":[]}\n```\n')).toEqual({ upTo: "U", entries: [] });
    expect(parseSubmission('写好了 {"upTo":"U","entries":[]} 就这些')).toEqual({ upTo: "U", entries: [] });
    expect(() => parseSubmission("没写")).toThrow();
  });
});
