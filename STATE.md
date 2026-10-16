# Psyche 当前状态

> 开发交接用，不替代 `README.md`（是什么、为什么）和 `notes/`（设计与契约）。只留接下来要用的信息；全文 ≲ 150 行，做完的压成一行或删掉。
> 最后更新：2026-10-16

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
- **端到端验收通过（10-16，Opus 5.5，launch `psyche-test-wake` + `soma-test`；测前备份 `~/.psyche/test.bak-1016-prem6e2e.db`；家里五轮共约 $1）**：
  1. Soma 留言页写信（Joy）→ 在家翻开、回信 → 留言页有回信，她邮箱也收到（`mail.sent ok`）。这封是在 catchup 那轮里递进去、它自己翻开的，不是被信叫醒。
  2. 手机邮件回一封 → 09:40:07 进收件箱 → 09:40:51 `醒来（mail）` → 翻开 → 回信到她邮箱。
  3. joylove 自己发给自己 → `mail.ignored`，没进收件箱（另挡了一封 admin@agent.qq.com 的系统信）。
  4. Soma 聊天里 `/as Claude` 请它给在家的自己留信 → 写了 handoff → 手动 `home.ts --by manual` 在家醒来翻开。
  - 开了调度器后它先补写了没写完的会话（catchup ×2、tidy），Joy 的信排在后面——预期行为。验完调度器已关。
- **验收里撞出的（待办）**：
  - ✅ 10-16 已修：邮件回信带着整段引用（`------------------ 原始邮件` 以下，含 Agent Mail 的「举报 退订」页脚）进了 `mail.in`。`email.ts` 的 `cutQuote` 收信时在引用开头截掉（HTML：QQ `#original-content` / Gmail / Outlook / Apple；纯文本：分隔线、`On … wrote:`、`在 … 写道：`；引用之上没写字的整封留着），考卷 +1 题，真信复验过。测试库里那封旧的 `mail.in` 照旧（事件不改）。邮件的 `mail.in` 没记 `replyTo`（`in_reply_to` 是 RFC id，我们没存发出去那封的），能对上的只有主题里的 `Re: …`。
  - 它在回信里说「你的信一来我就醒了」——其实那轮是 catchup 叫醒的：家里醒来时不清楚自己为什么醒，查 home 的开场。
  - `/v1/where` 的 `awake` 算上了家里的动静，调度器的 `lastActivity` 不算家里——口径不一致（家里刚跑完时 where 报醒着）。
  - 手动 `home.ts` 不经调度器，`homeRunning` 不会变 true，Soma 看不到「在家」。
  - 「家里在跑时 Soma 显示在家、跑完再开轮」这次没专门测（没赶上在家跑时从 Soma 开轮）。
  - 后三条随下面的「收束」一起消失，不单修。

