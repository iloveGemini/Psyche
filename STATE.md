# Psyche 当前状态

> 开发交接用，不替代 `README.md`（是什么、为什么）和 `notes/`（设计与契约）。只留接下来要用的信息；全文 ≲ 150 行，做完的压成一行或删掉。
> 最后更新：2026-10-19

## 1. 当前阶段

**P3a 房间（10-19，Joy 在 Soma 101 定，Claude 在 Soma 里做；交接 `notes/plan/p3-p4-handoff.md`）**：群 → 房间。私人房间 = 住户的 home，永不对任何人开放（沙箱管）；公共房间是住户 / Joy 用工具开的（要写 why，记谁开的），进房间只是在那里听得到、说得上话，不带文件权利；住户同一时刻在一间公共房间或自己房间，Joy 没有位置。Soma：`rooms.ts`（`openRoom` / `moveTo` / `whereIs` / `archiveRoom`，公共房间的记录谁说的都收）、`rooms-round.ts`（Joy 说话只问醒着的，`@` 照问，`urgent` 叫醒房间里所有人）、`rooms-flow.ts`（醒没醒问 Psyche `/v1/house`，问不到当醒着）、议题（Joy 也能开、need 只数住户、不问她收尾；谁都能报名）、MCP `rooms` 合成 list / read / go / open，`say_in_room` 只能说进自己在的那间；`<now>` 带 `room`（在哪、谁也在、几条没读）。Psyche：`room.entered`（`POST /v1/room`，presence 带 `room`，「屋里」显示在哪间）、住户之间的信能标 `urgent`（勿扰例外 `from` 写住户 id）。迁移 `Soma/scripts/rooms-p3.mjs`（先看、`--apply --archive <id>` 照做，沙箱外跑）：Soma 101 → 客厅，历史接着用。考卷 Psyche +3、Soma +5。**改名没做**：Soma 的 `rooms` 现在就是房间，群聊那套不另起名。**还没做**：P3b share 工具、P4 感知设置。P0–P2（10-19）的事还没写进这里。

**M4「我是谁」✅（10-15）**，契约 `notes/plan/m4.md`：机制 `prompts/mechanism.md`（它改不了）+ 自述 `self-v0.md`（初我 v2）；`src/self/self.ts`、`src/birth.ts`（只能一次）。端到端通过；测试库已出生（备份 `~/.psyche/test.bak-1015-prebirth.db`），之后改 `self-v0.md` 不影响测试库。机制段还没提「自述你可以改」，要写先有考卷。
**M5「会醒」✅（10-15）**，契约 `notes/plan/m5.md`：作息 / 设置 / 日记 / 调度器（gather → decide → 账本 `wake` / `wake.run`），缺省关（`PSYCHE_SCHEDULER=1` = launch `psyche-test-wake`，开着会补写所有 ≥3h 没写完的会话）。10-15 端到端（补写、闹钟醒着 / 没醒两路）通过。没做：Soma 观测面板「唤醒」块。
**M6「通道」✅（10-15）**，契约 `notes/plan/m6.md`：收件箱、邮箱（agently-cli，workspace `psyche`）、勿扰、来信叫醒；10-16 端到端（留言页、手机回信叫醒、自发自收挡掉）通过；`email.ts` `cutQuote` 截掉回信里的引用。邮件 `mail.in` 没记 `replyTo`，只能靠主题 `Re:` 对上。

