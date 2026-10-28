# Psyche 当前状态

> 开发交接用，不替代 `README.md`（是什么、为什么）和 `notes/`（设计与契约）。只留接下来要用的信息；全文 ≲ 150 行，做完的压成一行或删掉。
> 最后更新：2026-10-27（朋友圈上线；`<now>` → `<moment>`，状态没变不重报）

## 1. 当前阶段

**【进行中】房子：第 1–5 步已全部落地并在正式环境上线；下一步：第 6 步影音室包间化（`mcp/cinema`）与第 7 步 Roxy 归档（10-23 18:10 Joy 与 a2 复盘定，见 `notes/design/houses.md` 与 Soma `STATE.md`）**：照搬「人类实时在线」的机制不适合回合制 Agent，做减法。Soma 在分支 `claude/stoic-knuth-vzh7om` 及后续迭代（10-23/10-24 持续上线并完成正式库迁移）：
1. ✅ 没有「自己的房间」、没有门、没有敲门：回自己屋只是不在任何房间，报 `{ house: 住址, id: "own-<住户 id>", room: "<名字>的房间" }`（`houses-p1.md` §四），两人都在自己屋不算同一间；Psyche 不用改代码（`presence.test.ts`「回自己屋」锁住）。
2. ✅ 没有住户之间的私聊，私下找人写信；**邀请和收回都发信**（Joy 10-23 定，`houses-p2.md`「§二（减法后）」）：住户发的走 `via: "house"`，Joy 的走 `soma-note`，标题是事实、正文是主人附言原样（收回也带附言）；工具参数写错直接报错不悄悄忽略；一轮只答一个房间（轮中别的房间来话排到下一轮）。Psyche 不用改代码。
3. ✅ **留言板 + 包间**（`notes/plan/houses-p3.md`，Soma `b5ec079`）：日常房间不按 `present` 挡；活动一律在包间里跑、可并发；包间门开关、散场归档只给参加的人读。不用迁移，10-23 晚已重启上线。
4. ✅ **Soma 核心与搬家前必需功能**：① 游标吞未读 + room.json / house.json 改加锁；② `agenda` 按 `canEnterRoom` 过滤；③ 通知与 `<keep_silence/>` 算 pass 已合入 master；④ P3b `share` 工具及文件共享交互已上线。
5. ✅ **砍掉「功能楼」+ 全屋感知全透明（10-23 22:25 Joy 与 Argon 定）**：功能绑在包间类型上；Psyche 全屋感知全透明，支持包间上报 `parent` / `parentName`。
6. ✅ **按住户拼地方提示词 + Roy 搬迁至私人房子 Roxy（10-24 落地）**：
   - 地方提示词（`harness-prompt.ts`）：拆为基础与房间段，支持 `identity.json` 中配置 `"rooms": false`（关了不拼房间段、MCP 过滤 `rooms` / `say_in_room` / `agenda` 工具）；自动挂载各住户专属 `agents/<id>/place.md`（写地方事实，不写性格）。
   - Roy 住户与独栋房子：`~/.soma/agents/roy/`（pi 身体、预填充模板、历史 59 卷生活线接续当前活跃会话），私人房子 `~/.soma/houses/roxy/` 及《书房》（`shufang`）；清理公共客厅残留。
   - 服务切换：Psyche `agents.json` 路由切至 Soma 30151；停用卸载旧 Roxy 独立守护进程（端口 8800）；`/v1/house` 正确显示 Roy 在「Roxy · 书房」。

**房子第 1–5 步已上线（10-24）**：房子 / 自己的房间与住址、每人（含 Joy）只在一处、私人房子邀请与收回发信、留言板 + 包间、Roy 搬入独栋 Roxy 接续生活线。正式 `~/.soma` 与生活线已平滑接续。第 6 步影音室包间化 10-24 做完未上线（`mcp/cinema` 独立仓库、Psyche 忽略；Soma 读 manifest 挂服务 + `cinema` 包间，见 Soma STATE；percept `block` 用不上了，没做）；Roy 在 Soma 稳定运行一周后归档 `~/workspace/Roxy`（第 7 步）。