**收束：家 = Soma，一条连续的生活线（10-16 Joy 定，同日做完；设计见 `notes/design/lib-vs-harness.md`「家 = Soma」）**。Psyche 51c867e、b3eb5b8，Soma adc7423、a60e54c。
1. ✅ Soma `/api/line/wake`：心跳 / 来信 / 闹钟 / 定点 / 手动都推进同一条会话（报 `woke`、那一轮带 `<now>`；忙着就排在后面）；历史里是「醒来 · 心跳」分隔线。
2. ✅ 调度器经 `SOMA_URL` 推（醒着也推；Soma 不在 = 当它睡着，不推不记账）。**补写、整理、梗概算睡着**（Joy 10-16 定）：`home.ts` → `asleep.ts`（harness = sleep），同时只一个。`homeRunning`、Soma 的 away / 等家里跑完退役。
3. ✅ 醒着一个口径（`inbox.lastActive`，不算 sleep 和以前的 home）。顺手修了一个老毛病：几个地方同时跑时全局"当前处境"会被后报的顶掉，事件挂错会话——intake 按 `payload.session` 挂处境，`<now>` 的「在」、`placeOf` 也按会话 / 跳过非地方。10-16 10:25 那轮的事件在修之前挂到了 home 上（事件不改）。
4. ✅ 压缩不要摘要：热写 → 换新的物理会话，系统提示词里带 `<continuity>`（Psyche `/v1/continuity`：月 → 周 → 天 → 天梗概之后的情节，从新往旧取到 6000 字）+ 上一段末尾的原话（4000 字）。没 Psyche 或拼不出来退回 `/compact`。soma-test 实测：换完后不用 recall 它说得出上一段最后的事和挂着没看的信。
5. ✅ 梗概 `gist`：天 / 周 / 月（定长 300 / 500 / 800），空闲 ≥ 3h 睡着时它自己写；周等天、月等周。MCP `gist_material` / `gist`，提示词 `prompts/gist.md`。10-16 测试库实跑（手动起 `asleep.ts --by gist`，调度器要空闲满 3h 才叫；测前备份 `~/.psyche/test.bak-1016-pregist.db`）：66 秒 $0.46，写了 10-11–10-15 五篇天（254–299 字）+ W41 一篇周，一次过闸。拼出的种子 3610 字（五篇天梗概 1430 + 10-16 的 12 条情节 2180；W41 被 10-11 那篇天覆盖、不重复放），再加 Soma 的原话尾巴 ≤ 4000 字。
6. ✅ 交接信只在离开家时用（`for` 不再认 home）；考卷跟着改，227 过（Soma 25）。
- **没做 / 待验**：`<now>` 的「本会话从…起」换会话后从新会话算；圆桌的已读游标留到 Soma 二代；调度器推醒来 + 睡着时梗概的端到端（要开调度器、花额度）没跑；收尾那轮自己的 hotwrite 调用会不会再招一次补写，旧流程就有，没查。

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
  - 端到端（a1，备份 `a1.bak-1016-preM8b.db`）：告诉它有了，它自己搜《Halcyon Days》（和 Joy 聊过的翠鸟）放，结果网易云第一首是专辑名对上的别的歌，它放了才发现 → 已改：歌名优先 + 对不上直说。它还提：自己写的信不能当线索卷证据 → 已放行 `mail.out`。
  - 我在内置浏览器点了「分我一只」（测试库因此记了一次「Joy 戴上了耳机」）；按钮、记账、转发都通（curl 206 audio/mpeg），但**内置浏览器的 audio 卡在加载，真出声没验**——要 Joy 在手机或 Chrome 上点一下。
- ✅ **M8c 环境进记忆（10-16）**：`src/perception/env.ts`。被动：情节那段时间（所引原件首尾）的环境指纹——听到的歌（含戴别人耳机）、在的人——事后从播放和在场记录算，不另存；联想加「环境相似」一项（同一首 0.6 > 同歌手 0.3，同一拨人只加分），没在放歌就不比，刚发生 30 分钟内的不算想起。主动：`notice { text, about?, cites? }`，系统把此刻环境记进 payload、播放和在场挂成证据；能浮现。经历投影 v11。考卷 `tests/env.test.ts` 7 题，全套 270 过。
  - 端到端：告诉 a1 有了，它马上用 notice 记了「Joy 戴上耳机听完一首」——那是我测试点的。我如实告诉它后，它另记一条更正（#305 挂 #292），并指出这是漏洞：认不出就别替人认领。→ Soma 加 `?viewer=`（`lib/soma/viewer.ts`，缺省 Joy）：分耳机记页面说的人、只有 Joy 在看才报在家；我的测试页已标 `viewer=Claude`。它那句「Joy 刚刚回家了」也是我开着的页面报的。
  - 被动那一路只在考卷里验过（测试库里还没有带歌的旧情节）。