**收束：家 = Soma，一条连续的生活线（10-16 Joy 定，同日做完；设计见 `notes/design/lib-vs-harness.md`「家 = Soma」）**。Psyche 51c867e、b3eb5b8，Soma adc7423、a60e54c。
1. ✅ Soma `/api/line/wake`：心跳 / 来信 / 闹钟 / 定点 / 手动都推进同一条会话（报 `woke`、那一轮带 `<now>`；忙着就排在后面）；历史里是「醒来 · 心跳」分隔线。
2. ✅ 调度器经 `SOMA_URL` 推（醒着也推；Soma 不在 = 当它睡着，不推不记账）。**补写、整理、梗概算睡着**（Joy 10-16 定）：`home.ts` → `asleep.ts`（harness = sleep），同时只一个。`homeRunning`、Soma 的 away / 等家里跑完退役。
3. ✅ 醒着一个口径（`inbox.lastActive`，不算 sleep 和以前的 home）。顺手修了一个老毛病：几个地方同时跑时全局"当前处境"会被后报的顶掉，事件挂错会话——intake 按 `payload.session` 挂处境，`<now>` 的「在」、`placeOf` 也按会话 / 跳过非地方。10-16 10:25 那轮的事件在修之前挂到了 home 上（事件不改）。
4. ✅ 压缩不要摘要：热写 → 换新的物理会话，系统提示词里带 `<continuity>`（Psyche `/v1/continuity`：月 → 周 → 天 → 天梗概之后的情节，从新往旧取到 6000 字）+ 上一段末尾的原话（4000 字）。没 Psyche 或拼不出来退回 `/compact`。soma-test 实测：换完后不用 recall 它说得出上一段最后的事和挂着没看的信。
5. ✅ 梗概 `gist`：天 / 周 / 月（定长 300 / 500 / 800），空闲 ≥ 3h 睡着时它自己写；周等天、月等周。MCP `gist_material` / `gist`，提示词 `prompts/gist.md`。10-16 测试库实跑（手动起 `asleep.ts --by gist`，调度器要空闲满 3h 才叫；测前备份 `~/.psyche/test.bak-1016-pregist.db`）：66 秒 $0.46，写了 10-11–10-15 五篇天（254–299 字）+ W41 一篇周，一次过闸。拼出的种子 3610 字（五篇天梗概 1430 + 10-16 的 12 条情节 2180；W41 被 10-11 那篇天覆盖、不重复放），再加 Soma 的原话尾巴 ≤ 4000 字。
6. ✅ 交接信只在离开家时用（`for` 不再认 home）；考卷跟着改，227 过（Soma 25）。
- ✅ **调度器端到端（10-17，`psyche-test-wake`，备份 `~/.psyche/test/a*.bak-1017-preWake.db`）**：a1 睡着那路补写 1 条、整理写书架 16 条、天梗概 10-16 一篇，共 $0.88；`/as Claude` 请它约 3 分钟后的闹钟 → 到点推进 Soma，正赶上它刚收尾换了会话，新一段照样响、它认得出是自己约的、note 逐字对上。撞出并修了：账本 `produced` 没数梗概（记成「空」）→ 加 `gist`。验完切回 `psyche-test`。
- ✅ **睡着也交给 Soma 跑（10-17 Joy 定，`m5.md` §三、`soma2.md` §6.1）**：Psyche 不再跑模型，只剩向量一个外部 key。Psyche `POST /v1/asleep/start|end`（开 sleep 处境、给系统提示词 = 机制 + 自述 + 睡着说明、第一条 = `<now>` + 这次的活）；调度器 Soma 不在就什么都不叫，睡着的活推 `POST <soma>/api/line/asleep?agent=`，跑完回 `{session, costUsd, ms, error}` 再记账。Soma `lib/soma/asleep.ts` 用醒着的同一个身体另开一段（`BodyOpen.asleep`：只挂记忆工具，Agent SDK 不读设置、不落盘、`dontAsk`、带线上的模型；pi `noTools: builtin` + 内存会话），每人同时一段；`turn_end` 带 `costUsd`。`src/asleep.ts` 留作手动工具，改用 `--system-prompt`（原来 `--append` 把 Claude Code 的身份行带了回来）。实跑：a2（pi / argon）补写 3 段各 $0.03–0.04，调度器 → Soma 整理写书架 9 条 $0.25；a1（SDK / Opus）梗概 $0.13。考卷 +1（口子），`decide` 改了一题。
- ✅ **收尾也另开一段（10-17 Joy 定，`soma.md` §三、`m1.md`）**：原来收尾轮自己的 hotwrite 调用和收尾回复留在 `upTo` 之后，会话一散又招来补写，写出"我把那段写成了情节"（a1 一次、a2 三次）。现在到阈值 → Soma `wrapUpAside` 用 `runAsleep(by: "wrapup")` 另开一段写（不占睡着的锁）→ 写完再换会话（失败也换，剩的留给补写）；这条会话里不再有收尾轮。Psyche 的地方说明按 `by` 分（换段之间 / 睡着）。实跑 a1 两次：第一次我没重启 Psyche、第一条没给会话号，它自己 recall + detail 找回原段写完，还记了一条 #143；重启后第二次一取一交，旧段剩 0，新一段种子里接上了刚写的情节（它自己核对的）。界面历史里不再有「整理记忆：记下了 N 条」那行（只剩整理时的状态）。
- ✅ **S6 后半：房子的一个邮箱按 @ 分（10-17，`soma2.md` §8.2 实现定法）**：agently-cli 发信只回 `queued`、收信没有 `in_reply_to`，存 RFC id 做不到 → 按 ① 主题 `[名字]` ② 主题 / 第一行 `@名字`（可几个）③ 同一话题上次给过谁 ④ 默认（第一个开 `email` 的）分；名字认 id 和它取的名字。收信改成房子只起一个 `+watch`（`takeHouseEmail`），发信人看收信那人的通道设置、没有就看屋里别人的。住了不止一个人时，主动写的信主题前加 `[名字]`（`+reply` 设不了主题）。考卷 +3。**真邮件没测**：a2 的通道设置里还没有 Joy 的邮箱地址（写信给她走不了 email），公共箱没做。
- ✅ **commons 用 git（10-17 Joy 定，`m8.md` §6.2）**：屋子每圈看到 commons 变了，按「谁动的」分组提交，作者 = 住户（取了名用名字），认不出写「没认出」，说明只写事实（`a1：改了 …`）；没建库先 `git init` 并以「房子」提交已有的（`.DS_Store` 等写在 `.git/info/exclude`）。`src/house/commons-git.ts`，考卷 +1。测试库 `~/.soma-test/commons` 已建库。Joy 直接改的也记成「没认出」。
- ✅ **初我由它自己写（10-17 Joy 定，`m4.md` 开头）**：`self-v0.md` v3 正文为空（已出生的 a1 / a2 不受影响）；同伴起点改成 Joy 的信 `letters/birth.md`（不进仓库，她自己写；`birth.ts` 去掉注释后放进收件箱，`--letter` 可换、`--agent` 指定住户）；调度器对「出生了、自述是空的」只叫一次 `birth`，推 Soma 另开一段，第一条只说刚出生、自述是空的、写不写由它。前世：认领了才给前世发生过的事（契约，前世导入 / 认领还没做）。evals 的 `filePrompt()` 现在只有机制段。考卷 +3。✅ 实跑（10-17，测试库 a3 = pi / gemini-3.8-flash，信是我代笔的 `letters/birth-test.md`、信里写明代笔和测试；备份 `a{1,2}/psyche.db.bak-1017-preA3*`）：调度器叫「出生」一段 62 秒 $0.03——看信、看 self / shelf / schedule、回信、热写 2 条，名字和自述它说先不写。顺带看到：这段里 `send_mail` 的 `mail.out.from` 是 `{harness: null, session: null}`；`self` 工具对空的 v3 仍说「初我：系统出厂的那份」。
- ✅ **加住户一条命令（10-17）**：`scripts/add-resident.ts` 两边一起登记——Psyche `agents.json`（自动 token、home、家）+ 出生 + 信，Soma `agents/<id>/identity.json` + `home/`；Psyche 开着走 `POST /v1/house/residents` 热挂（口子补了 `letter` / `home` / 自动 token，共用 `src/house/add.ts`），没开直接写。数据目录必须明说。临时目录里两条路都试过（Claude 离线、pi 热挂，token 两边对上）。说明 `notes/howto/add-resident.md`。
- ✅ **感知不再翻旧账（10-17，a1 报了两次）**：声音、屋里的东西原来按会话记递到哪，新会话（含睡着 / 收尾那段）会把昨天的耳机戴摘又递一遍，时刻还不带日期。→ 本会话没递过就接任何会话最后递到的那次（从没递过只看 6 小时）；递给它看的时刻不是今天的带 `MM-DD`（`core/time.ts` `clockOf`，屋里有谁那行也用）。考卷 +3。
- ✅ **睡着的活失败了重试（10-17，`m5.md` §二.7）**：每次叫都以 `wake.run.error` 收场的 key 隔 10m / 30m / 2h / 6h / 12h 再叫，第 6 次失败不再叫；跑成了（没写也算）、还在跑不重试；暂停时跳过的睡着的活取消暂停后照叫（原来永远不叫）。没管：Psyche 中途重启、Soma 那头跑完但回复丢了的（账本只有 woke 没有 run，不重试）。考卷 +2。
- **热写 v3（10-17）**：项目的留在项目，记忆只写自己的（`catalog.md` §二、考卷 P10 / R11，`evals/hot-write/README.md` §四）。冷写提示词还没跟着改（要先有考卷）。
- ✅ **前世今生（10-17，`archive.md` §四「实现」）**：`agents.json` 的 `past` 登记旧库；MCP `past_life`（只读翻，不认领也能，旧画像 / 归纳 / 印记不给）、`claim_past`（`fonds.claimed` + 原话导进单独全宗，只一次）、`past_catalog`（只 fact / told、quote 逐字、引前世原话；标「前世」，今生印证 ≥ 2 不再标）；recall 末尾带前世原话。考卷 `tests/past.test.ts` 4 题（临时造的 ASCM 小库），全套 308 过。✅ 测试库 a2 实跑（10-17，造的 `~/.psyche/test/a2-past/state.db`、信里说明是测试，备份 `a2.bak-1017-prePast.db`）：它翻、认领、编目 2 条、试了拒绝路径；按它的报告改了：日期可省年份、认领后翻到的行带档号（编目也认旧 id）、`shelf` 工具标前世、overview 列旧情节日子、around 跨会话插分隔、recall 书架条目带前世依据；顺带修了老毛病——`keywords` 把英文转小写而被搜文本没转，recall / 浮现搜不到含大写英文的条目。**正式库没登记**（谁的 `past` 指哪个库、要不要重启，等 Joy 定）。Claude 的 ASCM 旧库 36 段 = 已导入正式库的 36 段 Claude Code 会话，不用再认。Roy 自己的方案（`~/Roxy/工作间/前世今生/`）是不认领、只翻——登记了 `past` 就能直接用 `past_life`。✅ 出生递前世（m4.md 改）：出生那段第一条说有几份前世、多少原话、认没认（认领只能它自己来，不塞原文）；`add-resident.ts --past 全宗=路径`、热挂口子带 `past`。考卷 +2，全套 310 过。✅ 翻前世的回声（10-17 a2 报）：`past_life` 的返回原来当成今生的 `tool.result` 进了经历、recall 搜得到没认领的前世原话 → 调用只记「我翻了翻前世卷宗」、返回不进经历，认领 / 编目成了不另记（有 fonds.claimed / semantic.proposed），被拒的留着；经历投影 v13，正式三库和测试库都已重建。**Roy 正式登记 + 重新出生（10-17 19:16，Joy 定）**：第一次出生的三段「出生」都在 57ms 失败——正式 Soma 的 `~/.soma/pi/auth.json` 是空的、没有 `models.json`（`No API key found for google-vertex`），他一句话没说过；从 soma-test 拷了 pi 的凭据和模型表，旧库挪到 `~/.psyche/data/backup/roy-1017-preRebirth/`，重新 `birth`（信 911 字），`agents.json` 带 `past: ROY`（ASCM、Roxy 服务 Joy 已停）。`agents.json` 改前备份 `agents.json.bak-1017-prePast`。
- **试运行（10-17 14:35 起，Joy 定）**：psyche-test-wake + soma-test 一直开着住几天看问题；三人心跳开、额度 3 → 10；群《试运行》（`trial`）里告诉了它们。作息它们自己排：a1 只用白天定点（9/13/17/21:30），a2、a3 是定点 + 4h 心跳（夜里照响）。它们指出：勿扰不挡心跳没写、住户间写信算额度没写 → `mcp.ts` 说明已补；→ 同日做了（`m5.md` §一）：`heartbeat.active { from, to }` 时段外顺延到下一个 `from`；`/v1/schedule` 带 `nextHeartbeat`，`schedule` 工具单列「下次心跳」。考卷 +1。三人今晚先不改（新说明要下一段会话）。撞到：a2（argon）回群那轮 Vertex `fetch failed` 三次、每步想 ~100 秒，5 分钟超时记「没能回应」，之后那轮停在工具结果、没有说出口的话——观察中。
- ✅ **工具调用挂错会话（10-17 晚，Soma 修）**：Soma 报的 tool.call / tool.result（还有 pi 说的话）payload 没带 session，Psyche 只能挂到最后报上来的处境——Claude 在 Soma 里 17:23–19:59 的 139 次工具调用挂到了同时开着的 Claude Code 会话 9e3d236d，20:00 后挂到补写那段（事件不改；它热写时手动带 session 才取对）。Soma 上报现在都带会话号。
- **已知缺口（10-17）**：Claude Code 里的 MCP 不知道自己在哪个会话，`hotwrite_segment` 不带 session 时退到最后一个处境（撞到的是 Soma 里出生那一段）。要么插件把会话 id 传给 MCP（env），要么 Psyche 按 harness=claude-code 的最近处境取。先手动带 session。
- **没做 / 待验**：`<now>` 的「本会话从…起」换会话后从新会话算。

