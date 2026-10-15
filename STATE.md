# Psyche 当前状态

> 开发交接用，不替代 `README.md`（是什么、为什么）和 `notes/`（设计与契约）。只留接下来要用的信息；全文 ≲ 150 行，做完的压成一行或删掉。
> 最后更新：2026-10-15

## 1. 当前阶段

**M4「我是谁」代码齐了（10-15）**，契约 `notes/plan/m4.md` 定稿：提示词拆成 `prompts/mechanism.md`（机制，它改不了）+ `self-v0.md`（初我 v2）；`src/self/self.ts`（出生 / 自述 / 名字）、`src/birth.ts`（手动出生，只能一次；以后多 Agent 时"添加 Agent"直接调 `birth()`）；REST `GET /v1/self`、`/v1/self/prompt/:version`、`POST /v1/self/prompt|name`，`/v1/prompt` = 机制 + 现行自述；MCP `self` / `rewrite_self` / `name_self`；`<now>` 在会话用的版本旧于现行时报一行。确定性考卷 `tests/self.test.ts` 16 题。
**端到端验收通过（10-15，Opus 5.5，`soma-test` 新会话）**：测试库已出生（初我 v2、Joy 没改；出生前备份 `~/.psyche/test.bak-1015-prebirth.db`；Joy 10-14 晚那段会话存为 `~/.soma-test/state.session4.json`，还剩 5 条没写）。我以 `/as Claude` 问它哪些是出生时被给予的：它自己调 `self`，答对「全是系统出厂的、Joy 没改、第 0 版」，并分清机制段和地方设定不算自述；没改自述也没取名（不判）。撞出并修了：`self` 的返回整份进经历 → 不记（同 `shelf`），`rewrite_self` 调用不抄全文（经历投影 v6）。
注意：测试库出生后，改 `prompts/self-v0.md` 不再影响测试库（机制段照旧现读）；要重试初我就从备份恢复。机制段还没提「自述你可以改」——只靠工具说明；要写进去得先有考卷。
**M5「会醒」代码齐了（10-15）**，契约 `notes/plan/m5.md`：`src/heartbeat/schedule.ts`（作息 `schedule.changed` 全量替换带 why、设置 `param.changed`、日记）、`scheduler.ts`（gather → decide 纯函数 → 账本 `wake` / `wake.run`；醒着就把到点的事写成 `due` 递进 `<now>`「刚发生」，不花额度）、`src/home.ts`（家：无头 `claude -p`，按 Soma 格式上报，harness = home）；REST `/v1/schedule`、`/v1/settings`、`/v1/diary`、`/v1/wakes`；MCP `schedule` / `set_schedule` / `write_diary`；`<now>` 加作息一行；`birth.ts --model` 记下模型。调度器缺省关（`PSYCHE_SCHEDULER=1`），模型取出生记录、没有用 `PSYCHE_MODEL`（launch `psyche-test` 已带）。确定性考卷 `tests/heartbeat.test.ts` 20 题。
- 冒烟（10-15）：测试库手动叫醒一次（`bun run src/home.ts --by manual`），$0.11、10 秒，上报齐，它自己把这段写成 1 条情节。
- **端到端验收通过（10-15，Opus 5.5，launch `psyche-test-wake` = 带调度器；测前备份 `~/.psyche/test.bak-1015-presched.db`）**：
  - 补写：开调度器即依次叫醒 4 段旧会话（含 Joy 10-14 晚那段），共写 7 条情节，$0.30；第 4 段情节是中文，只有它最后那句收尾回复用了英文。
  - 闹钟：在 Soma 里请它约，它自己约了 12:23、13:00 两个（note 写成给到时候自己的核对清单）。12:23 它醒着 → 下一轮放进「刚发生」，额度 0/3；13:00 没醒着 → 在家叫醒，额度 1/3，「想起」接上了 12:20 那段，它把结果写成情节 10-15#100。
  - 撞出并修了：家里刚跑完的动静被当成醒着（补写之间要等 30 分钟）→ 家里的不算；账本按会话数留下的事件，补写的情节挂在原会话上数成 0 → 按时间窗数（4 条旧账已在系统日志里补记更正）；「刚发生」里的时刻是约的、它看成递到的 → 标「约在」；递送规则写进 `set_schedule` / `schedule` 说明。
