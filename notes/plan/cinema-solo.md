# 单人观影（10-24 草案；10-25 按 Argon 的意见改、Joy 定了 §五、已实现）

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
| 挂载、放行、进度露给 Joy | Soma | 见 §四 |

送达类属于 **A 纯工具 + D 媒体**（取画面），不用 feed，也不用 wake。

## 三、接口（`mcp/cinema`）

影院现在同一时间只有一个放映房间，按房间的播放位置（`room.lastPositionMs`）做防剧透。单人观影不开房间，改成**放映单**：每个观众、每部片一份，游标 `at` 是看到第几场。

```
GET  /api/shelf?viewer=                                            → 片库里每部片：AI 包状态（complete / visual_only / missing…）+ 他的进度（未看 / 12/41 场 / 看完）
POST /api/screenings                 { mediaId, viewer }           → { screeningId, title, scenes: 总场数, at, missing: [...] }；已有就接着原来那份
POST /api/screenings/:id/next        { scene? }                    → 不传：下一场，游标 +1；传 scene ≤ at：重看那场，游标不动
GET  /api/screenings/:id/story                                     → 已看部分的前情（previously + 看过场景的概要 + cast）
GET  /api/screenings/:id/frame?ref=&mediaTimeMs=|at=               → 画面（只限已经放出的时间）
```

`next` 返回：

```jsonc
{
  "scene": { "no": 12, "of": 41, "from": "30:34", "to": "36:50", "characters": ["Leonard", "Teddy"] },
  "dialogue": [{ "at": "30:40", "speaker": "Teddy", "text": "…" }],   // 时间写成 MM:SS（过一小时 H:MM:SS），纠正直接拿它定位
  "events":   [{ "at": "30:51", "text": "…" }],
  "frames":   [{ "at": "30:52", "ref": "…" }],                       // ≤ 3
  "ended": false                                                      // 片尾那场为 true，并带一句事实「全片放完了」
}
```

- 有叙事轨就按它的场景切；一场超过约 8 分钟再切成几段。没有叙事轨就固定 3 分钟一段，并告诉他这是按时长切的。
- **防剧透基准**：放映单的上限是已看到的最后一场的结尾（`scenes[at-1].toMs`）。重看、取画面、纠正都不能越过它，不能往后跳。
- **不设一次看多少的上限**（Joy 10-25 定）：一部片的文字不长，额度不紧，节奏归他自己。
- 纠正（`label_line` / `rename_character`）和一起看共用一份，按片子或剧集存，不按房间存。

**MCP 工具**：
- `cinema_my_films`：兼任片架。片库里所有片子 + AI 包状态 + 他的进度，所以不用对他露 `cinema_list_media`。
- `cinema_watch_start(film)`：开或接着一份放映单。AI 包不完整要说清缺什么，比如没有台词轨就只有画面。
- `cinema_watch_next(scene?)`：往前看一场，或重看看过的一场（不另开工具）。
- `cinema_watch_story`：前情。
- 共用的 `cinema_get_frame`、`cinema_label_line`、`cinema_rename_character`：`roomId` 改成可选，加可选 `screeningId`；都不传时，按 `PSYCHE_AGENT` 找他当前在看的那份放映单（只有一份时）。`cueAt(…, at, words)` 照旧用，时间对应 `next` 给的 `at`。

## 四、Soma 挂载

现在 `cinema` 整个服务是 `scope: "activity"`，只在影音室包间里能用；工具列表在会话开始时定下、常驻不变（防破缓存），调用时由 `gateFor` 拦。

1. **manifest 按工具分 scope**（先改契约 `mcp-manifest.md`）：
   ```jsonc
   "scope": "activity", "activity": "cinema",
   "tools": { "cinema_watch_*": "house", "cinema_my_films": "house",
              "cinema_get_frame": "house", "cinema_label_line": "house", "cinema_rename_character": "house" }
   ```
   共用三个也得是 `house`，不然在自己屋看时会落回 `activity` 被拦。
2. **`SERVICE_ENV.cinema.OPEN_WATCH_CINEMA_TOOLS`** 加上 `cinema_my_films` 和三个 `cinema_watch_*`。这是每个会话都挂的同一份列表，所以包间里也看得到 `watch_*`——不靠藏，靠拦：
3. **`gateFor` 反向一条**：人在 `cinema` 包间里时调 `cinema_watch_*`，拒掉，返回事实「你在影音室包间里，这场是和大家一起看的」。进出包间不改 `tools/list`，不破缓存。
4. **进度露给 Joy**：Soma 页面上每个住户旁边露出「在看《Memento》12/41 场」/「看完《…》」，数据取 `/api/shelf?viewer=`。

（拆成第二个服务 `mcp/cinema-solo` 的办法不要了：同一个影院、同一份纠正，多一个进程没有好处。）

## 五、Joy 要定的事（附建议）

1. **看完要不要有点什么**：✅ 片尾那场 `ended: true` 时附一句事实「全片放完了」，到此为止。Argon 提议再提醒「可以记在 threads / write_diary」，我倾向不加：工具描述里已经有那些工具，片尾再点一句就是在引着他写，写不写该是他自己想起来的。
2. **一次坐下看多少**：✅ 不设上限，他自己控制节奏。
3. **Joy 能不能看到进度**：✅ 能，按 §四.4。

## 六、验证

- `mcp/cinema`：放映单的游标、防剧透（读不到游标之后的场景、画面、台词纠正）、重看不动游标、按场景切分、没有叙事轨时的退路，都写进单测。
- Soma：按工具分 scope 的放行单测；包间里调 `watch_*` 被拒；自己屋里调共用三个工具不被拒。
- 实测：测试库（`soma-test`）里让一个住户看 Memento 的前几场，换会话后接着看。