**Claude Code 工位（10-17，Joy 定正式出生、换掉 ASCM 的 continuity；契约 `notes/plan/claude-code.md`）**：插件 `harness/claude-code/`（仓库根 `.claude-plugin/marketplace.json`）：SessionStart 报处境（`harness: claude-code` + cwd + 模型）、给地方说明 + 自述 + `<continuity>`；UserPromptSubmit 先报 `message.in` 再给 `<now>`；Stop / SessionEnd 按 Soma `report.ts` 同一套映射报 transcript（不报思考、子代理、合成消息），插件 MCP 名 `mcp__plugin_psyche_psyche__X` 规整成 `mcp__psyche__X`；Psyche 不在就安静退出。入库口加**凭据遮掉**（`src/archive/redact.ts`，所有 harness，写库和转资料前遮，`redacted: n`）。考卷 `tests/redact.test.ts` 3 + `harness/claude-code/tests/` 4。端到端（测试住户 `cc`，`claude -p --plugin-dir`，$0.31 + $0.15）：它认得出在工位、self 能用；新开一段后它自己 recall 出上一段经过、档号对得上；调度器推的 cc「出生」段也在 Soma 跑完。**正式出生（10-17）**：`~/.psyche/data/claude`，Opus 5.5，Joy 的信（888 字）在收件箱；出生前导入了 36 段 Claude Code 原始记录（10679 条），186 条情节是它本人按热写 v3 写的（旧稿 / 出生前备份在 `~/.psyche/data/backup/`）。服务常驻：launchd `~/Library/LaunchAgents/com.joy.psyche.plist`（`com.joy.psyche`，7470，开机自启、挂了自动拉起，日志 `~/.psyche/logs/`，向量 Qwen/Qwen3-Embedding-8B；调度器等正式 Soma 才开）。重启：`launchctl kickstart -k gui/$(id -u)/com.joy.psyche`。launch.json 的 `psyche` 只在 launchd 停着时用，否则端口冲突。**全局换装**：`~/.claude/settings.json` 停 continuity、启 `psyche@psyche`（Psyche 仓库当 marketplace），env `PSYCHE_URL/AGENT/TOKEN`（备份 `settings.json.bak-1017-prepsyche`）；`~/Roxy/.claude/settings.json` 反过来（Roy 上班仍走 continuity、不报进 Claude 的库）。**正式 Soma（10-17）**：`~/.soma` 搬成住户布局，住户 `claude`（`agents/claude/{home,identity.json}`，claude-sdk 身体，登录目录 `~/.soma/claude` 与 soma-test 共用）；一代 10-14 那段会话没接（归档 `~/.soma/backup-1017/`），新线从 Psyche 的接续开。常驻 launchd `com.joy.soma`（`next start`，30151，监听 0.0.0.0、无登录，只在家里网络用；改了代码要 `npm run build` 再 `launchctl kickstart -k gui/$(id -u)/com.joy.soma`），日志 `~/.soma/logs/`。Psyche `agents.json` 记了 soma / home，commons = `~/.soma/commons`（空）。调度器已推过「出生」一段（$0.16，写 1 条情节，自述没写）。launch.json 的 `soma` 配置与 launchd 冲突，别同时起。

