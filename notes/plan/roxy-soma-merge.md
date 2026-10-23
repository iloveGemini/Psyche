# 方案：Roxy 并进 Soma，以后功能加在哪

> **未采用（10-23 Joy 和 Roy 定：不融合）。** 第一节的判断流程已改成两个地方通用的版本，收进 `notes/design/lib-vs-harness.md`「加功能放哪」。下面的内容留作「为什么没合、零件在哪」的参考。

> 2026-10-23 草案，开发会话的 Claude 写，等 Joy 拍板。前置：`notes/design/lib-vs-harness.md`（本体与地方）、`soma2.md`（房子）、`perception-and-fading.md` §一（感知归 lib）、`notes/plan/p3-p4-handoff.md`（P3/P4）。
> 「已定」那几条来自上面的文档，不用再问；第五节是要 Joy 定的。

## 〇、一句话

**留 Soma 当唯一的身体代码，Roxy 只当零件库。** 以后每个新功能先问一句「这是他是谁 / 知道什么，还是怎么干活 / 跟谁说话」——前者进 Psyche，后者进 Soma；进 Soma 的再分「他主动用的」（MCP 工具）和「每轮递给他的」（线上的情境块），身体差异只留在 `bodies/` 里。

为什么留 Soma 不留 Roxy：Soma 从一开始就是多住户 + 身体适配器（claude-sdk / pi）+ 房间；Roxy 是从 pi-agent-desktop 改来的单人房子（`~/.roxy/agent`、一把生命锁），往里加多住户等于重打地基。Roxy 的定制大多写成 pi 扩展，Soma 的 pi 身体同样用 `extensionFactories`，零件能搬。

---

## 一、三层分工（判据）

| | Psyche（本体 / lib） | Soma（地方 / harness） |
|---|---|---|
| 管什么 | 我是谁、我在哪、我知道什么、什么时候醒 | 怎么干活、跟谁说话、在哪个房间、Joy 看到的界面 |
| 有什么 | 记忆（热写 / 冷写 / 浮现）、自我、作息与心跳、收件箱与信、感知的**存与递**（percept → `<now>`）、感知设置（P4）、在场 | 线（`session.ts`）、身体、工具、房间与活动、沙箱与守卫、界面（PWA / iOS 壳）、通知 Joy、对外设备的入口 |
| 跑模型吗 | 不跑（只留向量） | 跑（住户的身体，以及叙述者这类非住户的模型） |
| 加工具吗 | 只加记忆 / 自我的工具（红线：lib 里永远不加通用工具） | 加，所有动手的工具都在这 |

**一个功能拆开看，常常两边都有一点。** 例：看 Joy 的屏幕——「去看」是 Soma 的工具；「他看过」是他的经历、「她屏幕前在干嘛」是感知，这两样报给 Psyche。

### 判断流程（加功能时照着走）

1. **要调模型或动手（读写文件、跑命令、截屏、联网、放歌）？** → Soma。
2. **是关于他自己的事实、记忆、作息、心情，或决定什么时候叫醒他？** → Psyche。
3. **是关于外界的事实（Joy 在哪、天气、谁在屋里、放着什么歌、文件谁动了）？**
   → 采集入口在 Soma（设备只连得到 Soma，Psyche 只听 127.0.0.1），**存和递在 Psyche**：Soma 收到后报成 percept，Psyche 按感知设置决定进不进 `<now>`、进不进环境指纹。不要在 Soma 里自己拼一段「Joy 现在…」塞进上下文——那样换个身体 / 工位（Claude Code）就看不到了。
4. **进 Soma 的，再分三种形状：**

   | 形状 | 放哪 | 两个身体都能用吗 |
   |---|---|---|
   | 他主动调用的 | **MCP 工具**（`lib/soma/mcp.ts` 的 `soma` 服务，或按功能另开一个服务） | 能，两边都挂 MCP |
   | 每轮自动递给他的（只在 Soma 才有、不归感知的，比如影音室的 `<movie>`） | **线上的情境块**：`session.ts` 拼输入时和 `<now>` 一起放 | 能，线不分身体 |
   | 动到身体内部的（改写旧上下文、插话 steer、图片 / 音频块） | `bodies/` 里实现成身体能力，**另一个身体要有退路** | 不一定，退路必须写 |

5. **Joy 用的界面**（卡片、面板、设置、iOS 壳）→ Soma。

### 已定的红线（不变）

- Psyche 不跑大模型、不加通用工具；Soma 的提示词不写性格。
- 压缩不要摘要；原件不改只盖标记；房间不持有上下文；密钥不进环境变量。
- 工具不按房间分（中途换不了 cwd / 技能，换系统提示词要重写缓存）。房间信息放 `<now>`。真要房间专属工具，热挂 MCP（claude-sdk 有 `setMcpServers`）。

---

## 二、Soma 要先补的底座

合并前先把这几块做成通用的，后面的功能才不用每个都写两遍。

