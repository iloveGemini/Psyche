/**
 * 这台 Mac 这一路的确定性考卷（mcp/mac，m8.md §6.5）：读数怎么压成要报的、防抖、天气只报种类变化、看屏幕要 Joy 开放、记账。
 * 不读真的 ioreg / 屏幕。
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { deskOf, step, weatherStep, type FeedState, type WeatherState } from "../mcp/mac/sense.ts";
import { readConfig } from "../mcp/mac/config.ts";
import { createServer } from "../mcp/mac/screen.ts";

describe("键鼠与锁屏", () => {
  test("三态；中间那段不翻；刚解锁算在用", () => {
    expect(deskOf({ locked: true, idleSeconds: 5 })).toBe("locked");
    expect(deskOf({ locked: false, idleSeconds: 30 })).toBe("active");
    expect(deskOf({ locked: false, idleSeconds: 900 })).toBe("idle");
    expect(deskOf({ locked: false, idleSeconds: 300 }, "idle")).toBe("idle");
    expect(deskOf({ locked: false, idleSeconds: 300 }, "active")).toBe("active");
    expect(deskOf({ locked: false, idleSeconds: 300 }, "locked")).toBe("active");
  });

  test("只报变了的；desk 没开放不报", () => {
    const s: FeedState = {};
    expect(step(s, { locked: false, idleSeconds: 10 }).map((r) => r.value)).toEqual(["active"]);
    expect(step(s, { locked: false, idleSeconds: 50 })).toEqual([]);
    expect(step(s, { locked: true })[0]).toMatchObject({ sensor: "joy.mac", subject: "desk", value: "locked", text: "Joy 的电脑锁屏了" });
    expect(step({}, { idleSeconds: 10 }, { desk: false })).toEqual([]);
  });

  test("应用：连着两圈是它才报；来回切不报；没在动不报", () => {
    const s: FeedState = { desk: "active" };
    expect(step(s, { locked: false, idleSeconds: 3, app: "VS Code" })).toEqual([]);
    expect(step(s, { locked: false, idleSeconds: 3, app: "VS Code" })).toEqual([{ sensor: "joy.mac", subject: "app", value: "VS Code", text: "Joy 前台在用 VS Code" }]);
    expect(step(s, { locked: false, idleSeconds: 3, app: "微信" })).toEqual([]);
    expect(step(s, { locked: false, idleSeconds: 3, app: "VS Code" })).toEqual([]);
    expect(step(s, { locked: false, idleSeconds: 3, app: "VS Code" })).toEqual([]); // 已报过
    const t: FeedState = { desk: "idle" };
    step(t, { locked: false, idleSeconds: 700, app: "Chrome" });
    expect(step(t, { locked: false, idleSeconds: 700, app: "Chrome" })).toEqual([]);
  });
});

describe("天气", () => {
  test("第一次报；气温变不报；新种类隔一个周期还是它才报", () => {
    const s: WeatherState = {};
    const H = 30 * 60_000;
    expect(weatherStep(s, { code: 61, temperatureC: 14.4 }, "上海", 0, H)).toMatchObject({ sensor: "weather", subject: "上海", value: "rain", text: "上海：小雨，14°C" });
    expect(weatherStep(s, { code: 53, temperatureC: 12 }, "上海", H, H)).toBeUndefined(); // 毛毛雨和雨一类
    expect(weatherStep(s, { code: 2, temperatureC: 12 }, "上海", 2 * H, H)).toBeUndefined();
    expect(weatherStep(s, { code: 61, temperatureC: 12 }, "上海", 3 * H, H)).toBeUndefined(); // 又回来了：没变
    expect(weatherStep(s, { code: 2, temperatureC: 12 }, "上海", 4 * H, H)).toBeUndefined();
    expect(weatherStep(s, { code: 3, temperatureC: 11 }, "上海", 5 * H, H)?.text).toBe("上海：阴，11°C");
  });
});

describe("Joy 开放哪些", () => {
  test("没有文件 = 全关；坐标不全不报天气", () => {
    const dir = mkdtempSync(join(tmpdir(), "mac-"));
    expect(readConfig(join(dir, "nope.json"))).toEqual({ desk: false, app: false, screen: false });
    writeFileSync(join(dir, "a.json"), JSON.stringify({ desk: true, app: "yes", weather: { latitude: 31 } }));
    expect(readConfig(join(dir, "a.json"))).toEqual({ desk: true, app: false, screen: false });
    writeFileSync(join(dir, "b.json"), JSON.stringify({ weather: { latitude: 31.2, longitude: 121.5 } }));
    expect(readConfig(join(dir, "b.json")).weather).toEqual({ latitude: 31.2, longitude: 121.5, place: "外面" });
  });
});

describe("看屏幕", () => {
  async function connect(screen: boolean, ledger: string) {
    const server = createServer({ config: () => ({ screen }), ledger, capture: async () => ({ data: "aGk=", mimeType: "image/jpeg" }) });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(b);
    return client;
  }

  test("没开放：不截、不记账", async () => {
    const ledger = join(mkdtempSync(join(tmpdir(), "mac-")), "l.jsonl");
    const r = (await (await connect(false, ledger)).callTool({ name: "look_at_screen", arguments: {} })) as { content: { type: string; text?: string }[] };
    expect(r.content).toEqual([{ type: "text", text: expect.stringContaining("没有开放") }]);
    expect(() => readFileSync(ledger)).toThrow();
  });

  test("开放了：图进结果，记一行账", async () => {
    const ledger = join(mkdtempSync(join(tmpdir(), "mac-")), "l.jsonl");
    const r = (await (await connect(true, ledger)).callTool({ name: "look_at_screen", arguments: { reason: "她说界面不对" } })) as { content: { type: string }[] };
    expect(r.content.map((c) => c.type)).toEqual(["text", "image"]);
    expect(JSON.parse(readFileSync(ledger, "utf8"))).toMatchObject({ reason: "她说界面不对" });
  });
});