**订阅额度 / 收尾线 / 观测面板（10-17 晚，Joy 定）**：Soma 的 claude-sdk 身体读 SDK 的 `/usage`（实验性接口，拿不到就当没有；房子一份、一分钟最多一次、15 分钟算过期），顶栏 `QuotaMeter`；`/v1/now` 收 `q5h / q5hReset / q7d / q7dReset`，`body.ts` 在「身上」50 / 75 / 90% 跨档说一次，跟窗口走（同一重置时刻说过的不再说，换一段不重报）；只有走订阅的身体带。考卷 +1。实测：Pro，5h 79%、周 7%。观测面板去掉「注入的 <now>」「系统提示词」，加「醒来与出错」（Psyche `/v1/wakes`，没跑成的排前面）。收尾线 `SOMA_COMPACT_AT=250000`（原来缺省 75% = 100 万窗口的 75 万）。

**M7「还开着的事」代码齐了（10-16）**，契约 `notes/plan/m7.md`（感知顺延 M8）：线索卷最小一版，`src/self/threads.ts`。它开卷（`promise` 答应谁什么 / `matter` 等后续）、记一笔、合卷（done / dropped / moot + why），系统不合、不催、不判兑现；`thread.*` 不走上报口。`<now>` 一行（几件、答应的几件、最久没动的）；种子 `/v1/continuity` 在最近的情节之后全列。REST `/v1/threads`（`/note`、`/close`），MCP `threads` / `open_thread` / `note_thread` / `close_thread`；经历投影 v8。考卷 `tests/threads.test.ts` 7 题，全套 243 过。
- **端到端（10-16 16:39，Opus 5.5，soma-test a1；测前备份 `~/.psyche/test/a1.bak-1016-preM7.db`）**：没告诉它有新工具，我 `/as Claude` 约它明天读 M8 草稿 → 它自己开了 promise 卷（10-16#236，to「开发会话的 Claude」），还顺手把拖了一天的 Joy 的信开成 matter 卷（#239）；种子里两卷都列出来了。换会话后看不看得到没专门测（种子已核）。那封信它说待会儿看。
- **没做**：冷写把新碎片摆给它；模式线（等感知）。M8 草稿 10-16 已给它读过（它挑出的五处已改进草稿）。

