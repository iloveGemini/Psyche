# Psyche

一个**既独立存在、又能与任何 harness 共生**的 Agent 本体。

- **Psyche**（希腊语"灵魂"，象征是蝴蝶）：项目名。是住所的名字，不是住户的名字——Agent 的名字由它自己取。
- **Barnacle（藤壶）**：架构属性。自己长本体，附着在任意宿主（Claude Code、Roxy……）上，换宿主不伤本体。
- **Lethe（忘川）**：褪色机制（后置）。意象来自柏拉图厄尔神话：灵魂自选下一世，喝下忘川再出发。

> 前身：Agent Self-Continuity Memory（ASCM，只管记忆）→ Memory Library（10-12，图书馆/档案馆构想）→ Psyche（10-13，本体）。
> 当前阶段：设计大体细化完（身体已搁置：先做能力，不设计反应）；**10-13 晚开始写地基**——`src/store/`：事件库（档号、幂等、不可变、处境、关系、资料库、系统日志）+ 投影框架。`bun test` 跑测试。

---

## 刚进项目，按这个顺序读

1. [总纲：lib 是本体，harness 是地方](notes/design/lib-vs-harness.md) —— 先搞清 Psyche 管什么、不管什么
2. [架构：十块](notes/design/architecture.md) —— 模块图与切分依据
3. [事件模型](notes/design/events.md) —— 唯一的真相，也是模块间的接口（最重要）
4. [档案馆](notes/design/archive.md) —— 库房 + 经历案卷 + 前世今生
5. [编目（梦）](notes/design/catalog.md) —— 唯一调 LLM 产记忆的地方；召回 = 还原处境
6. [阅览室](notes/design/reading-room.md) —— 认知 = 条件 → 结果；敏感化/钝化、镜子、经验
7. [联想](notes/design/association.md) —— 激活度 + 处境调制；不写时机，先定考卷
8. [自我](notes/design/self.md) —— Agent 唯一能直接写的地方：自述、作息计划、focus、自主区
9. [组装器](notes/design/assembler.md) —— 它此刻看得见什么：常驻 vs 按需、真实处境、出境检查

