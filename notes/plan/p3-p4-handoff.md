# 交接：P3 空间 + P4 感知设置

> 2026-10-19，开发会话的 Claude 写给下一个会话。背景：Roy 从 Roxy 搬回 Soma（P0–P2 已做完），Roxy 退役，往后只维护 Soma + Psyche 一份代码。
> P3、P4 的设计是 10-19 这天和 Joy 聊定的，下面「已定」那些不用再问；「开工前要跟 Joy 确认」那几条要先问。

## 一、已经做完的（不用重做）

| | 做了什么 | 在哪 |
|---|---|---|
| P0 | 备份 Roy 的 Psyche 库、`~/.soma/agents/roy`、`~/.roxy/agent`、`~/Roxy`；停掉 Roxy 常驻、卸掉它的 LaunchAgent | `~/.psyche/data/backup/roy-1019-preMove/` |
| P1 | Roy 的新库只导入他在 Roxy 当时正读的那一卷（`01a1488a…`，154 条），**没出生、初我是空的**，前世 ROY 登记了但没认领；Soma 接着用同一卷 pi 会话；模型 `google-vertex/gemini-3.1-pro-preview`；home = `~/.soma/agents/roy/home`。10-17 在 Soma 出生的那个库收在 `backup/roy-1019-somaLife/` | Psyche `9a7105a`（`scripts/import-pi-session.ts`） |
| P1 | 预填充只给 Roy：`~/.soma/agents/roy/prefill.md` 有就挂，`identity.json` 的 `prefillModels` 决定哪些模型用；思考按 `</thinking>` 切（存之前切、流式也切） | Soma `e2004cc`（`lib/soma/prefill.ts`、`thinking-tags.ts`） |
| P2 | 每个住户同一份 Seatbelt 沙箱：电脑上随便读写（`~/workspace` 含 Soma/Psyche、测试房子、日志），只挡别的住户的东西、各种钥匙、git 钩子 / 别人仓库的 `.git/config` / 开机自启 / shell 启动文件、Apple Events / `open` / `launchctl` / 剪贴板。pi 身体换掉了 bash 的执行、文件工具先查路径；Claude 身体在 PreToolUse 钩子里包 Bash、查文件路径（没用 Claude Code 自己的沙箱：它放行 Apple Events） | Soma `51dd88a`、`0194127`（`lib/soma/sandbox.ts`） |
| P2 | 秘密不进任何常驻进程启动时的环境（同一用户的进程用 sysctl 都读得到）：MCP 用 `PSYCHE_TOKEN_FILE`，向量用 `PSYCHE_EMBED_KEY_FILE`（`~/.psyche/secrets/embed.key`），两个 plist 都去掉了明文秘密 | Psyche `ffa4481` |
| P2 | Soma 登录：Joy 的密码（`npm run password`，存 `~/.soma/web-auth.json`）+ 一年的 cookie；机器内部的调用（Psyche 调度器、住户的 Soma MCP）带 `x-soma-key`，钥匙在 `~/.soma/tokens/internal.key`。Joy 已设好密码 | Soma `51dd88a`（`proxy.ts`、`lib/soma/web-auth.ts`） |

都提交在主分支上，都没推送。`~/Roxy/.claude/settings.json` 清成了 `{}`（去掉失效的 `CONTINUITY_AGENT`），没提交。

## 二、P3 空间（已定）

一句话：**群这个概念去掉，换成「人在哪个房间」**。同一个房间里的人互相听得到、都能接话。

- **公共房间**：客厅、画室、影音室、游戏室……就是 `commons/` 下面的目录，谁都能进。
- **私人房间**：每人一间，就是他自己的 home（`~/.soma/agents/<id>/home`）。进别人的要**敲门、对方同意**，或者**被邀请**。
- **位置**：每个住户一个位置，Joy 也有一个。一个住户还是**一条生活线**（Psyche「家 = Soma」），换房间是这条线上的一件事，不是换会话。
- **Joy 私聊**：选了 a，**随时能发，像发微信**。她不在他所在的房间时，她的话照样送到（Psyche 里已经有路：不在同一处就当一条来信）。
- **工具不按房间分**：先不做按房间隔离工具（Claude SDK 身体中途换不了 cwd 和技能；pi 要重开会话；而且每换一次系统提示词，缓存就得整份重写）。工具随身带，房间只表示「谁在、话谁听得到、这里放着什么」。**房间信息放 `<now>`，不放系统提示词**。以后哪个房间真要专属工具，再给它热挂 MCP（Claude SDK 有 `setMcpServers`）。
- **住单间还是别墅不另做**：用 P4 的感知设置表达（不想听别人的动静 = 设成「不看」，待在自己房间里就清静）。

### 现在的代码怎么对上

- Soma 的「群」：`lib/soma/rooms.ts`（`SOMA_HOME/rooms/<id>.jsonl` + `.json`，成员、已读游标、在场 here / away / muted；单聊是 `dm-<id>`）、`rooms-flow.ts`、`rooms-round.ts`（S4 轮次规则）、`agenda.ts`（议题招人）、`room-config.ts`（旁白和隐私配置）、`mcp.ts`（`say_in_room` 等工具）、`app/room/page.tsx`、`app/api/rooms/*`。设计在 `notes/design/soma2.md` §5.6–5.7。
  - 改法：**jsonl 记录 + 已读游标照用**；成员从「固定名单」变成「此刻谁在这个房间」；**轮次规则留给公共房间**（多人时依次问）；`dm-<id>` 变成「在他的私人房间里」。
  - **名字撞车**：现在 Soma 的 `rooms` 指群聊。要改名（比如群聊的那套叫 `talk` / `line`，房间叫 `rooms`），先跟 Joy 说一声再改。