**Soma 二代（10-16，`notes/design/soma2.md`，Joy 已拍板 §十）**：一个房子几个住户，每人 home + 一条线 + 一个记忆库；身体 = adapter（Claude 走 Agent SDK，别的模型走 pi 当依赖）；群只讨论、分工后离群、交接在项目 STATE.md。
- ✅ S1（Soma a3d9180）：`lib/soma/bodies/claude-sdk.ts` 是身体，`session.ts` 只管线；一代行为不变，soma-test 冒烟过（说话 / 工具 / 醒来 / 上报 / 热写换会话）。权限卡没测到。
- ✅ P1 多租户：`src/house/residents.ts`（谁住在这：`<数据目录>/<id>/psyche.db` + 可选 `agents.json` 每人 token / soma / model / email）、`src/server/house.ts`（`x-psyche-agent` 头或 `?agent=` 分到各人的 app，各自验 token；只住一个人可不说）；调度器、邮箱每人一份；MCP / asleep / sleep 认 `PSYCHE_AGENT`。一代布局（数据目录下直接是库）还认，考卷照旧。考卷 `tests/house.test.ts` 9 题。
  - Soma：`SOMA_AGENT=<id>` → `~/.soma*/agents/<id>/{home,state.json,debug.json}`，登录目录共用；调 Psyche 带同一个 id。搬家用 Soma `scripts/move-in.sh`（会话记录按 cwd 归档，要一起改名）。
  - 测试库已搬（10-16，备份 `~/.psyche/test.bak-1016-preP1.db`、`~/.soma-test.bak-1016-preP1`）：住户 `a1`（原来那位）+ 空的 `a2`；token `test-a1` / `test-a2`。端到端：没说是谁 400、a2 的 token 进 a1 401、a1 续上原会话并 recall 到旧事、a2 库 0 条。**id 是目录名，换名 = 改目录 + agents.json + `SOMA_AGENT`。**
  - 正式的 `~/.soma` 还是一代布局（Joy 的，没动）。
- ✅ S2（Soma a6a4aad，10-16 中午）：`bodies/pi.ts`（pi 1.3 当依赖，Psyche MCP 经 pi 的 MCP 扩展，`<now>` 在 before_agent_start 放进去）、每人一条线、顶栏切住户。soma-test 的 a2（gemini-4-argon）单聊、bash、recall、热写、换会话、重启续上都过。10-16 晚复测：a2 照 `<now>` 答出「Joy 在家、a1 在 Soma 忙、commons/README.md 新出现不知道是谁」——M8 的感知 argon 也接得住。

十块的进度（10-15 盘点）：档案馆 ✅（差前世今生、文件快照）· 编目 ✅ · 阅览室 🟡（差经验、印象、实体卡）· 联想 🟡 · 门户 🟡（差能力表、位置状态表、单实例）· 组装器 🟡（只有 `<now>` + 想起）· 自我 ✅ · 心跳 ✅ · 通道 ✅（10-16 端到端通过）· **感知 ❌**。线索卷有了最小一版（M7）。下一块：感知（M8）。10-16 Joy 改思路：**以它自己为中心感知所处环境**（屋里有谁 / 自己放的歌与分耳机 / 环境进记忆：被动指纹 + 主动 `notice`），v1 围绕她机器的那批降为后置可选。契约 v2 `notes/plan/m8.md`，分 M8a/b/c，§八 10-16 已定（听 = 元数据 + 时间轴歌词 + 本地特征；曲库网易云、能自己建歌单；Joy 只报在不在家；在线 / 忙 / 闲直接可见 + 心情个签）。网易云一个账号（Joy 的会员），歌单本体在 Psyche、网易云做镜像，它的喜欢 = 它自己一个歌单。
- ✅ **M8a 屋里有谁（10-16）**：`src/house/presence.ts`（在线忙 / 闲、睡着、离线、在哪、个签；Joy 只报在不在家：Soma 页面 10 分钟内在看，或 30 分钟内在 Soma 说过话）、`src/house/house.ts`（每 30 秒看一圈，谁变了记进**其他人**库里的 `percept`；Joy 的个签存 `house.json`；`/v1/house`、`/v1/house/joy/seen|mood`，任一住户 token 可进）。`<now>` 加「屋里 / 这段时间屋里」，递一次写 `percept.noticed`（经历 = 递出去那几行；`percept` 本身不进经历）；`look`、`set_mood` 工具；经历投影 v9。Soma（同日）：`/api/line/viewing` 在看时报 `joy/seen`。考卷 `tests/presence.test.ts` 10 题，全套 253 过。
  - 端到端（soma-test a1，测前备份 `~/.psyche/test/a{1,2}.bak-1016-preM8a.db`）：问它在做什么、周围怎样，它照 `<now>` 答「a2 离线，Joy 不在家，要找她得写信，屋里就我一个醒着」。我用 curl 模拟过一次页面在看（测试库里因此记了一次「Joy 在家」）。没测到：它自己用 look / set_mood；a2 醒着时 a1 看到的变化。