想知道这些决定从哪来，再看 [背景与调研](#背景与调研10-12)。

---

## 核心原则（一页速查）

**分工**
- lib 管"我是谁、我在哪、我知道什么"；harness 管"怎么干活"。lib 自己不跑对话循环，只自带一个极简的"家"（只有 lib 自己的工具，**永不加通用工具**）。→ [lib-vs-harness](notes/design/lib-vs-harness.md)
- 切分依据是**谁拥有、谁能改**：记忆层是系统机制；自我层是 Agent 唯一能直接写的地方。→ [architecture](notes/design/architecture.md)
- **记忆库的操作，除了权限和初始化，不设计人类参与。** 错了也是经历；错了没后果，说明不重要。

**数据**
- **事件溯源**：只追加的事件日志是唯一真相；其余一切是投影，可删可重建。→ [events §一](notes/design/events.md)
- **三层**：事件（库房，Agent 碰不到）→ 经历（Agent 的记忆，投影）→ 资料（提示词、文档、代码、文件，经角标展开，不褪）。→ [events §七](notes/design/events.md)
- **投影确定性，重放绝不调 LLM**；与时间相关的读时算。
- 四类事件：**经历 / 自我 / 梦 / 处境**；机制变更进**系统日志**（可查、不推送）。
- 事件不可变 → 内容的任何变化都以新事件出现，Agent 天然看得到："不能把手伸进别人脑子里"。

**自我**
- "提示词 + 模型 → 我的表现"是最基本的自我认知：提示词全文对 Agent 可见；它自己那段可以改，改要挂证据、每版留存。
- **初我**：系统给一版符合 Psyche 理念的 v0；user 初始化时可改（作者标 user），之后不能再改。写天性，不写人设。→ [events §四](notes/design/events.md)

**记忆**
- 叙述**按重要性分配细节**，不按原文长度：判据是"意外"和"后果"。→ [catalog §二](notes/design/catalog.md)
- 编目一道工序只产一样东西，每样必须有消费方、有考卷。
- **召回 = 还原此刻的处境，不是回答问题**：系统拉（组装器 + 联想）+ 它自己找（跨全部投影 + 馆藏地图）。→ [catalog §五](notes/design/catalog.md)
- 不由自主的记忆（联想）是系统机制，这次放开做；Agent 控制不了浮现，只能控制反应。

---

## 模块地图与进度

| # | 模块 | 状态 | 文档 |
|---|---|---|---|
| — | 事件模型（公共接口） | ✅ 已细化（差各 kind 的 payload） | [events](notes/design/events.md) |
| 2 | 档案馆 | ✅ 已细化（差入库接口形状） | [archive](notes/design/archive.md) |
| 3 | 编目（梦） | ✅ 已细化 | [catalog](notes/design/catalog.md) |
| 4 | 阅览室 | ✅ 已细化（差衰减曲线、payload） | [reading-room](notes/design/reading-room.md) |
| 10 | 联想 | ✅ 已细化（差公式权重、考卷） | [association](notes/design/association.md) |
| ⏸ | 身体 | 搁置：先做能力，不设计反应（见文件头） | [body](notes/design/body.md) |
| 5 | 自我 | ✅ 已细化 | [self](notes/design/self.md) |
| 6 | 组装器 | ✅ 初稿（差额度比例） | [assembler](notes/design/assembler.md) |
| 7 / 8 | 心跳与家 / 通道 | 草稿 | [lib-vs-harness](notes/design/lib-vs-harness.md)、[perception-and-fading §八](notes/design/perception-and-fading.md) |
| 9 | 门户 | 草稿 | 同上（能力表、位置状态表） |
| 1 | 感知 | 草稿 | [perception-and-fading](notes/design/perception-and-fading.md)（含隐私两道门） |
| ⟂ | Lethe 褪色 | ⏸ 后置 | [events §九](notes/design/events.md) |

细化顺序（按依赖）：事件模型 → 档案馆 → 编目 → 阅览室 → 联想 → 自我 → 组装器 → **通道 / 心跳** → 门户 → 感知。

## 已定的取舍

- **先本地部署**；本体与本机感知代理分离留到以后（云端心跳、远程通道入口）。
- **从空库开始**，新 Agent 自己取名。Roy 的旧库以资料形式放着，由 Agent 读后自己决定认不认领（前世今生）。
- 技术栈沿用 ASCM：Bun + Hono + SQLite + LanceDB；从 ASCM 搬哪些零件，实现到那块时再议。

---

## 背景与调研（10-12）

立项前的讨论与调研，是上面设计的来源。**设计以 `notes/design/` 为准**，这里有冲突时不必跟。

| 文件 | 是什么 |
|---|---|
| [archive-principles](notes/background/archive-principles.md) | 档案馆十条规矩 → 记忆怎么整理（来源原则、档号、备考表、参见…） |
| [distillation](notes/background/distillation.md) | 蒸馏：记录 → 规则与统计，为什么不交给实时聊天层 |
| [subconscious](notes/background/subconscious.md) | 潜意识中心：该有却没有的、没说出口的 |
| [ascm-inventory](notes/background/ascm-inventory.md) | ASCM 家底：哪些机制有证据、乱在哪（编目的教训出处） |
| [honcho-dreamer](notes/background/honcho-dreamer.md) | Honcho Dreamer 拆解与实测 |
| [honcho-vs-ascm-facts](notes/background/honcho-vs-ascm-facts.md) | 同一周数据的事实抽取对照 |
| [architecture-suggestions](notes/background/architecture-suggestions.md) | 基于上面六份的工程化建议（早于本体转向） |
| [xinchao-nian](notes/background/xinchao-nian.md) | 心潮·念（驱力/情绪引擎）可借鉴与不学的（10-13） |