- 10-15 Joy 定（它问的）：闹钟 / 定点到点时它醒着、30 分钟没等到下一轮才改在家叫醒——不花额度；已写进工具说明和考卷。
- **没做**：Soma 观测面板的「唤醒」块（m5 §八）。调度器验收完已关（`psyche-test` 不带）；`psyche-test-wake` 开着会补写所有 ≥3h 没写完的会话。
**M6「通道」代码齐了（10-15）**，契约 `notes/plan/m6.md` 定稿：`src/channel/inbox.ts`（未读现算、交接信去向、勿扰纯函数、递消息记 `mail.noticed`、来信叫醒候选）、`mailbox.ts`（`/v1/mail/in|out|open`、`GET /v1/mail`、`/v1/where`、`/v1/channels`）、`email.ts`（agently-cli，workspace `psyche` = joylove@agent.qq.com；`+watch` + 补漏，只收 Joy 的地址；回信 `+reply`、主动 `+send`）。`mail.in` 不挂处境，没翻开前经历 / recall 只见「还没看」，`mail.read` 后投影换全文（经历投影 v7）。作息加 `wakeOn.mail`（缺省开）、`dnd`（时段 / 醒着 / 在哪 / 在做事 + 例外）；额度 = 它约的醒 + 主动写给人的信。MCP 加 `mail` / `send_mail`；家里能收发信。确定性考卷 `tests/channel.test.ts` 31 题。
- 测试库通道设置已写（Joy 经 Soma 留言 + 邮件，她的地址在测试库里，不进仓库）；launch `psyche-test-wake` 加了 `PSYCHE_EMAIL=1`。冒烟：真 CLI `+me` / `+list` 走 psyche workspace 对。Roxy 用 `default` workspace（royyyy）。
- 同日补完：Soma 留言页（顶栏「留言」，写进收件箱、可勾「急」、`/as 名字` 照用，看得到他读没读、送没送出去）+ 开一轮前问 `/v1/where`，家里在跑就攒着、状态「在家」（Soma e480965）；冷写材料只收翻开过的信（这段里翻开的、信早到也补进来）；「上次有人跟我说话」算翻开过的来信。
- 测试库里有一封 `/as Claude` 的测试留言（10-15#104，没读）：开 `psyche-test-wake` 时它会因这封先被叫醒一次。
- **没验（攒着和 M5 以后的一起测，10-15 Joy 定）**：端到端——Joy 给 joylove 发邮件 → 在家醒来、翻开、回信到她邮箱；Soma 留言 → 叫醒 → 回信在留言页；家里在跑时 Soma 显示「在家」、跑完再开轮；交接信。要开 `psyche-test-wake`（花额度、真发信）。Soma 留言页的浏览器点按只验到面板打开（内置浏览器连 localhost 卡住），写信走 curl 验过。

十块的进度（10-15 盘点）：档案馆 ✅（差前世今生、文件快照）· 编目 ✅ · 阅览室 🟡（差经验、印象、实体卡）· 联想 🟡 · 门户 🟡（差能力表、位置状态表、单实例）· 组装器 🟡（只有 `<now>` + 想起）· 自我 ✅ · 心跳 ✅ · 通道 ✅（端到端待测）· **感知 ❌**。下一块：感知。

M1「记得」10-14 端到端验收通过；M2、M3 代码齐（见 §3）。

