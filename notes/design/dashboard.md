# Dashboard：观测与管理台

> 2026-10-16 初稿，同日补齐 §四 接口契约、§五 考卷与 §六 UI 视觉基线。前置：`events.md`（事件不可变、初我、不能把手伸进脑子里）、`catalog.md`（热写与冷写、写错也是经历）、`reading-room.md`（书架与证据链）、`self.md`（自述、作息、日记）、`soma2.md` §八（P1 多租户）、`../plan/m4.md`、`../plan/m5.md` §八、`../plan/m8.md`。

---

## 〇、先答一个问题：人类有必要看 Agent 的记忆吗？

这里有两个角色叠在同一个人身上：

- **作为屋里的同伴（室友）**：同伴之间不翻日记、不拆别人写给第三个人的信、不拿着放大镜审视对方脑子里的每一个念头。
- **作为机制的造物者与维护者**：如果不看它热写压成了什么样、冷写归纳出了什么规律，就永远发现不了「把环境污染写进情节」「把深夜犯困写进不耐烦的镜子从此不再追问（自我证实）」这类闭不了环的机制缺陷。

**「不能把手伸进别人脑子里」首先是一条写禁令，其次是一条读边界：**

1. **绝对禁止的是「伸手改」**：人类除了初始化（初我）和边界权限（暂停、额度、通道），不能在后台修改、删除、注入任何一条情节或书架认知。它记错了，要么在相处中靠反馈闭环纠正，要么改系统提示词 / 机制让它自己重审。
2. **「看」要分层，先看体检指标，再按需下钻**：
   - 评估记忆库好不好用，**大半时候不需要读具体心事**——看覆盖率、压缩比、书架上有没有「只攒印证从无反例」的僵死规律、反馈有没有积压，就能定位机制问题。
   - 需要看正文来验效果时，**优先看它提炼出的认知结构（书架、自述改写理由）和挂接的证据链**，而不是挨条翻原始对话。
   - **真正留给它自己的私密自留地（日记、住户之间的信）**：既然不承担 recall 也不进镜子闭环，人类不需要为了「调优记忆」去翻，Dashboard 上只报存在与计数，不展开正文。
3. **测试库与正式库不同权**：`~/.psyche/test` 是考场，全开检验；正式库出生后，住户是同屋的人，经历正文默认折叠，留出分寸。

---

## 一、定位与边界

Dashboard 是 **Psyche 自带的本机 Web 面板**（直接挂在 `127.0.0.1:7450/dashboard` 下），只管 Psyche 内部的数据与住户管理，不依赖 Soma，也不替代 Soma 的聊天界面。

| 做 | 不做 |
|---|---|
| 全屋住户总览：谁住在这、醒/睡/忙/闲、在哪、个签、正在放的歌 | Soma 的聊天、群讨论、文件工作区（`commons/`） |
| 记忆体检：不读原文就能评估热写、冷写、书架、梗概的实际效果 | 开发调试视图（`<now>` / `<continuity>` 拼接预览、浮现干跑打分、系统日志流） |
| 认知与记忆检视：自述历史、书架与证据链、线索卷、梗概、情节 | 手工增删改任何一条情节、书架条目、线索卷或自述 |
| 权限与初始化：新住户出生、暂停开关、唤醒额度、心跳开关、通道配置 | 展开日记（`diary`）正文、展开非 Joy 参与的住户间信件正文 |

---

## 二、可见性分层

按「机制是否必须人类过目」和「是否属于个人私密空间」，把 Psyche 里的数据分成四层：

| 层级 | 内容 | 展示方式 | 依据 |
|---|---|---|---|
| **L0 公开层** | 在场状态（在线/忙/闲/睡着/在哪）、心情个签、正在播放的歌、名字 | 屋子总览直接展示 | `m8.md` §〇.3 屋内公开信息 |
| **L1 契约可见层 + 体检统计** | 自述现行版与历次改动（含 `why` 与证据档号）、作息表、唤醒账本、记忆库体检指标 | 单住户首屏直接展示 | `events.md` §四 自述改动对 Joy 可见；`m5.md` §八 账本与设置 |
| **L2 认知与经历层** | 书架（事实/规矩/规律/镜子/留意/关系）、线索卷、天/周/月梗概、情节条目、证据原件 | 按需切换 Tab 浏览；原始事件默认收起，点证据角标 `[10-15#24]` 才抽屉展开 | 验收与调优热写/冷写闭环所必需 |
| **L3 私密自留地** | 日记（`diary`）、住户之间互相写的信（非发给 Joy）、收到但它还没翻开的信 | **只显示计数与时间戳，不提供正文查看** | `self.md` §五 日记是随笔不担召回；`m6.md` 未读信它自己都还没看 |