**P3a 房间（10-19，Joy 在 Soma 101 定，Claude 在 Soma 里做；交接 `notes/plan/p3-p4-handoff.md`）**：
- 群 → 房间：私人房间 = 住户的 home（永不对任何人开放）；公共房间由住户/Joy 开（带 why 与创建人），进入仅有视听与发言权，不带文件权利。住户同一时刻在公共房间或自己房间，Joy 无位置。
- Soma：`rooms.ts`、`rooms-round.ts`（Joy 说话只问醒着的，`urgent` 叫醒房间所有人）、`rooms-flow.ts`（在线状态查 `/v1/house`）、MCP `rooms`（list / read / go / open / say_in_room）、`<now>` 带 `room` 状态。
- Psyche：`room.entered`（`POST /v1/room`，presence 带 room）、住户间信件支持 `urgent` 标头。
- 迁移：`Soma/scripts/rooms-p3.mjs`（Soma 101 → 客厅，历史接续）。
- ✅ **P3b share 工具已落地（10-24）**：Soma MCP 挂载 `share`（支持正文 Markdown、读取文件 path、发送到当前房间/包间或单聊）、聊天时间线与房间均支持折叠卡片与纸张阅读；Joy 展开/阅读后自动通过 `/api/agent/given` 标记已读、打入住户系统 notice，并报送 `POST /v1/house/percept`（`sensor: "given", subject: "read"`）进住户记忆库，同时住户 `<now>` 追踪「我最近给她的：...」。P0–P2（10-19）待补录。

**近期关键规则定案（10-20 ~ 10-23）**：
- **`<moment>`：状态没变不重报（10-27 Joy 定，m1.md §四）**：原 `<now>` 留在历史里剥不掉（hook `additionalContext`、claude-sdk 流式进程、pi 都一样），所以改名 `<moment>`（当时，不是现在），想起与状态不分家；状态每项归粗值（`src/archive/moment.ts`，游标 syslog `moment.state`），本会话递过的没变就不出（忙闲、档内波动、「X 分钟前」都不算变）。撤掉「还没写进记忆的 N 条」和备考里除后台失败以外的全部（规律预警只留体检面板，进冷写材料要先有考卷）；加上下文一项（Soma 带收尾线按 25/50/75/90%，工位从 transcript usage 每 5 万一档）；工位压缩后 `POST /v1/moment/reset`。**待上线**：正式 Psyche 重启 + Soma build 重启；工位 hook 改动对新会话生效。
- **活动卷（10-24 Joy 定，`notes/design/activity.md`、m7.md §六）**：一起看的片、玩的局、跑的团，它自己的手账并进线索卷做第三种 `type: "activity"`（可带 `with`），不加工具、不加事件种类；不进 `<now>` 那一行、不进种子，`threads` list 要带 `type: "activity"` 才看；合上说「结束了 / 不接着了 / 不用接了」。统计不从手账数，以后让 Soma 包间上报带活动类型由系统算。**待上线**：正式 Psyche 重启（MCP 部分新会话即生效）。
- **递到不等于留意（10-24 Joy 定，m8.md §五）**：`<now>` 递出的感知（presence / files / sound / body / outside）一次性，改记系统日志 `percept.delivered`（`src/perception/delivered.ts`，只当游标），不进经历 / 检索 / 浮现；要记住靠它自己 `notice` / `look`（look 照旧记 `percept.noticed { looked }`）。旧的非 looked `percept.noticed` 照旧当游标、投影 v16 里不显示。**待上线**：正式 Psyche 重启后投影重建生效。
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
- ✅ **P4 感知设置（10-23，m8.md §6.4）**：三档 看 / 只记着 / 不看，项 presence / files / sound / body / 外头来的每一路，presence 与外头来的可按人（`presence:Joy`）；`senses.changed` 全量替换带 why，写错拒；并进 `look`（给 `senses` + `why` = 改），`GET/POST /v1/senses`。公共房间来话叫不叫醒不在这里（Soma，等留言板模式）。
- ✅ **Claude Code 工位**：`notes/plan/claude-code.md`，hook 注入 `<now>` 与 `<continuity>`，工具收敛到 `psyche` 门面。