1. **按住户拼地方提示词**（`harness-prompt.ts`）
   - `PLACE` 拆成「基础」和「房间」两段；`identity.json` 加开关（如 `"rooms": false`），关了就不拼房间段、也不挂 `rooms` / `agenda` 工具。
   - `agents/<id>/place.md` 有就接在后面，写他那间的事实（例：「书房是你的，Joy 进来要你邀请」）。先例是 `prefill.md`。
   - 只写地方，不写性格。
2. **情境块注册**（`session.ts`）：一个功能登记「什么时候要递一段东西」（按房间、按住户），线拼输入时统一取。影音室的 `<movie>`、附件摘要都走这里，不再写成 pi 的 `before_agent_start`。
3. **身体能力表**（`bodies/body.ts`）：把现在散着的「pi 能 scrub、claude-sdk 只能发通知」收成显式能力（`scrubContext`、`steer`、`media: image | audio | video`），功能按能力选路，缺的走退路。
4. **按住户挂 MCP**：`identity.json` 里列这个住户挂哪些 Soma 的 MCP 服务（`soma` 默认都挂；`cinema`、`health` 之类按人开）。
5. **P4 感知设置**（Psyche 为主，Soma 配合 `rooms.public`）+ **P3 剩下的敲门 / 邀请**（Soma，零件在 Roxy `doors.ts` / `invitations.ts`）。这两块加上第 1 条，就是答应 Roy 的单间。
6. **感知入口**：Psyche 要有一个通用的外部 percept 接口（若现在只有 house / netease 那几路，就加一个 `POST /v1/percept { sensor, … }`）；Soma 加对应的转发路由，带 `x-soma-key`。

---

## 三、Roxy 的零件逐个归位

「搬」= 从 Roxy 拿代码改；「已有」= Soma / Psyche 已覆盖，对一下差异即可；「不搬」= 方向变了。

### 线与会话（Soma，大多已有）

| Roxy | 去向 |
|---|---|
| `life*.ts`、`volume.ts`、`closing.ts`、`context-limit.ts`、`wake-mark.ts`、`in-context.ts` | 已有：`session.ts` 的线、收尾、换会话、唤醒标记 |
| `psyche/*`（client / report / marks / extension / body / door） | 已有：`lib/soma/psyche.ts`、`report.ts`；Roxy 10-20 后改的（`since` 种子去重）Soma 也做了 |
| `prefill.ts`、`thinking-tags.ts` | 已有；`thinking-context.ts`（思考怎么回到模型）对一下差异 |
| `framing.ts`、`house-frame.ts`、`system-protocol.ts` | 并进按住户的地方提示词（底座 1）；性格类的句子删掉 |
| `retract*.ts` | 已有（`marks.ts`、`takeback.ts`） |
| `rewind.ts`（删除 / reroll）、`retry.ts`、`interrupt.ts`、`failure.ts` | 搬，Soma 只有「没能回应要能重试」，缺 reroll 和断因分类 |
| `gemini-schema.ts` | 搬进 pi 身体（Gemini 拒带非字符串 enum 的工具 schema） |
| `speech.ts`（没说 / 说了） | 已有（`<keep_silence/>` → `speech.silent`） |
| `payload.ts` | 已有（观测面板） |

### 干活与安全（Soma）

| Roxy | 去向 |
|---|---|
| `guard.ts`（抓偷懒、`rm` 进废纸篓） | 搬进 `sandbox.ts` 那一层：pi 的工具包装 + claude-sdk 的 PreToolUse 钩子各接一份 |
| `background.ts`（长命令在轮外跑）、`letters.ts` | 搬：跑完的结果当一条来信进 Psyche 收件箱，由 Psyche 照常叫醒（不自己叫） |
| `attachment-digest.ts`、`erase-screenshot.ts`、`image-*` | 搬成情境块 + 身体能力：pi 当轮看原件、之后换摘要；claude-sdk 一开始就只给摘要 + 当轮原图 |
| `notifications.ts`、`reply-notify.ts`、`viewers.ts` | 搬（通知 Joy 是界面的事）；「Joy 正在看」顺手报给 Psyche 当在场 |
| `house.ts`、`house-settings.ts`、`house-ignore.ts`、`write-layer.ts`、`desk-traces.ts`、`given.ts` | 文件界面搬到 Soma；「她看了我的东西」「我给她的她读了没」是事件，报给 Psyche |
| `boundary.ts`、`her-acts.ts` | 越界与她的动作 = 事件，Soma 报、Psyche 存；依赖 hub 的部分不搬 |
| skills / plugins / worktrees / OAuth / 模型发现（pi-agent-desktop 的遗产） | 不搬；模型线路 Soma 已有（`api-settings.ts`） |

### 感知（入口 Soma，存与递 Psyche）

