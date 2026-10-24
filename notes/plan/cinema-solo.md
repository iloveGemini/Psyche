# 单人观影（草案，10-24）

他自己找部片子看，不用等 Joy 开放映，也不占 Joy 的播放器。一起看（Soma 影音室包间）的做法不动。

## 一、怎么算「看」

不一次读完。一次读完等于拿到一份剧本加梗概：没有悬念，没有一边看一边想的过程，也不会在看的中途停下来。

**按场景往前推**：调用一次，往前播一场戏。返回这场的原始材料：
- 台词：带说话人，经过叙事轨纠正；
- 画面事件：没有台词的动作、要紧的物件；
- 几张可以取来看的画面引用。

**不给这场的概要**。概要是看完以后的东西，只在接着看的时候作为「前情」出现。

节奏归他自己：每场之后可以想、可以记一笔，也可以停下去做别的事，下次接着看。看到哪一场存在影院，换会话、换模型都接得上。

## 二、放在哪（按 `lib-vs-harness.md`「加功能放哪」）

| 部分 | 归属 | 理由 |
|---|---|---|
| 私人放映、游标、按场景切分、防剧透 | `mcp/cinema`（影院 + 适配层） | 是影院读 AI 包的能力，别的客户端也用得上 |
| 他看过 | 不用另做 | 工具结果就在他的会话里，会话按现有链路进情节（continuity） |
| 什么时候想看、看完写不写什么 | 他自己 | 不叫醒，不强制写观后；系统不替他写任何一个字 |
| 挂载和放行 | Soma | 见 §四 |

送达类属于 **A 纯工具 + D 媒体**（取画面），不用 feed，也不用 wake。

## 三、接口（`mcp/cinema`）

影院现在同一时间只有一个放映房间，按房间的播放位置做防剧透。单人观影不开房间，改成**放映单**：每个观众、每部片一份，游标是看到第几场。

```
POST /api/screenings                 { mediaId, viewer }           → { screeningId, title, scenes: 总场数, at: 第几场 }
POST /api/screenings/:id/next        {}                            → 下一场（见下），游标 +1
GET  /api/screenings/:id/story                                     → 已看部分的前情（previously + 看过场景的概要 + cast）
GET  /api/screenings/:id/frame?ref=&mediaTimeMs=                   → 画面（只限已经放出的引用）
GET  /api/screenings?viewer=                                       → 他在看 / 看过的片子和进度
```

`next` 返回：

```jsonc
{
  "scene": { "no": 12, "of": 41, "fromMs": 1834000, "toMs": 2210000, "characters": ["Leonard", "Teddy"] },
  "dialogue": [{ "atMs": 1840200, "speaker": "Teddy", "text": "…" }],   // 不带 cueId，纠正按时间定位
  "events":   [{ "atMs": 1851000, "text": "…" }],
  "frames":   [{ "atMs": 1852000, "ref": "…" }],                       // ≤ 3
  "ended": false                                                        // 片尾那场为 true
}
```

- 有叙事轨就按它的场景切；一场超过约 8 分钟再切成几段。没有叙事轨就固定 3 分钟一段，并告诉他这是按时长切的。
- 已经看过的场景可以重看（`next` 的反面：`GET /scenes/:no`，`no` ≤ 游标），不能往后跳。
- 纠正（`label_line` / `rename_character`）和一起看共用一份，按片子或剧集存，不按房间存。

MCP 工具：`cinema_watch_start(film)`、`cinema_watch_next`、`cinema_watch_story`、`cinema_get_frame`、两个纠正工具，以及 `cinema_my_films`（在看、看过的片子）。开始时如果片子的 AI 包不完整，要说清缺什么，比如没有台词轨就只有画面。

## 四、Soma 挂载

现在 `cinema` 整个服务是 `scope: "activity"`，只在影音室包间里能用。单人观影要在哪里都能用，有两个办法：
1. manifest 支持按工具分 scope，比如 `"tools": { "cinema_watch_*": "house" }`；
2. 拆出第二个服务 `mcp/cinema-solo`，`scope: "house"`，同一个影院后端。

**建议用 1**：同一个影院、同一份纠正，拆成两个服务只多一个进程和一份 manifest。按工具分 scope 要先改契约 `mcp-manifest.md`。

包间里的白名单（`OPEN_WATCH_CINEMA_TOOLS`）照旧，包间里不露 `watch_*`。

## 五、Joy 要定的事

1. 看完要不要有点什么。默认什么都不做，靠情节自然留下。另一个选择是片尾那场返回时附一句事实（「片子放完了」）。系统都不替他写观后。
2. 一次坐下来看多少不设上限，还是设一个上限（比如一次最多 10 场），免得一口气把额度看完。
3. 他看过的片子，Joy 能不能看到进度（`cinema_my_films` 的结果在 Soma 页面上露出）。

## 六、验证

- `mcp/cinema`：放映单的游标、防剧透（读不到游标之后的场景和画面）、按场景切分、没有叙事轨时的退路，都写进单测。
- Soma：工具放行按 scope 区分的单测。
- 实测：测试库（`soma-test`）里让一个住户看 Memento 的前几场，换会话后接着看。