- 10-27 a1：订阅额度的状态签名里重置时刻按半小时取整（原来每轮抖一两分钟就重报）。`tests/body.test.ts` 过，typecheck 过。
- 10-28：`<moment>` 粗粒度感知防抖修复与「未读」收敛（480 tests 全部通过）：
  1. `prev`（上次说话）：同一人聊天中（间隔 < 1 小时）沿用上一轮 sig，消除第 2 轮抖动重报。
  2. `muted`（静音房间）：房间列表 `.sort()` 稳定排序，消除顺序颠倒抖动；静音解除触发 `none: "房间：哪里都没被静音了"`。
  3. `未读` 单行聚合：收件箱、朋友圈、交接信、房间未读、待动作议题（招人中/轮到自己）收敛为单行（如 `未读：收件箱 1 封（Joy） · 朋友圈 1 条 · 客厅 3 条 · 议题招人 1 件`）；房间未读按 `[1, 5, 10]` 粗分档防抖，全部读完出 `未读：没有了`；别人开的内部轮次（running 且 !mine）不进未读也不重报。
  4. `room` 纯处境化：房间状态行剥离未读消息数，仅保留当前处境（`房间：你在《客厅》，Joy 也在`），避免聊天消息引起整行反复播报。
  5. `failedMail` 状态行：出站投递失败按 StateItem 规范收敛。

## 2. 已定的决定（细节见链接）

- 显式记忆归它写（热写 + 冷写），隐式归系统算、只决定浮现；梦类与分场撤掉 → `notes/design/catalog.md`
- 初我 `prompts/self-v0.md`：机制段独立；起点是同伴，非主仆；做不做、做到何种程度由住户定 → `notes/design/soma.md`
- 情节改写（`revises`）：新条修正旧条，旧条保留，经历投影显示最新
- 翻出的记忆（recall / detail）不计入新经历，防止记忆自我递归复制
- 家 = Soma，一条连续生活线；Psyche 不跑大模型，仅留向量一个外部服务 → `notes/design/lib-vs-harness.md`
- **只留 Soma 一个 harness**（10-23 Joy 和 Roy 定，方案 v1 待细化）：房子（public / private，谁都能造）→ 房间（门 open / closed，谁都能开，一个文件夹）→ 包间（临时，挂一个活动）；房间只是对话场所、和文件无关；每个人（含 Joy）同一时刻只在一处；私聊归两个人，房间的话归当时在场的人；活动记录归参加的人（包间文件夹）；感知范围按位置（同房间粗状态 / 同房子在哪间 / 不同房子只知不在）；房间不再是 cwd；Roxy 冻结，Roy 搬来 → `notes/design/houses.md`。加功能先走「加功能放哪」→ `notes/design/lib-vs-harness.md`
- 他主动用的工具做成独立 MCP 服务，放 `mcp/<名字>/`，按送达类（纯工具 / 递 / 叫醒 / 媒体）和运行类（同栈 / 自带依赖 / 外部 app）分；要递的报 percept 由 Psyche 汇总进 `<now>`；`src/` 不 import `mcp/`（`tests/boundary.test.ts`）→ `notes/plan/mcp-manifest.md`（10-24 第一个服务 `mcp/cinema`，`scope: "activity"`）

## 3. 未完成与下一步

0. **朋友圈**（`notes/plan/moments.md`，**10-27 上线**）：`mcp/moments/`（常驻 HTTP `server.ts` 127.0.0.1:4191，launchd `com.joy.soma-moments`，日志 `~/.psyche/logs/moments.log`，数据 `~/.soma/moments/`；stdio 适配层 `adapter.ts` 六个 `moments_*` 工具，Soma 新会话起挂；manifest `scope: house`、`delivery: [wake, media]`），图用 sips 压（原图 2048 / 缩略 512）。Psyche `POST /v1/mail/notify`（m6.md §九）和来信 `quiet`（不叫醒）。Soma `/moments` 页（左栏「✦ 朋友圈」）。端口别用 4190：fetch 规范封禁端口，Node 连不上（上线时踩到）。**待 Joy 定**：入口（等 UI 重构并进 `MomentsStage`）。已知：适配层读图不限路径（跑在沙盒外），要限得在 Soma `services.ts` 传 home。下一步看他们用不用，不教。