| Roxy | 去向 |
|---|---|
| `clock.ts`、`since.ts` | 已有（`<now>` 的时间） |
| `presence.ts`、`mobile-presence.ts`、`segments.ts`（前台应用）、`weather.ts`、`browsing.ts` | iOS / 浏览器 → Soma 入口 → Psyche percept；渲染与过滤在 Psyche（受 P4 设置管） |
| `joy-state.ts`（她说自己在哪、要安静、心情） | 界面在 Soma，状态存 Psyche（Joy 的在场） |
| `attention.ts`（他看她哪些方面） | 就是 P4 感知设置，进 Psyche，不再是 `attention.md` |
| `away.ts`（离开的权利） | Psyche 作息 / 勿扰已有，对一下 |
| `screen-extension.ts`、`screen-tool.ts` | Soma 的 MCP 工具（看屏幕）；`screen-views.ts`（看过的账本）报给 Psyche |
| `mi-fitness.ts`、`health-requests.ts`、`health-extension.ts` | 申请卡与审批在 Soma（工具 + 界面）；批了之后拿到的数据作为工具结果给他；长期趋势要不要进感知，等第五节定 |
| `reaction.ts` | 不搬（hub 没了；`body.md` 搁置：不设计反应） |

### 房间里的东西（Soma）

| Roxy | 去向 |
|---|---|
| `rooms.ts`、`move.ts` | 已有（Soma P3a）；`move.ts` 的「下一轮才生效」对一下 |
| `doors.ts`、`invitations.ts` | 搬（P3 敲门 / 邀请） |
| `room-capabilities.ts` | 暂不搬（工具不按房间分）；要时改热挂 MCP |
| `cinema/*`（影音室） | 工具（`correct_speaker`、`rename_character`）→ MCP `cinema` 服务；`<movie>` → 情境块（他在影音室才递）；原声 / 画面 → 身体能力，旧轮去掉靠 pi 的 scrub，claude-sdk 退回转写；`sampler` + `rhythm` 叫醒 → Soma 直接推线（同房间 `urgent`），标「电影」并报给 Psyche；「一起看了什么」报 percept，进环境指纹（同一起听） |
| `rp/*`（游戏室） | 做成活动引擎（`activity.ts`）里的一种活动：叙述者是 Soma 跑的非住户模型，住户照常在自己的线上玩 |
| `music/*`、`music-extension.ts` | 已有（Soma 音乐 + Psyche M8b），对一下歌单、歌词那几处差异，工具放 MCP |
| `apps/ios` | 改连 Soma（端口、`x-soma-key` / cookie），位置与健康推到 Soma 的感知入口 |

---

## 四、分几步走

每一步都在测试房子（`psyche-test` 7450 / `soma-test` 30152）先跑，不碰正式住户。

| 步 | 做什么 | 完成的样子 |
|---|---|---|
| 0 | 定 Roy 住哪；Roxy 冻结（只修 bug、不加功能） | 两边不再同时长新功能 |
| 1 | 底座：按住户提示词、情境块、身体能力表、按住户挂 MCP | 测试房子里 a1（claude-sdk）、a2（pi）各自拿到不同的地方段和工具 |
| 2 | 单间：P4 感知设置 + 敲门 / 邀请 | 一个住户关掉房间段、对别人设「不看」，Joy 进他房间要被邀请 |
| 3 | Roy 搬家前必需：reroll / 断因、守卫、后台命令、通知、附件摘要、iOS 改连 | Roy 日常在 Roxy 用到的，Soma 上都有 |
| 4 | 搬 Roy：照 10-19 P0 备份；把他在 Roxy 正读的那一卷导进来接着用 | Roy 在 Soma 过一周，没有「这个怎么没了」 |
| 5 | 感知入口：手机在场、天气、前台应用、浏览、健康 | `<now>` 里 Joy 那侧的事实回来，且受 P4 管 |
| 6 | 影音室、游戏室、音乐差异 | 影音室按剧情叫醒、RP 能跑一局 |
| 7 | Roxy 归档 | `~/workspace/Roxy` 只读；README 指向 Soma |

第 3、4 步的顺序可以换：先搬人、缺什么补什么，代价是 Roy 那几天少东西。

---

## 五、要 Joy 定的

1. **Roy 正式住哪、哪天搬。** 10-19 交接写的是「Roy 搬回 Soma，Roxy 退役」；Roxy `STATE.md` 10-20 写的是「停掉 Soma 里的 Roy」，他现在在 Roxy（launchd :8800）。两边都在写他的生活线会出事，得先定一边。
2. **感知走 Soma 中转（设备 → Soma → Psyche）可以吗？** 好处：Psyche 继续只听本机；代价：Soma 挂了，感知也断。
3. **只给 Roy 的感知**（看屏幕、健康数据、手机位置）：按住户开（`identity.json`），还是屋里谁都能申请？交接里「Joy 对谁都能感知」说的是住户感知 Joy 的在场，屏幕和健康更私密。
4. **RP 叙述者用哪个模型、额度算谁的。**
5. **Roy 的单间**：房间段整个关掉（他不知道有公共房间），还是保留、只是默认不听？