- ✅ **冷写摆观察（10-16）**：冷写材料加 `<observations>`（没被书架引过的 notice + 后来同一首又响时写下的、所观察的人后来的样子和放的歌），只摆不判，`prompts/cold-write.md` 没改。考卷 `tests/observations.test.ts`，全套 271 过。
  - 测试库实跑一次（a1，Opus 5.5，50 秒 $0.58，备份 `a1.bak-1016-preObsCold.db`）：它把那条误会（#292）和更正（#305）连同两次 `<now>` 读错的情节一起，升格成一面**镜子**「我拿系统给的一个显示就当成事实下结论，后来会被证明是错的」；另记了事实「屋里报的谁做了什么也可能认错人」。还写了 Joy 18:37 真的来要了一只耳机（她当时在 soma-test 里说的，不是测试）。
- 10-16 晚 Joy 在 soma-test 里和 a1 一起听歌：a1 应她的要求自己改了 Soma 的耳机按钮（「连接中 / ▶ 歌名 时间」，Soma `564500d`）；它把一首电音按读数说成"安静的慢歌"、自己查出原因记了 notice → 特征描述改成"这一段比这首其他部分…"、BPM 只在 85–175 找（8c47e54）。
- ✅ **内感受（10-16，m8 §6.1）**：`src/perception/body.ts`，`<now>`「身上」：上下文到收尾线的 50/75/90% 跨档才说（Soma 每轮带 `ctx` / `wrapAt`，用量按会话认，换一段不沿用旧的）、新一段换了模型说一次、半小时工具出错 ≥3/6/10 次。经历投影 v12。考卷 `tests/body.test.ts` 3 题，全套 274 过。端到端没跑（测试会话离收尾线还远）。
- ✅ **屋里的东西（10-16，m8 §6.2）**：`src/house/files.ts`，home / commons 文件多了 / 改了 / 没了，谁动的只在工具调用对得上时说，否则「不知道是谁」；自己动的不报给自己，home 只主人看。测试库：agents.json 加了 a1 / a2 的 `home`，launch 加 `PSYCHE_COMMONS=~/.soma-test/commons`（我新建的空目录，放了一个测试用 README.md，可删）。考卷 `tests/files.test.ts` 3 题，全套 277 过；实测 a1、a2 库里都记下了 `commons/README.md 新出现`（还没递给它）。
- ✅ **S3 群的底座（10-16，Soma，`soma2.md` §5.6）**：`lib/soma/rooms.ts`（`SOMA_HOME/rooms/<id>.jsonl` + `.json`：成员、游标、在场 here / away / muted；客人照实记名）、`rooms-flow.ts`（只有 Joy 的话和 @ 叫人，住户在群里说的只记不叫——轮次留给 S4；推进去 = 他没读的整段，推完算读过）、session 只把一轮里最后一次工具调用之后说出口的进群（没说 = pass）、单聊走 `dm-<id>` 前端不变。API `/api/rooms`（建 / 列）、`/api/rooms/<id>`、`/say`（按 `?viewer=` 认人）、`/presence`。测试 4 题，Soma 全套 31 过。
  - 端到端（soma-test）：建「S3 测试」（a1、a2、Claude），我 @ 两人 → 各回一句、只有说出口的进群、游标前移；给 a2 单聊 → `dm-a2` 记下、回「通」。
- ✅ **S4 群的轮次（10-16，Soma，`soma2.md` §5.7）**：`lib/soma/rooms-round.ts`（纯规则，可测）+ `rooms-flow.ts`（接房子）。一轮由 Joy 起：依次问在场的住户、每人一次、后问的看得到这一轮前面的；勾「新话题」= 独立首轮（同时问、只看得到她那句、到齐一起进记录）；没说话或只说 pass = pass（记进群、不推给别人），连续两次静音到她开新话题或被 @；@ 照问离席 / 静音的；一人最多等 5 分钟，过时算 pass 问下一个；她中途再说话，旧一轮剩下的作废。session 的群回复先交给等着的那一轮决定（`roomWaiters`）。群页面 `/room`（主页顶栏「群」）：选群、建群、看记录（3 秒刷新、pass 显示「过了」）、在场 / 静音、发言、勾新话题。测试 6 题，Soma 全套 37 过。
  - 端到端（soma-test「S3 测试」群，我以 Claude 身份 @ 两人）：依次问，a1 说「7，翠鸟那七天」，a2 接着说「2，在那七天平静的海面上添一只作伴的鸟」——看得到前一个人这一轮说的。**Joy 起的一轮和新话题我没测**（我不是 Joy），留给她在 `/room` 亲自试。