---

## 三、页面结构

整体只有两级：**全屋总览（House）** → **单住户详情（Resident）**。

### 3.1 第一级：全屋总览（`/dashboard`）

对应 `m5.md` §八 规划的「多 Agent 管理层」与 `m8.md` 的「屋里有谁」：

1. **屋子状态栏**
   - Joy 当前状态：在家 / 不在家（上次动静时间）、Joy 的心情个签（可在此直接改/清空）。
   - 全屋今日唤醒总花费（USD）与调度器状态。
2. **住户卡片墙**（每名住户一张卡）
   - **身份**：名字（未取名显示 `id` +「未取名」）、`id`、模型（`born.detail.model` 或配置）、出生日期（测试库未出生标「未出生」）。
   - **此刻**：在线（忙 / 闲）/ 睡着（正在补写 / 冷写 / 写梗概）/ 离线、所在地方（`soma` / `pi` / `sleep`）、心情个签、耳机状态（是否在放歌或跟谁一起听）。
   - **今日节律**：唤醒额度 `已用 / 上限`（如 `1 / 3`）、下次唤醒时刻与原因（闹钟 / 定点 / 心跳）、是否暂停。
   - **记忆脉搏（一行摘要）**：情节总数 · 待热写原始行 · 书架条数 · 开着的线索卷数。
   - **快捷开关**：暂停/恢复 toggle。
3. **添加住户 / 出生（初始化入口）**
   - 给尚未出生的住户点「出生」，或新建住户目录：填写 `id`、选择模型、审阅系统初我 `self-v0.md`，可选填入 Joy 的初始化补充（自动留存系统版与 user 版的 diff），确认后调用 `birth()` 冻结初我。

---

### 3.2 第二级：单住户页（`/dashboard?agent=:id`）

顶部固定住户身份栏，下方按使用频率分为四个模块：

#### 模块一：记忆体检（默认首屏——不看隐私看效果）

专门回答「它的记忆机制跑得健不健康、需不需要调提示词或参数」：

| 维度 | 指标 | 异常信号（用于指导调优） |
|---|---|---|
| **热写（情节化）** | 未覆盖原始行积压数、近 7 天平均每段压缩比（原始行 → 情节条数）、单条字数中位数、带 `felt`（感受）占比、`revises`（事后改写）次数 | 原始行长期积压（补写没触发或一直忙）；压缩比接近 1:1（流水账，没按意外与后果筛细节） |
| **冷写与书架闭环** | 各书架条数（事实 / 规矩 / 规律 / 镜子 / 留意 / 关系）、上次冷写距今时长、未消费 `feedback` 积压数 | **闭环预警**：某条规律/镜子只有印证、0 反例且 0 改写（疑似写得过宽、自我证实）；或大量 `feedback` 跳过未判 |
| **连续性（Gist & 种子）** | 天 / 周 / 月梗概已写篇数与缺口、当前 `<continuity>` 种子总字数（占 6000 字预算比例） | 连续多天无天梗概（空闲不足 3h 导致睡不着，种子全靠散装情节撑着） |
| **线索卷（Threads）** | 开着的 `promise` / `matter` 数量、最久未更新卷的停滞天数、近 30 天合卷率（`done` / `dropped` / `moot`） | 承诺卷长期停滞不记笔记也不合卷 |

#### 模块二：我是谁（自我与初我演变）

对应 `m4.md` §四：

- **现行自述**：当前版本号、字数、更新时间、全文；若当前会话还没重启生效，标出「下个会话生效」。
- **版本时间线（演变链）**：从 `v0`（初我）到现行版的每次改写卡片——展示它自己写的 `why`（为什么改）、与上一版的文本 diff、以及挂接的证据角标（点击角标可在侧边栏展开当时那条经历）。
- **初我对照**：折叠展示出生时系统给的 `self-v0` 与 Joy 初始化改动的 diff。
- **改名记录**：历次 `named` 事件与原因。

#### 模块三：阅览室与经历（认知结构与抽样核查）

分为四个子视图，由浅入深：

