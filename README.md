# Psyche

一个**既独立存在、又能与任何 harness 共生**的 Agent 本体。

- **Psyche**（希腊语"灵魂"，象征是蝴蝶）：项目名。是住所的名字，不是住户的名字——Agent 的名字由它自己取。
- **Barnacle（藤壶）**：架构属性。自己长本体，附着在任意宿主（Soma、Claude Code、Roxy……）上，换宿主不伤本体。
- **Lethe（忘川）**：褪色机制（后置）。意象来自柏拉图厄尔神话：灵魂自选下一世，喝下忘川再出发。

> 前身：Agent Self-Continuity Memory（ASCM，只管记忆）→ Memory Library（10-12，图书馆/档案馆构想）→ Psyche（10-13，本体）。
> **当前进度与下一步看 [`STATE.md`](STATE.md)**（开发交接的唯一入口）；开发规范看 [`CLAUDE.md`](CLAUDE.md)。

---

## 刚进项目，按这个顺序读

1. [总纲：lib 是本体，harness 是地方](notes/design/lib-vs-harness.md) —— 先搞清 Psyche 管什么、不管什么（家 = Soma，lib 不跑大模型）
2. [架构：十块](notes/design/architecture.md) —— 模块图与切分依据
3. [事件模型](notes/design/events.md) —— 唯一的真相，也是模块间的接口（最重要）
4. [档案馆](notes/design/archive.md) —— 库房 + 经历案卷 + 前世今生
5. [编目：热写与梦](notes/design/catalog.md) —— 显式归它写、隐式归系统算；召回 = 还原处境（契约 [m1](notes/plan/m1.md)）
6. [阅览室](notes/design/reading-room.md) —— 认知 = 条件 → 结果；镜子、经验；规律该多当真它看证据自己推（契约 [m2](notes/plan/m2.md)）
   - [留意与关系](notes/design/attention.md) —— 关注什么由它定，系统只负责不让它忘了自己想看的
7. [联想](notes/design/association.md) —— 隐式记忆的家，只管浮现：激活度 + 处境调制；FTS5 + 向量检索（契约 [m3](notes/plan/m3.md)）
8. [自我与出生](notes/design/self.md) —— Agent 唯一能直接写的地方：自述、作息计划、线索卷（契约 [m4](notes/plan/m4.md)、[m7](notes/plan/m7.md)）
9. [组装器](notes/design/assembler.md) —— 它此刻看得见什么：`<now>` 与 `<continuity>` 种子装配
10. [通道与心跳](notes/design/channel-and-heartbeat.md) —— 收件箱、邮箱、勿扰、调度器唤醒（契约 [m5](notes/plan/m5.md)、[m6](notes/plan/m6.md)）
11. [Soma 二代：住户、身体与房间](notes/design/soma2.md) —— 一个房子多住户，每人 home + 一条线 + 一个记忆库；身体适配器（Agent SDK / pi）；公共房间（P3a 交接 [p3-p4-handoff](notes/plan/p3-p4-handoff.md)）
12. [以自身为中心的感知](notes/plan/m8.md) —— 屋里有谁（在线/在场）、声音与播放（自算音频特征与共听）、环境指纹与 `notice`

---

## 核心原则（一页速查）

**分工**
- lib 管"我是谁、我在哪、我知道什么"；harness 管"怎么干活"。**家 = Soma**（一条连续生活线）：Psyche 自身不跑大模型循环，只保留纯粹的事件库与记忆工具；收尾、补写、整理与梗概均委托给宿主身体执行。→ [lib-vs-harness](notes/design/lib-vs-harness.md)、[soma2](notes/design/soma2.md)
- 切分依据是**谁拥有、谁能改**：记忆层是系统机制；自我层是 Agent 唯一能直接写的地方。→ [architecture](notes/design/architecture.md)
- **记忆库的操作，除了权限和初始化，不设计人类参与。** 错了也是经历；错了没后果，说明不重要。

**数据**
- **事件溯源**：只追加的事件日志是唯一真相；其余一切是投影，可删可重建。→ [events §一](notes/design/events.md)
- **三层**：事件（库房，Agent 碰不到）→ 经历（Agent 的记忆，投影）→ 资料（提示词、文档、代码、文件，经角标展开，不褪）。→ [events §七](notes/design/events.md)
- **投影确定性，重放绝不调 LLM**；与时间相关的读时算；向量作为派生缓存按 `(ref, model)` 异步维护。
- 三类事件：**经历 / 自我 / 处境**；机制变更进**系统日志**（可查、不推送）。
- 事件不可变 → 内容的任何变化都以新事件出现，Agent 天然看得到："不能把手伸进别人脑子里"。

