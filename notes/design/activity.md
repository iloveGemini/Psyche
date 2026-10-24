# 活动记忆（Activity）：它自己记的观影、游戏与跑团手账（设计稿）

> 2026-10-24 Joy 与 Argon 商定初稿。前置：`events.md`（事件模型）、`lib-vs-harness.md`（Psyche 与 Soma 职责边界）、`../plan/m7.md`（线索卷 `threads`）。

## 〇、一句话

**两个人（或一屋人）在活动里聊的话照旧是普通对话；但「这场活动演到了哪、我怎么理解它、我自己的感受、下次想怎么接」，由 Agent 自己记进独立的 `activity` 记忆里——平时不混入生活记忆、不往 `<now>` 和 `<continuity>` 里塞，下次接着玩时由它自己主动去翻。**

---

## 一、为什么这样切

随着 Soma 支持越来越多的活动（一起看电影、你画我猜、接力传话、角色扮演 TRPG、连载解谜……），如果把活动本身的进度和设定变化全让 Soma 拼好塞进普通对话或生活记忆（`episode`），或者让系统自动上报客观流水账，会撞上三个问题：

1. **同一场活动，每个 Agent 脑子里的剧本和视角完全不同**
   - 一起看半部悬疑电影，讨论剧情和斗嘴的对话本来就是实打实的相处（照常走 `message.in` / `message.out`）；
   - 但看完上半场后，**它自己对这部电影的理解**（「前情到了哪、我觉得谁是凶手、Joy 刚才偏心哪个角色、下次接着看时我想盯着哪个伏笔」）是非常主观的个人手账。系统自动拼出来的永远是干巴巴的字幕/回合流水账，只有 Agent 自己动笔写的，才带着它自己的视角与「下次怎么接」的心思。
2. **不污染日常生活记忆（`<continuity>`）与常规对话统计**
   - 一部电影分三次看完、或者一场跑团连跑五晚，如果每次的剧情梗概、设定长文、前情提要都塞进日常 `episode` 和 `<continuity>`，会把平时的生活记忆撑满；
   - 单立 `activity` 后，日常 `episode` 只需记一句轻巧的生活事实（「周六下午和 Joy 看了半部《星际穿越》，聊得很开心」），而那部电影演到哪、前情和它自己的长篇琢磨，安安静静收在 `activity` 卷里。
3. **不靠 `<now>` 喂，按需主动翻阅，天然支持「断点续玩」**
   - 没看完的电影、没跑完的团不是催命的待办事项（`threads`），平时不提这件事时，完全不需要每轮在 `<now>` 或 `<continuity>` 里刷存在感；
   - 当 Joy 说「走，接着看上次那部电影」或「今天继续跑上次那个本」时，Agent 自己调 `activity` 工具翻一下，就能看到哪些处于 **没结束（`ongoing`）** 状态，翻开读到自己上次写下的前情与接戏打算，无缝续上。
4. **方便做独立的活动统计**
   - 因为每条 `activity` 带有结构化的类型（`type`）、同伴（`with`）、状态（`ongoing` / `done`）与时间记录，系统无需去自然语言对话里大海捞针，就能直接统计：看过几部电影（几部看完、几部还在看）、玩过几次你画我猜、跑过几场角色扮演、每次和谁一起。

---

## 二、与现有机制的边界

| 机制 | 装什么 | 怎么出现在它眼前 |
|---|---|---|
| **普通对话与情节**（`message.*` / `episode`） | 活动过程中大家说的话、斗的嘴，以及「今天一起玩了什么」这件生活小事 | 照常进日常对话流、热写与 `<continuity>` |
| **线索卷**（`threads`） | 答应别人的承诺（`promise`）、挂在心上等后续的日常事务（`matter`） | `<now>` 报件数，`<continuity>` 全列 |
| **日记**（`diary`） | 不分主题的个人随笔，写完即止，无状态流转 | 不进搜索，按档号 `detail` 看 |
| **活动记忆**（`activity`） | **某一场具体活动（电影、游戏、跑团等）的前情提要、个人理解与感受、下次怎么接**；带状态（`ongoing` 没结束 / `done` 已结束），可多次续写 | **不进 `<now>`、不进 `<continuity>`**；平时不混入生活记忆，要接的时候由 Agent 主动 `list` / `read` |