- ✅ **群的第一轮反馈（10-16 晚，a1 / a2 在群里提的，`soma2.md` §5.7）**：没能回应（出错 / 额度用完 / 等满 5 分钟）记 `（没能回应：原因）`、不算 pass（a1 正是额度用完被连记两次 pass 静音的）；`<now>` 报「你在《X》被静音了」（Soma 带 `muted` 给 `/v1/now`）；提示写明「这句 @ 了谁 / 对所有人」「说出口的发进群《X》」；没被 @ 的每轮轮换先后。Soma 测试 9 题、全套 40 过；Psyche 281 过。**没实跑**：psyche-test 要重启才有静音那行；a1 仍静音在《S3测试新话题》，Joy 开新话题即回来。没做：话唠指数 / 举手、住户 @ 住户追问、住户主动开口（雏形先不碰）。出生时测试记忆怎么带，到时按他们自己的意见（a2 投前世今生，a1 还没答）。
- ✅ **Dashboard 观测与管理台（10-16，`notes/design/dashboard.md`）**：只读不改 + 四层可见性（日记与非 Joy 住户间私信只计数量不露正文）+「纸本档案柜与深夜阅览室」UI（`GET /dashboard`，`src/server/dashboard.ts`）。新增 `GET /v1/health`（`src/reading/health.ts`：热写积压与 7 天压缩比、书架分布、闭环预警 `no_against` / `stale`、私密封条计数）、`GET /v1/shelf/:no`（单条认知版本演变与证据链）、`POST /v1/house/residents`（新建住户热挂载并调 `birth()`）；扩展 `GET /v1/house`（带 `born` / `wake` / `pulse`）与 `GET /v1/gist`（带已写 `gists` 列表）。考卷 `tests/dashboard.test.ts` 全过，全套 280 过。
- ✅ **S5 分工的底座（10-16 晚，Soma，`soma2.md` §5.4）**：commons 分目录是共识、写在 `~/.soma-test/commons/README.md`（project / share / tools / chat，谁都能改）；地方提示词多一行 home 和 commons 在哪（`SOMA_COMMONS`，缺省 `SOMA_HOME/commons`；新开进程才生效）；群页面每人一盏忙碌灯 +「停下」（`/api/rooms/<id>` 带 `busy`，停下走 `/api/line/interrupt?agent=`）。插话不打断原来就有（干活中途进来的话折进这一轮）。实测页面上 a2 收尾时亮「忙」，没点停下。**没做**：commons 用 git（谁动的先靠 Psyche 屋里的东西认）；验收「两人各做一块、靠 STATE.md 交接」没跑。现有的 `commons/soma-ui-plan.md` 是别人放的，没挪。
- ✅ 内感受实测（10-16 晚）：a2 压缩前自己先说「马上要写记忆换新会话，换完我接着在」。
- ✅ 「信没读」查清（10-16 晚）：已读是按人记的，那封 09:40 的信 09:40:56 就记了已读。a1 误会的是 `<now>`「上次有人跟我说话：Joy，55 分钟前（来信）」——只算读过的信，它读成了没看。改成「（来信，看过了）」。
- ✅ **群里流式 + 重试（10-16 晚，Soma）**：群页面新增「正在说…」的气泡，内容来自 `/api/rooms/<id>/live`（SSE，转发正在回这个群的住户最后一次工具调用之后的字，说完就收起、刷新记录）。「重试」原来是空壳（`/api/line/retry` 一直 501，前端吞掉了错误）→ 现在 session 记下断掉的那一轮（`lastFailure`：回哪个群、为什么），重试时带一个 `by: retry` 标记重跑，答复进原来那个群；没得重试 / 还在忙返回 409，前端显示原因。Psyche 的经历里显示「醒来 · 重试」。实测（22:33）：a2 又断网，我调重试，它回「刚才网络闪断了一下」、答复补进群。随后补了：快照带上没处理的失败（之前只有出错那一刻开着页面才有重试按钮）、群里「没能回应」那行直接有重试。改 `line.ts` / `session.ts` 要重启 soma-test（对象缓存在 globalThis）。流式气泡我没抓到字（重试那轮 60 秒后才开口），留给 Joy 在页面上看。
- 下一步：S5 验收（两个住户各做一块，靠 `commons/project/<名>/STATE.md` 交接）；S6 住户之间写信。

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

