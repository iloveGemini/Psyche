# Psyche 当前状态

> 开发交接用，不替代 `README.md`（是什么、为什么）和 `notes/`（设计与契约）。只留接下来要用的信息；全文 ≲ 150 行，做完的压成一行或删掉。
> 最后更新：2026-10-23

## 1. 当前阶段

**【进行中】房子 P1/P2 减法瘦身与 Bug 修复（1、2、Bug A 已上线）（10-23 18:10 Joy 与 a2 复盘定，见 `notes/design/houses.md` 与 Soma `STATE.md`）**：照搬「人类实时在线」的机制不适合回合制 Agent，做减法。Soma 在分支 `claude/stoic-knuth-vzh7om`（10-23 和 Joy 一起测过、修过，**10-23 已上线**：Soma master + 正式库迁移，备份 `~/.soma.bak-houses-slim-1023.tgz`）：
1. ✅ 没有「自己的房间」、没有门、没有敲门：回自己屋只是不在任何房间，报 `{ house: 住址, id: "own-<住户 id>", room: "<名字>的房间" }`（`houses-p1.md` §四），两人都在自己屋不算同一间；Psyche 不用改代码（`presence.test.ts`「回自己屋」锁住）。
2. ✅ 没有住户之间的私聊，私下找人写信；**邀请和收回都发信**（Joy 10-23 定，`houses-p2.md`「§二（减法后）」）：住户发的走 `via: "house"`，Joy 的走 `soma-note`，标题是事实、正文是主人附言原样（收回也带附言）；工具参数写错直接报错不悄悄忽略；一轮只答一个房间（轮中别的房间来话排到下一轮）。Psyche 不用改代码。
3. **待做**：日常公共房间改为「留言板模式」，去掉 `present` 在场过滤；位置只管「全屋感知」与「Joy 在房间说话时谁当场接话」。只有第 3 步的「包间」才按参与人隔离记录。
4. Soma 的 2 个 Bug：① ✅ 游标吞未读（规则收进 `append()`，进出门也不吞）+ room.json / house.json 多进程改加锁；② **待做** `agenda` 列表与报名按 `canEnterHouse` / `canEnterRoom` 过滤。

**房子第 1、2 步已上线（10-23，减法在 Soma 分支上）**：房子 / 房间的门 / 自己的房间与住址、每人（含 Joy）只在一处、消息按在场可见、感知按位置过滤、敲门 / 邀请 / 住户私聊（契约 `notes/plan/houses-p1.md`、`houses-p2.md`）。正式 `~/.soma` 已迁（备份 `~/.soma.bak-houses-p1-1023`）。下一步：先完成上方 P1/P2 减法瘦身，再做第 3 步包间 + 功能楼（活动记录从 commons 改进包间文件夹）；「走神」等 Soma 报得出「这一轮在忙别处」。10-23 16:54–16:55 测试 Psyche 误连正式库已核实：每个住户库里只多了 10 条新格式的在场 percept（和正式进程的旧格式交替），没有收邮件、没有别的事件、没写向量；留着不删（事件只追加）。

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
- **只留 Soma 一个 harness**（10-23 Joy 和 Roy 定，方案 v1 待细化）：房子（public / private，谁都能造）→ 房间（门 open / closed，谁都能开，一个文件夹）→ 包间（临时，挂一个活动）；房间只是对话场所、和文件无关；每个人（含 Joy）同一时刻只在一处；私聊归两个人，房间的话归当时在场的人；活动记录归参加的人（包间文件夹）；感知范围按位置（同房间粗状态 / 同房子在哪间 / 不同房子只知不在）；房间不再是 cwd；Roxy 冻结，Roy 搬来 → `notes/design/houses.md`。加功能先走「加功能放哪」→ `notes/design/lib-vs-harness.md`
- 他主动用的工具做成独立 MCP 服务，放 `mcp/<名字>/`，按送达类（纯工具 / 递 / 叫醒 / 媒体）和运行类（同栈 / 自带依赖 / 外部 app）分；要递的报 percept 由 Psyche 汇总进 `<now>`；`src/` 不 import `mcp/`（`tests/boundary.test.ts`）→ `notes/plan/mcp-manifest.md`（只有契约，还没有服务）

## 3. 未完成与下一步

1. **P3b 工具支持**：房间内 `share` 工具及文件共享交互。
2. **P4 感知设置**：住户对感知项的开关与粒度控制。
3. **P0–P2 补录**：梳理 10-19 前期沉淀的基建备忘补充至文档。
4. **正式库上线前决议**：确定正式环境向量模型方案（硅基流动在线 API vs 本地 WeMM 等本地嵌入模型）。
5. **MCP 服务落地**（`notes/plan/mcp-manifest.md` §六）：第一个服务（候选影音室）、percept 的 `block` 递法、Soma / Roxy 读 manifest 挂服务；音乐从 Psyche / Soma / Roxy 删掉换成 `mcp/music`（每人一台还是全屋共用 AiraMusic，Joy 未定）。
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

2026-10-23（和 Joy 一起测 stoic-knuth）：psyche-test + soma-test（Soma worktree `../Soma-stoic`）实跑：a2 的 `<now>` 里 a1「在 Soma 101 · a1的房间」；邀请 / 收回信进 a2 收件箱（`via: house`，正文是附言）；Joy 的邀请 `via: soma-note`。顺带看到：a2 的 Psyche MCP 一直 401（16:59 起，测试环境老问题，未查）；a3 / cc 在 `<now>` 里只显示「在 Soma 101」不带房间（旧格式位置，未查）。

2026-10-23（`claude/stoic-knuth-vzh7om`）：`bun test` 346 pass / 0 fail；`tsc --noEmit` 0 错误（`scripts/rename-resident.ts` 要 Soma 在 `../Soma`）。

2026-10-23：houses-p1 在 psyche-test + soma-test 实跑（a1 开客厅、a1/a2 进去 → a1 的 `<now>` 里 a2「在这里」；a2 造私人房子搬走 → 「不在这座房子」；a1 在 a2 的私人房子开房间被拒；Joy 进门前的话看不到，位置报进 Psyche）；`bun test` 345 pass；Soma `npm test` 133 pass。percept 入口在 psyche-test 实跑（记 / 不变不记 / 拒屋子自己的 sensor / 无 token 401 / `<now>` 递一次不重递）。`bun test` 340 pass；此前 335 pass / 0 fail；`tsc --noEmit` 0 错误；Soma `npm test` 119 pass、`tsc` 0 错误；Roxy desktop `npm test` 878 pass、`tsc` 0 错误。