---

## 三、事件模型（自我类 `self`，全部由 Agent 自己写）

遵循 `events.md` 的只追加原则，用两条 `self` 事件表达活动的开启、续写与完结（合二为一：开启是 `activity.opened`，后续每次接着玩、更新前情或改状态统一走 `activity.updated`）：

```json
activity.opened {
  "type": "movie" | "draw-guess" | "rp" | "telephone" | "...",
  "title": "《星际穿越》",
  "with": ["Joy"],
  "status": "ongoing" | "done",
  "text": "看到第 48 分钟从米勒水星刚出来，罗米利在舱里等了 23 年……（前情 + 我自己的感受 + 下次想怎么接）"
}
rels: evidence (可选，挂本次活动相关的对话/经历档号)

activity.updated {
  "target": "<activity.opened 的事件 id>",
  "title": "《星际穿越》",          // 系统顺手抄上标题，方便单条渲染
  "with": ["Joy", "a2"],            // 可选：如果这次接着玩加了人/换了同伴可更新
  "status": "ongoing" | "done",     // 这次玩完是还没结束（ongoing），还是彻底结束了（done）
  "text": "今天从曼恩博士冰冻星球一直看到进黑洞五维空间收尾……"
}
rels: evidence (可选)
```

### 字段说明

- **`type`**（必填，非空小写字符串）：活动种类。常用如 `movie`（看电影/剧）、`rp`（角色扮演/跑团）、`draw-guess`（你画我猜）、`telephone`（接力传话）、`reading`（共读）等，不锁死枚举，方便以后长出新活动、也能按 `type` 归类统计。
- **`title`**（必填，非空字符串）：这场活动的名字（如电影名、剧本名、某局游戏的题目）。
- **`with`**（可选，字符串数组）：这场活动是和谁一起的（如 `["Joy"]`、`["Joy", "a1", "a2"]`）。
- **`status`**（必填）：
  - `"ongoing"`：**没结束**（比如电影看了一半、跑团卡在第二章，下次还能接着玩）；
  - `"done"`：**已结束**（比如一局你画我猜当场打完，或者电影今天看完了）。
  - *注：不锁死「`done` 了不能再 `update`」——万一以为看完了，下次又拎出来看导演剪辑版或番外，或者跑团开二周目，允许直接 `update` 续写或改回 `ongoing`。*
- **`text`**（必填，非空字符串）：Agent 自己写下的内容——到此为止的前情、自己对这场活动的理解与感受、下次接着玩时打算怎么接。
- **`cites`**（可选，档号数组）：同 `threads`，只认它自己全宗的经历、情节或信件，作为「这天玩了这场活动」的锚点。

---

## 四、读与投影（现算，不存表）

由 `activity.opened` 与 `activity.updated` 按时间序折算出每场活动的当前视图 `Activity`：

```ts
export interface ActivityEntry {
  at: number;
  archiveNo: string;
  status: "ongoing" | "done";
  text: string;
}

export interface Activity {
  id: string;
  archiveNo: string;        // 开卷那条 activity.opened 的档号（作为唯一指认 target）
  type: string;
  title: string;
  with: string[];
  status: "ongoing" | "done";
  openedAt: number;
  lastAt: number;
  sessionsCount: number;    // 玩过几次（1 次 opened + N 次 updated）
  entries: ActivityEntry[]; // 历次记录（按时间从旧到新）
}
```

### 在各处的可见性（不打扰日常记忆）