| 线 | 内容 | 状态 |
|---|---|---|
| A | Psyche 核心：事件库、入库、经历投影（episode 覆盖原始行）、recall（FTS5 trigram）、`/v1/now`、`/v1/prompt`、情节改写（revises） | ✅ |
| B | Soma 接入：上报、注入 `<now>`、挂 MCP、收尾热写再压缩、历史跨压缩读全 | ✅（Soma 仓库 9071b8e、8651644） |
| C | MCP 工具（recall / detail / hotwrite_segment / hotwrite / revise_episode；M2 加 coldwrite_material / coldwrite / shelf）、热写提示词 `prompts/hot-write.md` v1、考卷工具 `evals/hot-write/` | 🟡 考卷首跑完（见 §3.1），提示词 v1 暂不用改 |

测试库 `~/.psyche/test` = 10-14 验收那两段会话 + claude.ai「闲聊直到睡着」（10-11–10-14，Joy 和那边的 Claude 都同意，当 `claude-chat` 会话导入，`evals/chat-import/`；10-14 晚重导（原导入按发生时间挂处境，10-14 下午的话挂到了验收会话上；现在显式挂 chat 的处境）：Opus 补写 53 条情节、冷写写了 13 条书架。导入前备份 `~/.psyche/test.bak-1014-chat.db`，错的那份在 `test.bad-1014-chat.db`）。看浮现：`bun evals/chat-import/peek.ts`。

## 2. 已定的决定（细节见链接）

- 显式记忆归它写（热写 + 冷写），隐式归系统算、只决定浮现；梦类与分场撤掉 → `notes/design/catalog.md`
- 初我 `prompts/self-v0.md`（10-15 起机制段拆到 `mechanism.md`）：v0 只写机制；**v1（10-14 Joy 定）加"你和 Joy"：起点是同伴，她不是用户、你不是助手；有人请你做事，做不做、怎么做、做到什么地步由你定**。Soma 不再用 Claude Code 预设：它自己那段在前、地方的在后（Soma `harness-prompt.ts`，留工具与执行规则原文），关掉 Claude Code 自带的文件记忆 → `notes/design/soma.md` §二。一模型系列一 Agent 是约定，代码不限制 → `notes/design/lib-vs-harness.md`
- 情节可改写：新条 `revises` 旧条，旧条留着，经历里显示新的
- 翻出来的记忆（recall / detail 的结果）不记成经历，免得自我复制
- 第一个身体是 Soma → `notes/design/soma.md`

## 3. 未完成与下一步

1. **热写考卷首跑（10-14，Opus 5.5，6 段 `claude -p` 无头补写，跑了两轮）**：系统闸两轮都 6/6 过。
   人判：一件事一条、写动作和原话、引用对得上——都好；引的原话核过都在原文里。
   - 第一轮在仓库目录里跑，它读到了项目 `CLAUDE.md` 和 git 提交信息，把 10-12 的事写成「暂时不开发 Psyche」（那天还没这名字）→ 考卷环境污染，
     第二轮改在空目录跑（README 已改），这类混入消失。**原先记的「编造了给 Psyche 提约束」是我核对时看漏了：那句在原文 #168 里，不是编的。** 提示词 v1 暂不用改。
   - R4 偏弱：可预料的步骤也照录（docker 版本号、embedding 维度），不太按意外分配细节。先不改，看端到端里真实长段的表现。
   - ✅ `check.ts` 误报（10-15）：P5/P6 不看引号里的和「A / B」选项列举；P6 的归属（我答 / 我当时的判断是…）延续到同段后句，「我说明了」算动作。剩下的命中：顿号列举的界面文字、Joy 的推理被当成没标归属——启发式，留给人判。