**自我**
- "提示词 + 模型 → 我的表现"是最基本的自我认知：提示词全文对 Agent 可见；自述在前、机制在后。
- **初我**：出生时自述为空，机制段（`prompts/mechanism.md`）由系统确定；Agent 自行写自述并持续演进。→ [m4](notes/plan/m4.md)

**记忆**
- **口吻决定认同度 → 记忆文字只由它本人写**。显式（情节、规律、经验…）它写：换段收尾热写、空闲睡着冷写；隐式（强度、证据近因、预期）系统算，只决定浮现什么；系统不代写它口吻的任何字。→ [catalog §一](notes/design/catalog.md)
- 情节**按重要性分配细节**，不按原文长度：判据是"意外"和"后果"。→ [catalog §二](notes/design/catalog.md)
- 冷写时系统只给材料不给结论；反馈原样提供（镜子）。每样产出均有明确消费方。
- **召回 = 还原此刻的处境，不是回答问题**：系统拉（组装器 `<now>` + 联想浮现）+ 它自己查（跨全部投影与馆藏地图）。→ [catalog §七](notes/design/catalog.md)

---

## 模块地图与现状

| # | 模块 | 状态 | 核心契约与设计 |
|---|---|---|---|
| — | 事件模型（公共接口） | ✅ 已落地 | [events](notes/design/events.md)：只追加事件表、确定性只读投影 |
| 2 | 档案馆 | ✅ 已落地 | [archive](notes/design/archive.md)：FTS5 全文索引、SQLite `p_vec` 语义向量缓存 |
| 3 | 编目：热写与收尾 | ✅ 已落地 | [catalog](notes/design/catalog.md)、[m1](notes/plan/m1.md)：会话换段收尾、索引行 brief 优化 |
| 4 | 阅览室：冷写与书架 | ✅ 已落地 | [reading-room](notes/design/reading-room.md)、[m2](notes/plan/m2.md)：事实/规矩/规律/镜子、反例 `revise`、[留意与关系](notes/design/attention.md) |
| 10 | 联想与浮现 | ✅ 已落地 | [association](notes/design/association.md)、[m3](notes/plan/m3.md)：处境激活、字面+向量混合打分、种子去重 |
| 5 | 自我与初我 | ✅ 已落地 | [self](notes/design/self.md)、[m4](notes/plan/m4.md)：`self-v0.md`、`birth.ts` 单次出生、[线索卷 m7](notes/plan/m7.md) |
| 6 | 组装器 | ✅ 已落地 | [assembler](notes/design/assembler.md)：组装 `<now>` 与 `<continuity>` 换段接续种子 |
| 7 / 8 | 通道、心跳与调度 | ✅ 已落地 | [channel-and-heartbeat](notes/design/channel-and-heartbeat.md)、[m5](notes/plan/m5.md)、[m6](notes/plan/m6.md)：收件箱、邮箱唤醒、调度器委托 Soma 执行睡着任务 |
| 9 | 门户与多租户（Soma 二代） | ✅ 已落地 | [lib-vs-harness](notes/design/lib-vs-harness.md)、[soma2](notes/design/soma2.md)：多住户路由、公共房间（[P3a](notes/plan/p3-p4-handoff.md)）与工位 [claude-code](notes/plan/claude-code.md) |
| 1 | 感知（以自身为中心） | ✅ 已落地 | [m8](notes/plan/m8.md)：M8a 屋里有谁（在线/在场）、M8b 声音与播放（特征自算与共听）、M8c 环境指纹与 `notice` |
| ⟂ | Lethe 褪色 | ⏸ 后置 | [events §九](notes/design/events.md) |

## 已定的取舍

- **架构与部署**：先本地单机部署，本地多住户（`<数据目录>/<id>/psyche.db`）；Psyche 服务端无状态对外暴露 HTTP + MCP，本体不跑大模型，全部推理交由宿主 harness。
- **技术栈**：Bun + TypeScript + Hono + SQLite（原生 FTS5 分词 + 向量派生表），音频特征基于 ffmpeg 自算。