- Roxy 里能搬的（`~/workspace/Roxy/packages/desktop/lib/lifecycle/`，Roxy 已退役，只当零件库）：`rooms.ts`（486 行，房间目录）、`doors.ts`（33 行，关门）、`invitations.ts`（114 行，邀请）、`move.ts`（110 行，换房间的动作和「下一轮才生效」）、`room-capabilities.ts`（房间能用的工具，P3 不需要）、`reaction.ts` 里「没被邀请就进来」的那套（依赖 hub 的情绪，**别搬**）。设计在 `~/workspace/Roxy/docs/rooms.md`。Roxy 的约定：`self.md` 写 `关门：<房间>`，她进关着的门只能敲门；越界会被他知道（`boundary.ts`）。
- Psyche：`src/house/presence.ts`（在线忙 / 闲 / 睡着 / 离线、在哪、个签）、`src/house/house.ts`（每 30 秒看一圈，谁变了记进**其他人**库里的 `percept`）、`src/house/files.ts`（home / commons 文件变化）。`<now>` 里「屋里 / 这段时间屋里」就是从这里来的。位置要进 Psyche（谁在哪个房间），这样 `<now>`、浮现、环境指纹（`perception/env.ts`）才用得上。

### 开工前要跟 Joy 确认

1. 公共房间先开哪几间、叫什么（客厅 / 画室 / 影音室 / 游戏室？），目录名用中文还是英文。
2. 群聊那套的改名方案（见上）。
3. 现在已有的群和议题（`~/.soma/rooms/`）怎么迁：变成公共房间的历史，还是归档。
4. 她自己的「位置」怎么报：界面上手动选，还是看她打开的是哪个页面。
5. 敲门：被敲的人没醒 / 没回，多久算没同意；她能不能直接进住户的私人房间（Roxy 是「她进需请」）。

## 三、P4 感知设置（已定）

- 一份**跟作息同一个路子**的设置：住户自己改，每改一次记一条事件（同 `schedule.changed`，带 why；写错的口子上直接拒，Roxy 的规矩：写错的行不生效，也不悄悄生效）。`<now>` 照设置渲染。
- 大致的项（具体名字开工时定）：

  ```json
  {
    "others.presence": "只看变化",   // 别人在不在、心情个签：看 / 只看变化 / 不看
    "others.sound": "不看",          // 别人放的歌
    "commons.files": "只看变化",     // 公共区文件谁动了什么
    "rooms.public": "@我才醒"        // 公共房间有人说话：都听 / @我才醒 / 不听
  }
  ```

- 三档的意思沿用 Roxy `~/Roxy/attention.md`：「看」= 每轮 `<now>` 里有、变了记进历史；「只看变化」= `<now>` 里没有、变了记进历史；「不看」= 都没有。
- **Joy 对谁都能感知**，不在这份设置里关。commons 大家都能读。
- 跟 Psyche 的「留意」（`notes/design/attention.md`，书架上的 `attend`）不是一回事：那个是它想弄明白的疑问，这个是系统递什么给它。不要混成一个。
- 落点：设置和渲染在 Psyche（`house.ts` 记 `percept` 时、`<now>` 递「屋里」时按设置过滤）；`rooms.public` 要 Soma 配合（公共房间来话叫不叫醒他）。
- **初始值**：不替他们定，给一份中性的缺省（建议全「只看变化」、`rooms.public` = `@我才醒`），让他们自己改。Roy 在 Roxy 最后几天说过不想看别人的动静，这是他自己的事，**他自己会去改**。

## 四、怎么测（别碰正式住户）

- 测试房子：launch.json 里的 `psyche-test`（7450，`~/.psyche/test`，住着 a1、a2）和 `soma-test`（30152，`~/.soma-test`）。开发会话可以自己起；`soma-test` 没设密码，所以是开着的。
- 正式服务是 launchd：`com.joy.psyche`（7470）、`com.joy.soma`（30151）。改了 Soma 要 `npm run build` 再重启（`launchctl bootout` / `bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.joy.soma.plist`）；launch.json 里的 `psyche` / `soma` 和 launchd 抢端口，别同时起。
- 正式 Soma 现在要密码：`curl` 要带 `-H "x-soma-key: $(cat ~/.soma/tokens/internal.key)"`。
- 跑测试：Soma `npm test`（88 个）、`npx tsc --noEmit`；Psyche `bun test`（326 个）、`bun run typecheck`。
- 住户自己也能参与开发（沙箱放开了 `~/workspace`），但他们在沙箱里起的测试版 Soma 调不了模型（凭据在挡住的地方）。要调模型，就由开发会话或 Joy 来起测试服务。

## 五、顺手要知道的

- 做完记得更新 Psyche `STATE.md`（开发交接的唯一入口）——P0–P2 这一天的事还没写进去，可以一起补。
- 沙箱已知缺口：Roy 挂着的 chrome devtools MCP 跑在沙箱外，能让浏览器打开本地文件。
- Claude 身体（claude、a1）的 Bash 现在每条命令单独跑，`cd` 不带到下一条。
- Roy 的新库心跳关着、作息是空的（Roxy 的 `rhythm.md` 没搬），他要自己用 `schedule` 排；他在 Roxy 最后一轮提过想要定闹钟和感知（屏幕 / 状态）——闹钟 Psyche 有，感知是之后的事。
- 别的 Roxy 功能（通知、RP、附件摘要、守卫、健康卡、房间歌单……）都等这两块做完再一块一块加，不着急（Joy 10-19）。