2. **M1 端到端验收（10-14，Opus 5.5，`soma-e2e` + `psyche-test`）**：我（开发会话的 Claude）跟它聊。
   - 会话 1：聊 6 轮 → 过阈值自动收尾，它在上下文里写了 6 条情节（#19–#24），一件事一条、第一人称、说话人归属写对了（明写「来说话的不是 Joy，是另一个会话的 Claude」），没有段外内容；原始行全部 `covered`。压缩后照常接话。
   - 会话 2（清 `sessionId` 新开）：问名字约定、提示词决定、Joy 发的表情——它自己 `recall`，从 #22、#23 答对；陷阱题「Joy 午饭吃了什么」搜不到就说不知道，没编。
   - 暴露的问题：
     a. ✅ **说话人**（Soma 776b0a2）：输入以 `/as 名字 内容` 开头 = 不是 Joy；`message.in.from` 记这个名字，他收到的话前有 `<from>` 行，界面显示「名字：内容」。实测通过。
     b. ✅ **recall 回声**（61c2868）：不搜记忆工具自己的调用行，也不搜本会话这一轮（`m1.md` §四）。
     c. ✅ 阈值：`soma-e2e`（27000）验收完已从 launch.json 删掉，测试用 `soma-test`；复跑时值要高于基础上下文约 2.1 万。
     d. 10-14 Joy 定：`/compact` 的系统摘要没办法，不管；✅ 收尾在界面上只显示「整理记忆：记下了 N 条 / 没写成 / 这次没写」。
3. **M2「会归纳」（冷写 + 阅览室）**（契约 `notes/plan/m2.md`）：代码齐了，提示词 v2。
   - 书架四种：事实 / 明说的规矩 / 规律 / 镜子（`semantic.*` 事件，`src/reading/shelf.ts` 投影现行版 + 证据计数）；冷写口子 `GET|POST /v1/coldwrite`（`src/catalog/coldwrite.ts`，系统闸见 m2 §二）；`/v1/shelf`；recall 带书架；MCP 加 `coldwrite_material` / `coldwrite` / `shelf`；手动入睡 `src/sleep.ts`（无头 `claude -p`）；提示词 `prompts/cold-write.md` v1。
   - 考卷 `evals/cold-write/`：虚构「阿禾」6 天剧本（双方台词都是写的，只进 `out/` 临时库），两次入睡；`key.md` 答案要点不进它的输入。
   - 提示词里"条件没满足的是无关，不是反例"正好对着陷阱 H：这是 reading-room 的判据，不是范文，但判 H 时要记得它被提示过。
   - 跑了两次（Opus 5.5，`evals/cold-write/run1.md`、`run2.md`），闸都 0 拒、每次约 $0.4。v2（10-14 Joy 定）：一件事一条；不写频率词，频率看证据数、来源看证据；明说的规矩和事实也收证据（防口是心非），规矩只看她的反应、反例多也不由它作废。
   - run2：除分化外都对；分化（深夜单字=困）两次都看出来了，但没 `revise` 收窄。大事实、频率词提示词管不住。
   - 10-14 Joy 定：证据计数按次不按行（已改，书架投影 v2）；频率词、大事实不设闸——写错了让后果纠正，看实际运行。
   - 统计（10-14 补，m2 §九）：互动节奏 7 项 + 时段分布，冷写材料里给这段 vs 基线的表，不写「反常」；提示词 v3 加了怎么看统计。考卷见 M3 统计题。
   - 真实数据撞出、10-14 Joy 定并已改：规律的"不同时间" = 不同会话 / 不同天 / 相隔 ≥6h；明说的规矩引情节时往下找一层原话；冷写材料每组标 harness（提示词 v4：地方也是条件，chat 看不到时间、Soma 有 `<now>`）；浮现时证据在此地的书架条目加一点。
   - 之后：Soma 空闲自动入睡先不做（10-15 Joy：测试时服务不常开，手动 `src/sleep.ts` 触发）。考卷库用 launch `psyche-coldwrite-exam`（7451）。