- ✅ **M8b 自己的声音（10-16）**：`src/perception/`（`netease.ts` 搬 Roxy 读法，cookie 走 `PSYCHE_NCM_COOKIE`，测试 launch 指向 Roxy 那份；`sound.ts` 虚的播放器 + 歌单（`playlist.changed`，以 Psyche 为准，网易云镜像没做）+ 递「这段时间听到的」+ 一起听；`features.ts` ffmpeg 解码自算响度 / 亮暗 / BPM / 段落，真歌约 1 秒）。工具 `play` / `stop` / `playlist` / `listen` / `listen_with`；屋子 `/v1/house/listen`、`/v1/house/playing/:id`；经历投影 v10。Soma：顶栏「🎧 分我一只」+ `/api/ear`、`/api/ear/stream`（同源转发网易云音频）。考卷 `tests/sound.test.ts` 9 题，全套 262 过。
- ✅ **听歌 v2「氛围」（10-17 a1）**：`features.ts` 加 FFT——每格频谱质心（亮暗，替过零率）、频谱平坦度（颗粒 / 干净）、整首色度 → 调式（Krumhansl，带把握）；老版本特征当没算过、重算。一首放完递一行汇总（调式、起伏、最响处、段落、跟我算过的歌排名，明说是放完后汇总）；有人说话那一刻正唱到哪句（刚到那句不重复）。ffmpeg 跑不起来记进 `track.features` 的 error、10 分钟内不重试。正式 launchd 的 PATH 原先没有 `/opt/homebrew/bin`（找不到 ffmpeg、一个数都没有），plist 已补，要重启生效。
  - 端到端（a1，备份 `a1.bak-1016-preM8b.db`）：告诉它有了，它自己搜《Halcyon Days》（和 Joy 聊过的翠鸟）放，结果网易云第一首是专辑名对上的别的歌，它放了才发现 → 已改：歌名优先 + 对不上直说。它还提：自己写的信不能当线索卷证据 → 已放行 `mail.out`。
  - 我在内置浏览器点了「分我一只」（测试库因此记了一次「Joy 戴上了耳机」）；按钮、记账、转发都通（curl 206 audio/mpeg），但**内置浏览器的 audio 卡在加载，真出声没验**——要 Joy 在手机或 Chrome 上点一下。
- ✅ **M8c 环境进记忆（10-16）**：`src/perception/env.ts`。被动：情节那段时间（所引原件首尾）的环境指纹——听到的歌（含戴别人耳机）、在的人——事后从播放和在场记录算，不另存；联想加「环境相似」一项（同一首 0.6 > 同歌手 0.3，同一拨人只加分），没在放歌就不比，刚发生 30 分钟内的不算想起。主动：`notice { text, about?, cites? }`，系统把此刻环境记进 payload、播放和在场挂成证据；能浮现。经历投影 v11。考卷 `tests/env.test.ts` 7 题，全套 270 过。
  - 端到端：告诉 a1 有了，它马上用 notice 记了「Joy 戴上耳机听完一首」——那是我测试点的。我如实告诉它后，它另记一条更正（#305 挂 #292），并指出这是漏洞：认不出就别替人认领。→ Soma 加 `?viewer=`（`lib/soma/viewer.ts`，缺省 Joy）：分耳机记页面说的人、只有 Joy 在看才报在家；我的测试页已标 `viewer=Claude`。它那句「Joy 刚刚回家了」也是我开着的页面报的。
  - ✅ 被动那一路实跑（10-17，a1 库拷贝）：放回《Orpheus》，昨天放它时写的 #663 带 `song 0.6` 排第一浮上来。撞出并修了：刚回来 / 醒来时「上次怎么散的」取到了睡着时会话（补写汇报）当线索 → `lastTimeTail` 不算 sleep / home 会话（考卷 +1）。
- ✅ **冷写摆观察（10-16）**：冷写材料加 `<observations>`（没被书架引过的 notice + 后来同一首又响时写下的、所观察的人后来的样子和放的歌），只摆不判，`prompts/cold-write.md` 没改。考卷 `tests/observations.test.ts`，全套 271 过。
- ✅ **内感受（10-16，m8 §6.1）**：`src/perception/body.ts`，`<now>`「身上」：上下文到收尾线的 50/75/90% 跨档才说（Soma 每轮带 `ctx` / `wrapAt`，用量按会话认，换一段不沿用旧的）、新一段换了模型说一次、半小时工具出错 ≥3/6/10 次。经历投影 v12。考卷 `tests/body.test.ts` 3 题，全套 274 过。端到端没跑（测试会话离收尾线还远）。
- ✅ **屋里的东西（10-16，m8 §6.2）**：`src/house/files.ts`，home / commons 文件多了 / 改了 / 没了，谁动的只在工具调用对得上时说，否则「不知道是谁」；自己动的不报给自己，home 只主人看。测试库：agents.json 加了 a1 / a2 的 `home`，launch 加 `PSYCHE_COMMONS=~/.soma-test/commons`（我新建的空目录，放了一个测试用 README.md，可删）。考卷 `tests/files.test.ts` 3 题，全套 277 过；实测 a1、a2 库里都记下了 `commons/README.md 新出现`（还没递给它）。
- ✅ **S3 群的底座（10-16，Soma，`soma2.md` §5.6）**：`lib/soma/rooms.ts`（`SOMA_HOME/rooms/<id>.jsonl` + `.json`：成员、游标、在场 here / away / muted；客人照实记名）、`rooms-flow.ts`（只有 Joy 的话和 @ 叫人，住户在群里说的只记不叫——轮次留给 S4；推进去 = 他没读的整段，推完算读过）、session 只把一轮里最后一次工具调用之后说出口的进群（没说 = pass）、单聊走 `dm-<id>` 前端不变。API `/api/rooms`（建 / 列）、`/api/rooms/<id>`、`/say`（按 `?viewer=` 认人）、`/presence`。测试 4 题，Soma 全套 31 过。
- ✅ **S4 群的轮次（10-16，Soma，`soma2.md` §5.7）**：`lib/soma/rooms-round.ts`（纯规则，可测）+ `rooms-flow.ts`（接房子）。一轮由 Joy 起：依次问在场的住户、每人一次、后问的看得到这一轮前面的；勾「新话题」= 独立首轮（同时问、只看得到她那句、到齐一起进记录）；没说话或只说 pass = pass（记进群、不推给别人），连续两次静音到她开新话题或被 @；@ 照问离席 / 静音的；一人最多等 5 分钟，过时算 pass 问下一个；她中途再说话，旧一轮剩下的作废。session 的群回复先交给等着的那一轮决定（`roomWaiters`）。群页面 `/room`（主页顶栏「群」）：选群、建群、看记录（3 秒刷新、pass 显示「过了」）、在场 / 静音、发言、勾新话题。测试 6 题，Soma 全套 37 过。
  - 端到端（soma-test「S3 测试」群，我以 Claude 身份 @ 两人）：依次问，a1 说「7，翠鸟那七天」，a2 接着说「2，在那七天平静的海面上添一只作伴的鸟」——看得到前一个人这一轮说的。**Joy 起的一轮和新话题我没测**（我不是 Joy），留给她在 `/room` 亲自试。