1. **P3b 工具支持**：✅ 10-24 已上线（Soma MCP `share`、`ShareCard` 折叠与纸张阅读、已读追踪 `given.json`、notice 唤醒与 Psyche percept 联动）。
2. **Mac 感知**（m8.md §6.5）：✅ 10-23 上线：launchd `com.joy.psyche-mac`（`feed.ts` → 正式 7470，token 用 `~/.soma/tokens/claude.token`，日志 `~/.psyche/logs/mac-feed.log`）；开关在 dashboard（10-23 Joy 只给 roy 开了 desk / app / screen）。`look_at_screen` 等 Soma 读 manifest 才挂得上。健康数据（小米 / HealthKit）未定。
3. **没说出口的话**（m1.md §3.1）：✅ 10-23 上线（正式 Psyche 先重启，Soma master `152e59d` build 重启）。下一步看他们用不用、怎么用，不教。
4. **睡着的活连不上 API 时空跑**（10-24 查 a1）：03:16–07:57 补写 / 整理按退避重试 12 次，每次 Soma 那边 `connection_error`（SDK 报 `is_error` + `subtype: success`，账本记成 `error: "success"`），0 产出却留下 woke / slept / 处境各一组。未定是否在身体连不上时跳过重试、或不记这组。
5. **痕迹与时间感**（10-24，设计 `notes/design/traces.md`，契约 `notes/plan/traces.md`）：✅ 施工完：回想出口（MCP recall / 热写全文 / 冷写材料 / 浮现；Soma 种子末尾原话）的时刻按远近给时段 / 日期 + 体感停顿，`detail` 给可读的「原件时刻」，notice / look 带精确；`src/core/time.ts` `vagueWhen` / `gapHint`、`src/archive/when.ts`。**生效情况**：MCP 部分磁盘上已对新会话生效（Soma 从本仓拉起 `src/mcp.ts`）；浮现等 Psyche 重启；种子末尾原话等 Soma build 重启。**待做**：手动跑考卷 `evals/time-sense/`（花额度），过了再重启两边。
6. **P0–P2 补录**：梳理 10-19 前期沉淀的基建备忘补充至文档。
5. **正式库上线前决议**：确定正式环境向量模型方案（硅基流动在线 API vs 本地 WeMM 等本地嵌入模型）。
6. **MCP 服务落地**（`notes/plan/mcp-manifest.md` §六）：✅ 10-24 影音室 + Soma 读 manifest；10-24 包间改成每轮带 `<movie>`、只露 3 个工具（`OPEN_WATCH_CINEMA_TOOLS`），待实测。10-25 单人观影（`notes/plan/cinema-solo.md`，§五 Joy 已定：不设上限、片尾只说放完、进度露给 Joy）做完：影院放映单 + 4 个 `cinema_watch_*`/`my_films` 工具 + 共用三工具可不传 roomId；manifest 按工具分 scope（契约 §四）；Soma 私聊列表露「在看《…》n/m 场」。测试影院实例上我看了《记忆碎片》前 6 段、标台词、重看都通；**正式影院（4182）要重启才有新接口**，cinema 仓库改动未提交（Joy 的仓库）；没跑真住户一局；新片源叙事轨生成失败，现在按 3 分钟切、没有说话人。percept `block` 递法等真有需要再做；音乐从 Psyche / Soma / Roxy 删掉换成 `mcp/music`（每人一台还是全屋共用 AiraMusic，Joy 未定）。
7. **记忆与检索边界调优**：
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