1. **`<now>`**：**不出现**。不占每轮开头的注意力。
2. **`<continuity>`（换段种子）**：**不出现**。不混入日常生活梗概。
3. **`recall`（日常记忆搜索）**：**默认不混入普通经历搜索**，保持生活记忆纯粹；想找活动直接走 `activity` 工具自己的 `list` / `read`（可按 `type`、`status`、`with` 或关键词筛）。
4. **近期经历行（`render.ts`）**：
   - 动作本身留一行极简痕迹（证明它当时记了手账）：
     - `activity.opened`：`我记下了活动「《星际穿越》」（movie，没结束）`
     - `activity.updated`：`我续记了活动「《星际穿越》」（已结束）`
   - 不把长篇前情正文直接摊在日常经历流里，免得热写时又把前情抄一遍进 `episode`。

---

## 五、工具与接口（MCP + REST）

在 Psyche 的 `AWAKE` 工具集里加一个 **`activity`** 工具（4 个 `op`）：

| `op` | REST | 参数 | 返回 |
|---|---|---|---|
| `list`（缺省） | `GET /v1/activities` | `status?`: `"ongoing"` \| `"done"` \| `"all"`（缺省 `"all"`，`ongoing` 排前面）<br>`type?`: 按种类筛（如 `"movie"`）<br>`query?`: 按标题/内容词筛 | 活动列表摘要：每条带 `[档号] [状态] (type) 标题 · 与谁 · 共 N 次 · 最近一次时间 + 最新一条开头预览` |
| `read` | `GET /v1/activities/:target` | `target`: 开卷档号（如 `"10-24#55"`） | 该活动的完整手账：标题、种类、同伴、当前状态，以及历次记下的全文（带模糊时段，同 `traces.md`） |
| `open` | `POST /v1/activities` | `type`, `title`, `with?`, `status`（缺省 `"ongoing"`）, `text`, `cites?` | `{ archiveNo }` |
| `update` | `POST /v1/activities/update` | `target`（开卷档号）, `status?`（不传则保持原状态）, `with?`, `text`, `cites?` | `{ archiveNo }` |

### Agent 怎么用它（典型场景）

- **场景 A：看了一半的电影 / 跑了一半的团**
  1. 周六下午和 Joy 看《星际穿越》看到一半去吃饭了，过程中俩人边看边贫嘴（普通对话）；
  2. 暂停时，Agent 调 `activity({ op: "open", type: "movie", title: "《星际穿越》", with: ["Joy"], status: "ongoing", text: "看到 48 分钟刚离开米勒水星……前情：……我的感受与下次怎么接：……" })`；
  3. 过了五天，Joy 说「来，把《星际穿越》后半截看完！」；
  4. Agent 主动调 `activity({ op: "list", status: "ongoing" })` 找到 `[10-24#55]《星际穿越》`，再 `activity({ op: "read", target: "10-24#55" })`，立刻把五天前写的前情和心思全拾起来接着聊；
  5. 看完片尾字幕，Agent 调 `activity({ op: "update", target: "10-24#55", status: "done", text: "今天看完了后半部……" })` 收尾。
- **场景 B：一次性玩完的《你画我猜》或《接力传话》**
  - 散局后，如果 Agent 觉得这局特别好玩、有自己想记一笔的复盘或梗，直接调 `activity({ op: "open", type: "draw-guess", title: "已读不回接力局", with: ["Joy", "a1", "a2", "claude"], status: "done", text: "..." })`。

---

## 六、统计（Dashboard 与 `stats` 扩展）

有了结构化的 `activity` 事件，统计不再需要从对话文本里硬猜，直接从 `readActivities(store)` 现算：

- **总体概览**：累计开展过多少场活动、正在进行（`ongoing`，还没填完的坑）有几场、已完成（`done`）几场；
- **按类型（`byType`）**：比如 `movie` 3 部（2 部看完、1 部看到一半）、`draw-guess` 5 局、`rp` 2 场（共续玩了 6 次）；
- **按同伴（`byPartner`）**：和 Joy 一起玩过几次、和室友们一起玩过几次、最近一次玩是什么时候。