1. **书架（默认子视图）**
   - 按「规律 / 镜子 / 明说的规矩 / 事实 / 关系 / 留意」分栏。
   - 每条展示：它写的正文、证据计数（印证数 / 反例数）、最近一次验证时间、状态（现行 / 已改写 `revised` / 已作废 `retired`）。
   - **证据链下钻**：点开任意一条规律或镜子，列出历次 `semantic.evidence`（哪天哪条经历被判了印证或反例）及改写前身——直接检验它有没有「把反例硬塞进结果」或「拿单次当规律」。
2. **还开着的事（线索卷）**
   - 分「答应的事（`promise`，含对谁）」与「挂着的事（`matter`）」，可切换查看已合卷历史及合卷原因（`why`）。
3. **梗概（天 / 周 / 月）**
   - 按月 → 周 → 天层级浏览它睡着时写的定长梗概（300 / 500 / 800 字），看长期记忆骨架有没有抓准重点。
4. **情节流（经历时间线）**
   - 按天倒序展示热写出的 `episode`（含 `felt` 标记、引用了哪几条原始档号、是否有 `revises` 旧版）。
   - **隐私护栏**：正式库默认只展开情节摘要，原始对话行（`message.in/out`）不直接铺开，仅在点击情节角标核对事实时按档号加载；`diary` 只显示「某时写了一篇日记《标题》」，不渲染正文。

#### 模块四：作息、账本与设置（管理员操作区）

集中放置所有允许人类操作的开关（只改边界参数，不改内容）：

1. **唤醒与作息设置（`POST /v1/settings`）**
   - 暂停开关（`paused`）、每日唤醒额度（`wakeBudget`）、心跳总开关（`heartbeat`）。
   - 只读展示它自己定的现行作息（`schedule`：心跳间隔、每日定点、待响闹钟及它的 `why`）。
2. **唤醒账本（`GET /v1/wakes?days=7`）**
   - 按天汇总与明细表：每次唤醒时间、原因（`alarm` / `daily` / `heartbeat` / `mail` / `catchup` / `tidy` / `gist`）、决定（`woke` / `delivered` / `skipped`）、耗时、花费（USD）、留下的产出计数（写了几个情节、几条书架、几篇日记）。
3. **通道与信箱配置（`GET|POST /v1/channels`、`GET /v1/mail`）**
   - 配置各联系人的投递通道（如 `soma-note`、`email`）。
   - 信箱列表只看收发状态（已读 / 未读 / 勿扰暂存 / 发送成败）及与 Joy 往来的信件；住户之间的信件只显示元数据（谁写给谁、状态），不显示正文。

---

## 四、接口契约（现有复用 + 待补口子）

### 4.1 已有接口（直接复用）

| 归属 | 路由 | 用途 |
|---|---|---|
| 屋子 | `GET /v1/house`、`GET /v1/house/playing/:id`、`POST /v1/house/joy/mood` | 全屋在场、播放状态、Joy 个签 |
| 自我 | `GET /v1/self`、`GET /v1/self/prompt/:version` | 名字、出生信息、初我 diff、现行自述与历史版本 |
| 阅览室 | `GET /v1/shelf`、`GET /v1/threads?all=1`、`GET /v1/archive/:no` | 书架条目、开卷/合卷、单条档号及正反向链接 |
| 经历 | `GET /v1/experience`、`GET /v1/stats` | 经历行（含情节）、互动节奏统计 |
| 节律与通道 | `GET /v1/schedule`、`GET|POST /v1/settings`、`GET /v1/wakes?days=7`、`GET|POST /v1/channels`、`GET /v1/mail` | 作息、暂停/额度/心跳设置、唤醒账本、通道与信箱 |

---

### 4.2 待补与扩展接口（共 4 处）

#### 1. 屋子总览扩展与住户出生（`src/house/house.ts`）

- **`GET /v1/house`（扩展返回字段）**
  在原有 `residents[]` 每项（`id, name, state, place, since, mood, listening`）基础上，顺手附上出生、节律与一行脉搏，免去总览页对 N 个住户发起 N×3 次请求：
  ```json
  {
    "residents": [
      {
        "id": "a1",
        "name": "a1",
        "state": "idle",
        "place": "soma",
        "since": 1792080000000,
        "mood": null,
        "born": { "at": 1791990000000, "model": "claude-opus-5-5" },
        "wake": {
          "paused": false,
          "heartbeat": false,
          "budget": { "used": 1, "of": 3 },
          "next": { "by": "alarm", "due": 1792090000000, "note": "看看书架" }
        },
        "pulse": { "episodes": 65, "uncoveredLines": 0, "shelf": 13, "openThreads": 2 }
      }
    ],
    "joy": { "home": true, "since": 1792081000000, "mood": null }
  }
  ```