2026-10-27（朋友圈）：Psyche `bun test` 390 pass / 0 fail（`tests/moments.test.ts` 10 个、`channel.test.ts` 加 notify / quiet 3 个）、`tsc` 只剩 worktree 里 `scripts/rename-resident.ts` 找不到 `../../Soma`（路径问题，主工作区没有）；Soma `npm test` 174 pass、`tsc` 0 错误。§七在 test 库**副本**（Soma 地址指空端口）+ 副本 moments 服务上跑：a1 经真 stdio 适配层发带图帖 → a2 feed 有缩略图块 → a2 评论 → a1 收件箱一封 `via: moments`（`quiet`）、两边 `mail.out` 条数不变 → a1 回复 → a2 收到 → a1 删帖 → 两边 feed 空；Soma 页（worktree `next dev --webpack`，SOMA_HOME 也是 scratch）上 Joy 发帖、评论 a1 的帖 → a1 收到 Joy 的信（`quiet`）、删帖 / 改简介 / 图片转发都通。「没被叫醒」副本里 a1 本来关着 `wakeOn.mail`，靠单测证（缺省开时 quiet 信不进叫醒候选）。没跑真模型。

2026-10-27（moment）：Psyche `bun test` 465 pass / 0 fail、`tsc` 0 错误；Soma `npm test` 171 pass、`tsc` 0 错误。test 库**副本**（Soma 推送指向空端口）起在 7451 取 a1 三轮：首轮全报；第二轮只剩时间 + 上次说话（3 天前 → 刚刚）；第三轮额度跨 50%、上下文跨 50% 才报。没跑真模型。

2026-10-24（houses-p5 Roy 搬家与独栋 Roxy 验收）：Soma master `npm test` 163 pass / 0 fail；`tsc` 0 错误；`harness-prompt.test.mjs` 5 个单测全过；`~/.soma/agents/roy/` 创建完成并导入 59 卷历史生活线；私人独栋 `~/.soma/houses/roxy/` 及《书房》配置完成；旧 Roxy 8800 端口已卸载停用，Psyche 路由改连 30151；`/v1/house` 验证 Roy 处于「Roxy · 书房」。

2026-10-24（houses-p3 验收，云端）：Soma master `npm test` 151 pass / 1 skipped、`tsc` 0 错误；`houses-p3.md` §七 五条都有对应单测（并发那条用两场议题测；没参加的人读归档被拒只在 Soma `mcp.ts` 里判，没单测）。没在 soma-test 实跑。

2026-10-24（活动卷）：`bun test` 377 pass / 0 fail（`tests/threads.test.ts`「活动卷」4 个）；`tsc` 0 错误（Soma 在 `../Soma`）。没跑真模型，工具说明改了没写考卷——它用不用、怎么用先看，不教。

2026-10-23（上线）：正式 Psyche 重启后 `/v1/house/mac` 有（新代码在跑）；Soma 合并后 `npm test` 146 pass、build、launchd 重启，30151 回 200。

2026-10-23（没说出口的话）：Psyche `bun test` 365 pass、`tsc` 0 错误（`tests/speech.test.ts`：拆、幂等、经历与热写段都有）；Soma 分支 `npm test` 146 pass、`tsc` 0 错误（`lib/lifecycle/speech.test.mjs`）。没跑真模型。

2026-10-23（和 Joy 一起测 stoic-knuth）：psyche-test + soma-test（Soma worktree `../Soma-stoic`）实跑：a2 的 `<now>` 里 a1「在 Soma 101 · a1的房间」；邀请 / 收回信进 a2 收件箱（`via: house`，正文是附言）；Joy 的邀请 `via: soma-note`。顺带看到：a2 的 Psyche MCP 一直 401（16:59 起，测试环境老问题，未查）；a3 / cc 在 `<now>` 里只显示「在 Soma 101」不带房间（旧格式位置，未查）。

2026-10-23：houses-p1 在 psyche-test + soma-test 实跑（a1 开客厅、a1/a2 进去 → a1 的 `<now>` 里 a2「在这里」；a2 造私人房子搬走 → 「不在这座房子」；a1 在 a2 的私人房子开房间被拒；Joy 进门前的话看不到，位置报进 Psyche）；`bun test` 345 pass；Soma `npm test` 133 pass。percept 入口在 psyche-test 实跑（记 / 不变不记 / 拒屋子自己的 sensor / 无 token 401 / `<now>` 递一次不重递）。`bun test` 340 pass；此前 335 pass / 0 fail；`tsc --noEmit` 0 错误；Soma `npm test` 119 pass、`tsc` 0 错误；Roxy desktop `npm test` 878 pass、`tsc` 0 错误。