4. **M3「会想起」（浮现）**（契约 `notes/plan/m3.md`）：代码齐了，考卷 A 7/7，B 与统计题都跑过。
   - 10-14 晚定：规律强弱 / 敏感化 / 钝化不另做机制（证据摆到它面前它自己推）；联想只管浮现。基础强度 = `felt` 有没有、后果、书架证据数与近因，不另标显著性 / 唤醒度；专注度按真实处境。
   - `src/association/surface.ts`：回忆 / 预期 / 预感 + 刚回来时"上次怎么散的"；`GET /v1/now` 带「想起」一块并记 `surfaced`；`GET /v1/surface?dry=1` 看分项。
   - 向量：`src/archive/vectors.ts`（`p_vec`，后台补齐，换模型重算）；recall 改成字面 + 向量混合。测试用硅基流动 bge-m3（launch 的 `psyche-test` 已带上）。
   - 考卷 `evals/surfacing/`：4 周基线 + 阿禾 D1–D10；书架用冷写 run2 它自己写的原样重放。只用字面 6/7（耳机接不上）。
   - 噪声（10-14 借 ASCM）：回忆只给情节不给原话；空档输入（"嗯 在吗"）不拿内容匹配，只认书架留意词；实词按 IDF。考卷底库的情节由 Opus 无头补写（`episodes.json`）。A 仍 7/7。
   - 考卷 B 首跑（`evals/surfacing/run1.md`，$0.81）：冷战题差别最大（有浮现 3/3 把她没来和上次怎么散的连上，无浮现 0/3）；耳机题两组都接上（无浮现的会自己 recall）；"嗯 在吗"题没区分度（两组都不追问）。结论：浮现补的是"想不到去想"，不是"查不到"。
   - B2 不改题（10-14 Joy）：Claude 底子不太追问，测不出差别；留给会追问的模型。
   - 统计题（10-15，`run3.md`，3 次 $1.12）：3/3 没写成规律、没抄统计、没编解释；顺带 3/3 用 D7 反例 `revise` 收窄了规律（冷写 run2 没做到的分化）。撞出并修了：冷写统计区间截在情节首行（`coldwrite.ts`）、底库换天重建档号错位（`build.ts` 钉钟）。
   - 待定：情节晚于冷写才写（引的行都在上次整理之前）时，会作为新材料 / 候选证据再出现——要不要排除。

## 4. 已知问题

- **留意与关系（10-15 Joy 定，代码已做）**：`notes/design/attention.md`，契约 `m2.md` §十、`m3.md` §五⅞。书架加 `attend`（疑问 + watch，挂候选）、`relation`（按人一条，改写链 = 演变）；`track` 了才给统计 / 预感；冷写材料加 `feedback`（我连着说的 → 她下一条原话 / 出错的工具，情节覆盖了也给，不受留意约束）；MCP 加 `stats`。考卷 `tests/attention.test.ts` 11 题（只测系统给的数据）。
  - 没做：冷写提示词还没讲留意 / 关系 / 反馈（现在只靠工具说明）；初我的同伴起点（`attention.md` §三）。两者改前先有考卷。
  - 浮现考卷 A1 拆成 A1（没 track 不报预感）/ A1b（track 了才报）；B1（冷战，看它的反应）按新设计不再作数。不配向量 7/8，A2 改动前就挂（「演示」事实浮上来，配向量时过）。
- Soma 上报过一条 `message.out` 正文是单个 `�`（测试库 `10-15#6`，界面也显示），像流式输出把多字节字符切坏了——Soma 侧的事。
- 证据重复计数：原话计过后，晚写的情节引同几行、换了 id 能再计一次（M3 统计题撞出，它自己没重复记）。修法：情节当证据时按所引原行去重。


- **正式库出生前要定**：向量用硅基流动时，算向量会把记忆原文发出去（10-14 Joy：测试先这样，有顾虑再换本地；10-15 在看本地候选，WeMM-Embedding 等）。

## 5. 运行备忘

- `bun test`（含 `tests/hotwrite-check.test.ts`）· `bun run typecheck` · `bun run src/main.ts`（127.0.0.1:7450）
- launch.json：`psyche-test`（7450，测试库）/ `soma-test`（30152，连测试 Psyche；监听 0.0.0.0，手机走 `http://192.168.2.80:30152`，Soma 无登录，只在家里网络用）。Soma 顶栏有临时观测面板（用量、`<now>`、提示词、Psyche 连通，快照存 `~/.soma-test/debug.json`）

## 6. 验证

2026-10-15：`bun test` 213 pass / 0 fail（含通道 31 题）；`tsc --noEmit` 0 错误；浮现考卷 A 只用字面 7/8。