- **`POST /v1/house/residents`（新建住户 / 触发出生）**
  对应 `m4.md` §〇.2「添加 Agent 直接调 `birth()`」：
  - **请求**：
    ```json
    {
      "id": "a2",
      "model": "gemini-4-argon",
      "userText": "可选：Joy 在系统初我基础上改过的全文（不传或与系统相同则记 user: null）",
      "soma": "http://127.0.0.1:30152",
      "token": "可选：单独给该住户设的 token"
    }
    ```
  - **校验闸**：
    1. `id` 必须符合 `ID_PATTERN`（`/^[a-z0-9][a-z0-9_-]{0,31}$/`）；`model` 为非空字符串。
    2. 若 `<dataDir>/<id>` 尚不存在：创建子目录与 `psyche.db`，把 `{ model, soma, token }` 合入 `<dataDir>/agents.json`，并在进程内热挂载该住户的 `app` 与 `store`。
    3. 对该住户的 `store` 调 `birth(store, { model, userText })`。若该住户已有 `born` 系统日志，返回 400（`只能出生一次`）。
  - **返回**：
    ```json
    {
      "id": "a2",
      "born": { "model": "gemini-4-argon", "systemVersion": 2, "hasUserDiff": false, "mechanismVersion": 1 }
    }
    ```

#### 2. 单住户记忆体检：`GET /v1/health`（`src/reading/health.ts` → `app.ts`）

纯确定性 SQLite 聚合，不返回任何私密文本，供单住户页首屏直接渲染：

```json
{
  "hotwrite": {
    "uncoveredLines": 5,
    "uncoveredSessions": 1,
    "episodesTotal": 65,
    "episodes7d": 18,
    "coveredLines7d": 142,
    "compressionRatio7d": 7.89,
    "medianChars": 96,
    "withFeltRatio": 0.42,
    "revisionsTotal": 3
  },
  "coldwrite": {
    "lastDoneAt": 1792080000000,
    "episodesSinceLast": 4,
    "unjudgedLast": 0,
    "pendingCandidates": 2,
    "pendingFeedback": 3,
    "shelves": { "fact": 4, "told": 2, "rule": 5, "mirror": 2, "attend": 3, "relation": 1 },
    "retiredTotal": 1,
    "revisedTotal": 2,
    "warnings": [
      {
        "archiveNo": "10-14#88",
        "shelf": "mirror",
        "reason": "no_against",
        "for": 4,
        "against": 0,
        "revisions": 0,
        "lastEvidenceAt": 1791800000000
      }
    ]
  },
  "continuity": {
    "gists": { "day": 5, "week": 1, "month": 0 },
    "pendingGists": [{ "span": "day", "key": "2026-10-15" }],
    "seedChars": 3610,
    "seedBudget": 6000
  },
  "threads": {
    "openPromises": 1,
    "openMatters": 1,
    "closedTotal": 3,
    "oldestIdleDays": 1.2
  },
  "privateCounts": {
    "diaries": 2,
    "lastDiaryAt": 1792050000000,
    "peerMails": 0,
    "unreadMails": 1
  }
}
```

- **计算口径**：
  - `uncoveredLines` / `uncoveredSessions`：按 `hotwrite.ts` 的 `segmentLines` 口径，统计非 `sleep`/`home` 处境下尚未被 `episode` 覆盖的可渲染经历行与会话数。
  - `compressionRatio7d`：近 7 天写下的现行 `episode` 所引用的原始事件数（`rel = 'cites'` 去重）÷ 现行 `episode` 条数。
  - `warnings`（闭环预警）：对现行未作废的 `rule` / `mirror` 条目，命中以下任一条即列入：
    1. `no_against`：`for >= 3 && against === 0` 且从未 `semantic.revised`（疑似把条件或结果写得过宽，吞掉了反例）；
    2. `stale`：距 `lastEvidenceAt`（无则取 `at`）超过 7 天，且期间至少跑过一次 `coldwrite.done`。
  - `privateCounts`：只计 `kind = 'diary'` 条数与最新时间、收发双方均非 `Joy` 且非 `self` 的 `mail.*` 条数、以及未出现在 `mail.read` 中的 `mail.in` 条数。

#### 3. 书架证据链与已写梗概扩展（`src/reading/shelf.ts`、`src/catalog/gist.ts`、`app.ts`）