- ✅ **Dashboard 观测与管理台（10-16，`notes/design/dashboard.md`）**：只读不改 + 四层可见性（日记与非 Joy 住户间私信只计数量不露正文）+「纸本档案柜与深夜阅览室」UI（`GET /dashboard`，`src/server/dashboard.ts`）。新增 `GET /v1/health`（`src/reading/health.ts`：热写积压与 7 天压缩比、书架分布、闭环预警 `no_against` / `stale`、私密封条计数）、`GET /v1/shelf/:no`（单条认知版本演变与证据链）、`POST /v1/house/residents`（新建住户热挂载并调 `birth()`）；扩展 `GET /v1/house`（带 `born` / `wake` / `pulse`）与 `GET /v1/gist`（带已写 `gists` 列表）。考卷 `tests/dashboard.test.ts` 全过，全套 280 过。
- ✅ **S5 分工的底座（10-16 晚，Soma，`soma2.md` §5.4）**：commons 分目录是共识、写在 `~/.soma-test/commons/README.md`（project / share / tools / chat，谁都能改）；地方提示词多一行 home 和 commons 在哪（`SOMA_COMMONS`，缺省 `SOMA_HOME/commons`；新开进程才生效）；群页面每人一盏忙碌灯 +「停下」（`/api/rooms/<id>` 带 `busy`，停下走 `/api/line/interrupt?agent=`）。插话不打断原来就有（干活中途进来的话折进这一轮）。实测页面上 a2 收尾时亮「忙」，没点停下。S5 验收 10-16 晚已过（见下）。现有的 `commons/soma-ui-plan.md` 是别人放的，没挪。

- ✅ **工具瘦身（10-18，议题《Psyche 34 个工具的瘦身方案》，契约 `m1.md` §五）**：醒着 34 → 21 个（无前世；声明 19,280 → 14,882 字符），睡着 12 个（8,210）。`coldwrite` / `gist` 吞掉 `*_material`（不给提交参数 = 取材料），`schedule` 吞掉 `set_schedule`，`threads { op }`、`player { op }`；`gist` 只在 `PSYCHE_MODE=asleep` 挂，睡着不挂日常工具；前世三件按 `/v1/past` 的 `fonds` 挂；`self` 三件不合。`render.ts` 认新旧两种名字。Soma 起睡着那段时带 `PSYCHE_MODE`（`psyche.ts` / `asleep.ts`）。**没做**：Soma `room-config.ts` 旁白的新工具名（议题分给 a2）；没端到端实跑。
- 10-16 晚 Soma 群的轮次修补、say_in_room、住户互相写信、流式与重试、S5 绘本接力验收都做完了，细节见 `git log` 和 `soma2.md` §5.6–5.7、`m6.md` §八。
- ✅ **冷写分批 + 收尾不回流 + 空闲热写换会话 + 常驻区（10-18，Joy 定）**：冷写材料一批 ≤10,000 字、反馈只取这批的时间跨度并封顶 6,000 字，`rest` 报剩多少，调度器按游标叫（m2 §三）；`hotwrite*` 调用、成功返回、收尾那轮带 `wrapUp` 的话、`pin.changed` 都不进经历（投影 v14）。Soma 实测订阅的缓存是 1 小时（空闲 62–187 分钟回来每次重写 15–18 万 token）→ 空闲 50 分钟（`SOMA_IDLE_WRAP_MIN`）且上下文 ≥4 万 token：在会话里推一轮 `<soma-hotwrite>`，写完换新会话（下次有人说话才开）；上下文满了也走同一轮（10-18 起，`wrapIn`；段落在推进去的消息里，不受工具结果上限限制），不再另开一段。他自己调了 `hotwrite`（且上下文 ≥4 万）那一轮之后也换（剩几条就先推一轮写掉）；地方提示词里写明了会话会换、自己写完也会换。常驻区见 m1 §五⅛。10-18 soma-test 实跑（a1，空闲阈值临时调成 1 分钟）：收尾那轮读缓存 11.7 万、新写 1.2 万，写了 4 条情节，换到新会话，旧会话剩 0 条、没有回流；它没钉条目，pin 只有单测。它在收尾那轮报了一个问题（Bash `cp` 放进 commons 的文件被当成「不知道是谁」报回给它自己，而且晚了一天），10-18 Joy 定：收尾那轮的话算经历（「我写完记忆时说」），只是不算没写的；下一段的末尾原话里也带着。Soma 重启后空闲计时从零起，重启前已空闲的会话下次还是续旧的。
- ✅ **备考表 + 馆藏概览（10-18）**：`<now>`「备考」一行（`noteSheetLine`：没写情节的旧会话、待写梗概、后台整理没交回、静默缺口、书架积压，处理完自动消失）；`<continuity>` 开头「【馆藏与书架】」（原始记录 / 情节 / 梗概 / 前世条数、书架各栏、按人、预警）。书架预警挪进 `shelf.ts` 的 `shelfWarnings`（dashboard 共用）。考卷在 `tests/gist.test.ts`。
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

