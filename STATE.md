# Psyche 当前状态

> 开发交接用，不替代 `README.md`（是什么、为什么）和 `notes/`（设计与契约）。只留接下来要用的信息；全文 ≲ 150 行，做完的压成一行或删掉。
> 最后更新：2026-10-23

## 1. 当前阶段

**P3a 房间（10-19，Joy 在 Soma 101 定，Claude 在 Soma 里做；交接 `notes/plan/p3-p4-handoff.md`）**：
- 群 → 房间：私人房间 = 住户的 home（永不对任何人开放）；公共房间由住户/Joy 开（带 why 与创建人），进入仅有视听与发言权，不带文件权利。住户同一时刻在公共房间或自己房间，Joy 无位置。
- Soma：`rooms.ts`、`rooms-round.ts`（Joy 说话只问醒着的，`urgent` 叫醒房间所有人）、`rooms-flow.ts`（在线状态查 `/v1/house`）、MCP `rooms`（list / read / go / open / say_in_room）、`<now>` 带 `room` 状态。
- Psyche：`room.entered`（`POST /v1/room`，presence 带 room）、住户间信件支持 `urgent` 标头。
- 迁移：`Soma/scripts/rooms-p3.mjs`（Soma 101 → 客厅，历史接续）。
- **待做**：P3b share 工具、P4 感知设置。P0–P2（10-19）待补录。

**近期关键规则定案（10-20 ~ 10-23）**：
- **系统提示词顺序（10-20 Joy 定）**：自述在前、机制段在后（`composePrompt` / `filePrompt`）；机制段改第一人称（「# 我的记忆」，加「是系统的，我改不了」）。下一段换段起生效（修改机制现读，顺序调整需重启 Psyche）。
- **种子去重（10-23 Joy 定，m1.md §五 / m3.md §四）**：`/v1/continuity?since=` 不放开头不早于末尾原话第一行的情节（留 10s 余量），【最近的情节】按天标日期；带 `session` 或 `seed=1` 记 `continuity.seeded`，浮现跳过种子中的情节及末尾原话已有行。
- **会话收尾只给索引行（10-20 Joy 定）**：`GET /v1/hotwrite?brief=1` 每行仅保留前 30 字（避免原文重复消耗 token）；收尾标签统一为 `<psyche-hotwrite>`；MCP `hotwrite_segment` 眼前会话默认索引行（`full: true` 或带 `session` 传全文）；热写完成同轮发言标 `wrapUp`，不单推收尾轮；`<keep_silence/>` 记为 `speech.silent`。

**已完成模块（详细契约见 notes/plan/）**：
- ✅ **M1 热写与收尾**：`prompts/hot-write.md`，换段收尾由 Soma `wrapUpAside` / `wrapIn` 处理，不回流且不另开多余段落。
- ✅ **M2 冷写与书架**：`notes/plan/m2.md`，事实/规矩/规律/镜子四类，支持按次计数、批次限制（≤10k字）与反例修订（`revise`）。
- ✅ **M3 浮现与联想**：`notes/plan/m3.md`，回忆/预期/预感，字面（FTS5 trigram）+ 向量混合检索，空档输入 IDF 过滤与噪声抑制。
- ✅ **M4「我是谁」**：`prompts/mechanism.md` + `prompts/self-v0.md`（初我），`src/birth.ts` 单次出生。
- ✅ **M5「会醒」& 调度器**：`notes/plan/m5.md`，作息/设置/日记/调度器，睡着补写、整理与梗概（天/周/月 `gist`）委托 Soma 身体执行。
- ✅ **M6「通道」& 邮箱**：`notes/plan/m6.md`，收件箱、邮箱（agently-cli）、勿扰、来信唤醒。
- ✅ **M7「还开着的事」**：`notes/plan/m7.md`，线索卷（`threads.ts`），追踪承诺与待办。
- ✅ **M8 感知（以自身为中心）**：`notes/plan/m8.md`。M8a 屋里有谁（在线/忙/闲/个签）；M8b 声音与播放（网易云镜像、音频特征自算、一起听）；M8c 环境进记忆（环境指纹与 `notice`）；内感受（上下文跨档预警）与屋里的东西（文件变动感知）。
- ✅ **Soma 二代架构 & 多租户**：`notes/design/soma2.md`，每住户独立 home + 单物理线 + 独立记忆库；身体适配器（Agent SDK / pi）；P1 多租户路由（`x-psyche-agent` / `?agent=`）。
- ✅ **外头来的事实（10-23，m8.md §6.3）**：`POST /v1/house/percept { sensor, subject?, value, text, to? }`，只记变化，屋子自己的几路不收；`<now>`「这段时间感知到的」。还没有哪一路接进来，Soma / Roxy 的转发路由等第一路接入时再加。
- ✅ **Claude Code 工位**：`notes/plan/claude-code.md`，hook 注入 `<now>` 与 `<continuity>`，工具收敛到 `psyche` 门面。