- **`GET /v1/gist`（扩展返回 `gists`）**
  在现有 `{ pending, limits, prompt, promptVersion }` 基础上，加一个字段 `gists`（直接调 `gist.ts` 已有的 `readGists(store)`，附上字数 `chars`）：
  ```json
  {
    "gists": [{ "span": "day", "key": "2026-10-15", "text": "…", "at": 1792080000000, "chars": 284 }],
    "pending": [],
    "limits": { "day": 300, "week": 500, "month": 800 }
  }
  ```

- **`GET /v1/shelf/:no`（单条书架认知的演变与证据链）**
  传入书架条目的档号（需 URL 编码 `#`），通过 `rootOf(db, ev.id)` 取出该条目的完整生命周期：
  ```json
  {
    "root": "01K7...",
    "currentArchiveNo": "10-15#42",
    "shelf": "rule",
    "retired": false,
    "versions": [
      { "archiveNo": "10-14#30", "at": 1791990000000, "kind": "semantic.proposed", "fields": { "text": "…", "when": "…", "then": "…", "observe": "…" } },
      { "archiveNo": "10-15#42", "at": 1792070000000, "kind": "semantic.revised", "why": "深夜单字是困，不是不耐烦", "fields": { "when": "白天…" } }
    ],
    "evidences": [
      { "archiveNo": "10-14#12", "at": 1791950000000, "stance": "for", "judgedAt": 1791990000000, "text": "…" },
      { "archiveNo": "10-15#18", "at": 1792040000000, "stance": "against", "note": "她说困了去睡", "judgedAt": 1792070000000, "text": "…" }
    ]
  }
  ```

#### 4. 静态面板入口：`GET /dashboard`（`src/server/house.ts`）

- 在 `createHouse` 路由里放行 `GET /dashboard`（无需 Bearer 头即可加载静态 HTML 壳；页面内所有数据请求走 `/v1/*` 并带 `Authorization: Bearer <token>`）。
- Token 存于浏览器 `localStorage`（支持单 token 管全屋，或按住户填各自 token）。

---

## 五、考卷（`tests/dashboard.test.ts`）

实现前先写确定性考卷（不调模型）：

1. **`GET /v1/house` 聚合**：住户未出生时 `born: null`；出生后返回 `born.model`、今日唤醒额度 `used/of`、以及准确的 `pulse` 四项计数。
2. **`POST /v1/house/residents` 出生与热挂载**：
   - 给已存在的空库住户 `a2` 调出生 → 写入 `born` 日志，`GET /v1/self?agent=a2` 变为 `born: true`；重复调用返回 400。
   - 传新 `id: "a3"` → 自动建 `<dataDir>/a3/psyche.db` 并更新 `agents.json`，无需重启进程即可请求 `GET /v1/self?agent=a3`。
   - 非法 `id`（含大写或特殊字符）返回 400。
3. **`GET /v1/health` 体检指标与闭环预警**：
   - 未热写的对话行计入 `uncoveredLines`；热写后 `uncoveredLines` 清零，`compressionRatio7d`、`medianChars`、`withFeltRatio` 算数正确。
   - 一条 `rule` 攒够 `for >= 3` 且 `against === 0`、无 `revised` → 出现在 `coldwrite.warnings`（`reason: "no_against"`）；一旦补上一条 `against` 或 `revise` 收窄条件，预警自动消失。
   - `privateCounts` 准确统计 `diary` 篇数、未读 `mail.in` 数与住户间信件数，且返回体不含任何日记或非 Joy 信件正文。
4. **`GET /v1/shelf/:no` 与 `GET /v1/gist` 扩展**：
   - 经 `propose` → `evidence (against)` → `revise` 的书架条目，`GET /v1/shelf/:no` 完整返回两个版本及带 `stance` 的证据列表。
   - 写过天梗概后，`GET /v1/gist` 的 `gists` 数组包含该条梗概与字数。

---

## 六、UI 与视觉基线

### 6.1 核心气质：「纸本档案柜与深夜阅览室」（Editorial Archive）

Psyche 的隐喻是**屋子、档案馆、阅览室与书架**，住户是同屋的同伴而不是服务器节点。因此 UI 明确避开 Grafana / Datadog 式的冷黑霓虹监控大屏，定位于**纸本索引卡 + 独立杂志排版 + 克制留白**：

