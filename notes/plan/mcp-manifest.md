# MCP 服务的 manifest（契约 v0）

> 2026-10-23 起草。为什么这么分：`notes/design/lib-vs-harness.md`「加功能放哪」第 4 步。
> 状态：**只有契约**。目前 `mcp/` 下还没有服务，Soma 和 Roxy 也还不会读 manifest，第一个服务搬进来时一起做。

## 〇、放哪

```
Psyche/
  src/            Psyche 本体：不 import mcp/ 下的任何东西（tests/boundary.test.ts 卡着）
  src/mcp.ts      Psyche 自己的记忆工具门面（psyche 服务），不是这里说的 MCP 服务
  mcp/
    <名字>/
      manifest.json
      package.json  依赖只装在这一层，不进根 workspace（同栈的也可以进，manifest 里写明）
      README.md     给人看：干什么、怎么装、怎么试
      ...
```

- 每个服务是独立进程，由**地方**（Soma / Roxy）启动和挂载，Psyche 不启动、不调用它们。
- 服务和 Psyche 只经三个口子说话：`POST /v1/house/percept`（m8.md §6.3）、来信、事件上报。

## 一、manifest.json

```jsonc
{
  "name": "cinema",                      // 小写 id，也是 MCP 服务名（工具前缀 mcp__cinema__）
  "description": "影音室：一起看电影",       // 一句话，给人看
  "delivery": ["feed", "wake", "media"], // 送达类，见 §二；纯工具写 []
  "runtime": "external",                 // stack | deps | external，见 §三
  "start": { "command": "node", "args": ["server.mjs"] },  // stdio，cwd = 这个目录
  // 或者 "start": { "url": "http://127.0.0.1:4182/mcp" }  // 外部 app 自己开的 HTTP MCP
  "health": { "url": "http://127.0.0.1:4182/api/health", "timeoutMs": 1500 },
  // 或者 { "command": "python3", "args": ["observer/worker.py", "health"] }
  "scope": "room",                       // house | resident | room，见 §四
  "rooms": ["影音室"],                    // scope = room 时
  "percepts": [{ "sensor": "cinema", "form": "block", "maxChars": 4000 }],
  "media": { "kinds": ["image", "audio"], "fallback": "文字转写（字幕 + 画面描述）" },
  "secrets": ["~/.psyche/secrets/cinema.json"]  // 密钥从文件读，不进环境变量
}
```

只有 `name`、`description`、`delivery`、`runtime`、`start`、`scope` 必填，其余按需。

## 二、送达类（`delivery`）

不写或写 `[]` = **A 纯工具**：他调用，拿回结果，不注入任何东西。

| 值 | 类 | 服务要做的 | 由谁注入 |
|---|---|---|---|
| `feed` | **B 工具 + 递** | 有变化时 `POST /v1/house/percept`，`sensor` 必须在 `percepts` 里声明过 | Psyche 汇总进 `<now>`，递一次记 `percept.noticed`，原文进经历 |
| `wake` | **C 工具 + 叫醒** | 给住户写来信，或者上报事件 | Psyche 决定叫不叫醒（作息、勿扰照常管），不由服务直接推线 |
| `media` | **D 工具 + 媒体** | 工具结果里带图片 / 音频块 | 身体本身的能力；没有这项能力的身体照 `media.fallback` 退回 |

`percepts[].form`：
- `line`：一行读数（天气、在放哪首歌），走现在的 §6.3 递法：只记变化、同一样压成一行、`text` ≤ 200 字。
- `block`：一段往前走的内容（字幕、剧情），这一路自己占一段，原样递出，上限 `maxChars`。**还没做**，第一个 `block` 的服务接进来时在 `src/perception/outside.ts` 补。

## 三、运行类（`runtime`）

| 值 | 类 | 挂之前 |
|---|---|---|
| `stack` | **1 同栈**：bun / node 就能跑 | 不检查，直接挂 |
| `deps` | **2 自带依赖**：ffmpeg、python、opencv… | 跑 `health`，过了才挂；README 写怎么装 |
| `external` | **3 外部 app 的适配器**：真正干活的是另一个程序 | 跑 `health`（通常是探一下那个程序的端口），连得上才挂 |

## 四、挂载范围（`scope`）

| 值 | 含义 |
|---|---|
| `house` | 全屋每个住户默认都挂 |
| `resident` | 默认不挂，住户的配置里点名的才挂（Soma `identity.json`、Roxy `mcp.json`） |
| `room` | 住户在 `rooms` 里的房间时才挂 |

- **挂哪些在每段会话开始时定**，不在会话中途开关：工具列表一变，缓存要整个重写。进出房间、外部 app 开关，都等下一段生效。
- 健康检查没过就不挂，不报错给他；地方的系统日志里记一笔。

## 五、启动时地方传什么

| 环境变量 | 是什么 |
|---|---|
| `PSYCHE_URL` | Psyche 的地址 |
| `PSYCHE_AGENT` | 这个进程替哪个住户干活（住户 id）；percept 的 `to`、来信的收件人都用它 |
| `PSYCHE_TOKEN_FILE` | 这个住户 token 所在的文件路径（token 本身不进环境变量） |

每个住户各起一个进程（stdio 服务本来就是一个客户端一个进程）；外部 app 的 HTTP 服务是共用的，靠请求里带的住户 id 区分。

## 六、还没做

1. `mcp/` 下的第一个服务（候选：影音室，从 `~/workspace/MCP for Roxy/open-watch-cinema` 搬适配层）。
2. percept 的 `block` 递法。
3. Soma 读 manifest 挂服务（claude-sdk 身体现在只固定挂 `psyche` / `soma`）；Roxy 读 manifest 生成 `mcp.json`（房间级的现在靠 `<房间>/.mcp.json`）。
4. 删掉 Psyche、Soma、Roxy 里各自的音乐代码，换成 `mcp/music`（每人一台还是全屋共用，Joy 还没定）。