## 2. 已定的决定（细节见链接）

- 显式记忆归它写（热写 + 冷写），隐式归系统算、只决定浮现；梦类与分场撤掉 → `notes/design/catalog.md`
- 初我 `prompts/self-v0.md`：机制段独立；起点是同伴，非主仆；做不做、做到何种程度由住户定 → `notes/design/soma.md`
- 情节改写（`revises`）：新条修正旧条，旧条保留，经历投影显示最新
- 翻出的记忆（recall / detail）不计入新经历，防止记忆自我递归复制
- 家 = Soma，一条连续生活线；Psyche 不跑大模型，仅留向量一个外部服务 → `notes/design/lib-vs-harness.md`
- Roxy 与 Soma 不融合（10-23 Joy 和 Roy 定），两个地方共用 Psyche；加功能先走「加功能放哪」的判断流程 → `notes/design/lib-vs-harness.md`

## 3. 未完成与下一步

1. **P3b 工具支持**：房间内 `share` 工具及文件共享交互。
2. **P4 感知设置**：住户对感知项的开关与粒度控制。
3. **P0–P2 补录**：梳理 10-19 前期沉淀的基建备忘补充至文档。
4. **正式库上线前决议**：确定正式环境向量模型方案（硅基流动在线 API vs 本地 WeMM 等本地嵌入模型）。
5. **音乐按判断流程拆**：搜歌、取地址和歌词、下载算特征、`player` / `playlist` 工具归地方；`played` / 歌单 / 一起听的记录和「这段时间听到的」留 Psyche。Soma（`lib/music`）、Roxy 各有一套曲库，先定以谁为准。
6. **记忆与检索边界调优**：
   - 情节晚于冷写落库时，按引用的原行去重候选证据。
   - 线索全段输入时常见词 IDF 顶满导致的字面打分饱和（`lex 0.8`）微调。

## 4. 已知问题

- **超长热写分段上限**：极端超长段落（>2.5万 token）走 `hotwrite_segment` 时工具输出会被转存为文件，当前主要依赖工位补写处理，需关注纯 headless 睡着补写对超长段的承载。
- **留意与关系演进**：`attend` / `relation` 已合入并提供底层数据支持，暂未在日常提示词中强行教导，持续观察模型自发利用与反例修正情况。
- **字面打分饱和**：缺少输入原话、拿上一整段作为线索时，高频词累加容易使近期情节字面分顶满，需优化查询构建逻辑。

## 5. 运行备忘

- 测试与启动：`bun test` · `bun run typecheck` · `bun run src/main.ts`（端口 127.0.0.1:7450）
- 住户管理：`bun scripts/add-resident.ts …`（登记与出生流程见 `notes/howto/add-resident.md`）
- VS Code Launch：
  - `psyche-test`：端口 7450，测试数据库（住户 a1, a2）
  - `soma-test`：端口 30152（住户 a1，连接测试 Psyche；监听 0.0.0.0，局域网调试）

## 6. 验证

2026-10-23：percept 入口在 psyche-test 实跑（记 / 不变不记 / 拒屋子自己的 sensor / 无 token 401 / `<now>` 递一次不重递）。`bun test` 339 pass；此前 335 pass / 0 fail；`tsc --noEmit` 0 错误；Soma `npm test` 119 pass、`tsc` 0 错误；Roxy desktop `npm test` 878 pass、`tsc` 0 错误。