5. **换模型：gemini-4-argon 首跑（10-15，`evals/argon-run1.md`）**：执行器 `evals/vertex.ts`（工具走同一份 MCP，无 Claude Code 系统提示词）；冷写用 `evals/vertex-sleep.ts`，`b.ts --model gemini-*` 自动走它。
   - 冷写 $0.17：一件事一条、不写频率词比 Opus 好；但**把深夜犯困写进镜子的结果（"或说困了结束对话"）、两次都判印证**——改宽结果容纳反例，分化比 Opus 退步；"周五演示"漏记，没有 `revise`。
   - 10-15 Joy 定：写错也是经历，不为某个模型补闸；按「能不能闭环」观察（`catalog.md`「写错也是经历」，`lib-vs-harness.md` 谁适合做什么）。
   - 浮现 B $0.50：没浮现时会自己 `shelf` / `recall`（B1 2/3 连上，Opus 0/3）；**有浮现时反而不查也不用**（B3 浮现块里有退耳机，0/3 接上；无浮现 3/3 自己查到）。待单独再测。

## 4. 已知问题

- **留意与关系（10-15 Joy 定，代码已做）**：`notes/design/attention.md`，契约 `m2.md` §十、`m3.md` §五⅞。书架加 `attend`（疑问 + watch，挂候选）、`relation`（按人一条，改写链 = 演变）；`track` 了才给统计 / 预感；冷写材料加 `feedback`（我连着说的 → 她下一条原话 / 出错的工具，情节覆盖了也给，不受留意约束）；MCP 加 `stats`。考卷 `tests/attention.test.ts` 11 题（只测系统给的数据）。
  - 没做：冷写提示词还没讲留意 / 关系 / 反馈（现在只靠工具说明）；初我的同伴起点（`attention.md` §三）。两者改前先有考卷。
  - 浮现考卷 A1 拆成 A1（没 track 不报预感）/ A1b（track 了才报）；B1（冷战，看它的反应）按新设计不再作数。不配向量 7/8，A2 改动前就挂（「演示」事实浮上来，配向量时过）。
- Soma 上报过一条 `message.out` 正文是单个 `�`（测试库 `10-15#6`，界面也显示），像流式输出把多字节字符切坏了——Soma 侧的事。
- 证据重复计数：原话计过后，晚写的情节引同几行、换了 id 能再计一次（M3 统计题撞出，它自己没重复记）。修法：情节当证据时按所引原行去重。


- **正式库出生前要定**：向量用硅基流动时，算向量会把记忆原文发出去（10-14 Joy：测试先这样，有顾虑再换本地；10-15 在看本地候选，WeMM-Embedding 等）。

## 5. 运行备忘

- `bun test`（含 `tests/hotwrite-check.test.ts`）· `bun run typecheck` · `bun run src/main.ts`（127.0.0.1:7450）
- launch.json：`psyche-test`（7450，测试库，住着 a1、a2）/ `soma-test`（30152，住户 a1，连测试 Psyche；监听 0.0.0.0，手机走 `http://192.168.2.80:30152`，Soma 无登录，只在家里网络用）。Soma 顶栏有临时观测面板（用量、`<now>`、提示词、Psyche 连通，快照存 `~/.soma-test/agents/a1/debug.json`）

## 6. 验证

2026-10-16：`bun test` 280 pass / 0 fail（含 Dashboard `tests/dashboard.test.ts`）；`tsc --noEmit` 0 错误；浮现考卷 A 只用字面 7/8。