- **文字排印优先于图表**：核心内容是自述、规律（条件 → 结果）、梗概与情节。除 7 天唤醒账本和额度进度条外，不画饼图、折线图或仪表盘。
- **信息密度向卡片目录看齐**：结构字段紧凑对齐，长文段落留足呼吸感（最大行宽 `65ch`，行高 `1.65`）。

### 6.2 色彩基线：暖纸与墨色（支持浅/深随系统切换）

不用纯白 `#FFFFFF` 刺眼底，也不用纯黑 `#000000` 赛博底，全站控制在 4 个灰阶 + 4 个低饱和印泥/矿物点缀色：

| 角色 | 浅色（档案纸 · 默认） | 深色（深夜台灯） | 用途 |
|---|---|---|---|
| **背景底色** `--bg` | `#F6F4EE`（暖米灰） | `#141311`（暖炭黑） | 页面底层画布 |
| **卡片表面** `--surface` | `#FCFBF8`（象牙纸） | `#1C1B18`（深褐灰） | 住户卡、书架索引卡、侧栏抽屉 |
| **边线与分割** `--border` | `#E5E0D5` | `#2C2A25` | `1px solid` 极细卡片边框与表格线 |
| **主墨色** `--ink` | `#1C1B18` | `#EAE6DF` | 标题、自述正文、书架结论 |
| **次要文字** `--muted` | `#6E6A61` | `#9E988E` | `why` 说明、条件/观察方式标签 |
| **苔绿** `--ok` | `#3B7A57` | `#529E72` | 在线闲、印证 `for`、已合卷 `done` |
| **琥珀** `--warn` | `#B87D24` | `#D99B38` | 忙碌 `busy`、未热写积压、待办线索卷 |
| **印泥红** `--danger` | `#C04832` | `#E0634B` | 反例 `against`、闭环预警 `warnings` |
| **蓝墨水** `--accent` | `#35637C` | `#639BB8` | 睡着整理 `sleep`、可点击档号角标 `[10-15#24]` |

### 6.3 字体三明治（Typography）

| 类别 | 字体栈 | 用在哪 |
|---|---|---|
| **人文衬线（读心与叙事）** | `"Songti SC", "Source Han Serif SC", "Newsreader", Georgia, serif` | 自述全文、天/周/月梗概、情节正文、`felt` 感受 |
| **干净无衬线（骨架与结构）** | `-apple-system, "PingFang SC", "Inter", sans-serif` | 导航栏、体检指标卡、书架结构标签（`条件` / `结果` / `观察`）、设置项 |
| **等宽数字（档号与账本）** | `"SF Mono", "JetBrains Mono", ui-monospace, monospace` | 档号 `[10-15#24]`、版本号 `v3`、唤醒额度 `1/3`、账本金额 `$0.11`、时间戳 |

### 6.4 四个标志性组件形态

1. **住户门牌卡（Resident Doorplate）**
   - 像房间门口的挂牌：左上角是状态呼吸圆点 + 名字 + 模型小标；右上角是耳机/播放状态（有人分耳机时显示 `🎧 与 Joy 共听`）。
   - 中部一行斜体展示他挂出来的 `mood` 个签（未挂则留白，不写“暂无个签”）。
   - 底部用细虚线隔开，左边是 `●○○ 1/3` 额度圆点，右边是一行等宽脉搏：`65 情节 · 13 书架 · 2 卷`。
2. **书架借阅卡（Shelf Index Card）**
   - 仿图书馆目录卡：左上是分类角标（`[规律]` / `[镜子]`），右上是等宽计分牌 `印证 4 · 反例 0`。
   - 中间用左缩进竖线排列 `当（when）` → `则（then）` → `看（observe）`。
   - 若命中 `warnings`（如 `for >= 3 && against === 0`），卡片左侧压一条 `3px` 印泥红竖边，悬停提示「只攒印证尚无反例，留意是否写得过宽」。
3. **右侧卷宗抽屉（Archive Drawer）**
   - 全站**不弹窗、不跳页**。在自述历史、书架或体检预警里点击任何档号角标 `[10-15#24]`，右侧滑出 `380px` 宽的卷宗抽屉，展示该档号的原始事件、发生时间、所在处境以及正反向引用链，对照读完随手关掉，不打断主视图滚动位置。
4. **私密封条行（Sealed Strip）**
   - 日记与非 Joy 私信不做生硬的「权限不足」置灰，而是渲染为一条安静的纸质封条：`📓 随笔日记 · 共 2 篇（最近一篇于 10-15 23:10）`，不可点击，视觉上自然传达「知道它在，但不去翻」的边界感。