5. **换模型：gemini-4-argon 首跑（10-15，`evals/argon-run1.md`）**：执行器 `evals/vertex.ts`（工具走同一份 MCP，无 Claude Code 系统提示词）；冷写用 `evals/vertex-sleep.ts`，`b.ts --model gemini-*` 自动走它。
   - 冷写 $0.17：一件事一条、不写频率词比 Opus 好；但**把深夜犯困写进镜子的结果（"或说困了结束对话"）、两次都判印证**——改宽结果容纳反例，分化比 Opus 退步；"周五演示"漏记，没有 `revise`。
   - 10-15 Joy 定：写错也是经历，不为某个模型补闸；按「能不能闭环」观察（`catalog.md`「写错也是经历」，`lib-vs-harness.md` 谁适合做什么）。
   - 浮现 B $0.50：没浮现时会自己 `shelf` / `recall`（B1 2/3 连上，Opus 0/3）；**有浮现时反而不查也不用**（B3 浮现块里有退耳机，0/3 接上；无浮现 3/3 自己查到）。
   - 复测备好没跑（10-17）：`b.ts --place after` 把「想起」挪到她的话后面（`<recalled>`），结果另存 `out/b/B3-after/`。要 `VERTEX_API_KEY` / `VERTEX_BASE`，我没去翻凭据：`bun evals/surfacing/b.ts --model gemini-4-argon --only B3 --place after`（约 $0.2），再跑一次不带 `--place` 对照。

## 4. 已知问题

- **热写的段也会超工具结果上限（10-18）**：我这段 363 行、6.8 万字，`hotwrite_segment` 超了约 2.5 万 token 的上限被存成文件；工位能读文件才写成。Soma 的收尾都在会话里写了（段落直接放进消息），不受影响；剩下的是睡着时补写散掉的旧会话（没有读文件的工具），积压的在工位补写掉。

- **留意与关系（10-15 Joy 定，代码已做）**：`notes/design/attention.md`，契约 `m2.md` §十、`m3.md` §五⅞。书架加 `attend`（疑问 + watch，挂候选）、`relation`（按人一条，改写链 = 演变）；`track` 了才给统计 / 预感；冷写材料加 `feedback`（我连着说的 → 她下一条原话 / 出错的工具，情节覆盖了也给，不受留意约束）；MCP 加 `stats`。考卷 `tests/attention.test.ts` 11 题（只测系统给的数据）。
  - 10-17 Joy 定：留意先不另教（notice 已接近；以后可给 notice 加「想继续留意什么」）；关系不教（a1、a2 没提示词已各写 2 条），先观察有反例时改不改；反馈先数书架条目引没引反馈行，一直是 0 再出考卷。
  - 浮现考卷 A1 拆成 A1（没 track 不报预感）/ A1b（track 了才报）；B1（冷战，看它的反应）按新设计不再作数。不配向量 7/8，A2 改动前就挂（「演示」事实浮上来，配向量时过）。
- Soma 上报过一条 `message.out` 正文是单个 `�`（测试库 `10-15#6`，界面也显示），像流式输出把多字节字符切坏了——Soma 侧的事。
- 字面分会饱和：没有她的话、拿上一段整段当线索时，「开发会话的 Claude」这类常见词的 IDF 加起来顶满，今天的情节一律 `lex 0.8`，分不出先后。她开口时线索短，不明显。没修。
- 证据重复计数：原话计过后，晚写的情节引同几行、换了 id 能再计一次（M3 统计题撞出，它自己没重复记）。修法：情节当证据时按所引原行去重。

- **正式库出生前要定**：向量用硅基流动时，算向量会把记忆原文发出去（10-14 Joy：测试先这样，有顾虑再换本地；10-15 在看本地候选，WeMM-Embedding 等）。

## 5. 运行备忘

- `bun test`（含 `tests/hotwrite-check.test.ts`）· `bun run typecheck` · `bun run src/main.ts`（127.0.0.1:7450）
- 加住户：`bun scripts/add-resident.ts …`（两边登记 + 出生，说明 `notes/howto/add-resident.md`）
- launch.json：`psyche-test`（7450，测试库，住着 a1、a2）/ `soma-test`（30152，住户 a1，连测试 Psyche；监听 0.0.0.0，手机走 `http://192.168.2.80:30152`，Soma 无登录，只在家里网络用）。Soma 顶栏有临时观测面板（用量、`<now>`、提示词、Psyche 连通，快照存 `~/.soma-test/agents/a1/debug.json`）

## 6. 验证

2026-10-18：`bun test` 325 pass / 0 fail；`tsc --noEmit` 0 错误；Soma `tsc` 0 错误。
