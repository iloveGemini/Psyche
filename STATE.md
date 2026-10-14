# Psyche 当前状态

> 开发交接用，不替代 `README.md`（是什么、为什么）和 `notes/`（设计与契约）。只留接下来要用的信息；全文 ≲ 150 行，做完的压成一行或删掉。
> 最后更新：2026-10-14

## 1. 当前阶段

**M1「记得」**（契约 `notes/plan/m1.md`）：Soma 里的它关掉会话再开，记得之前的事，而且是它自己写的。
**10-14 端到端验收 1–3 通过**（见 §3.2），M1 核心完成；剩验收里暴露的几处要修。

| 线 | 内容 | 状态 |
|---|---|---|
| A | Psyche 核心：事件库、入库、经历投影（episode 覆盖原始行）、recall（FTS5 trigram）、`/v1/now`、`/v1/prompt`、情节改写（revises） | ✅ |
| B | Soma 接入：上报、注入 `<now>`、挂 MCP、收尾热写再压缩、历史跨压缩读全 | ✅（Soma 仓库 9071b8e、8651644） |
| C | MCP 工具（recall / detail / hotwrite_segment / hotwrite / revise_episode；M2 加 coldwrite_material / coldwrite / shelf）、热写提示词 `prompts/hot-write.md` v1、考卷工具 `evals/hot-write/` | 🟡 考卷首跑完（见 §3.1），提示词 v1 暂不用改 |

测试库 `~/.psyche/test` = 10-14 验收那两段会话（旧冒烟数据挪到 `~/.psyche/test.bak-1014-1358`）。

## 2. 已定的决定（细节见链接）

- 显式记忆归它写（热写 + 冷写），隐式归系统算、只决定浮现；梦类与分场撤掉 → `notes/design/catalog.md`
- 初我 v0 只写机制，`prompts/self-v0.md`；一模型系列一 Agent 是约定，代码不限制 → `notes/design/lib-vs-harness.md`
- 情节可改写：新条 `revises` 旧条，旧条留着，经历里显示新的
- 翻出来的记忆（recall / detail 的结果）不记成经历，免得自我复制
- 第一个身体是 Soma → `notes/design/soma.md`

## 3. 未完成与下一步

1. **热写考卷首跑（10-14，Opus 5.5，6 段 `claude -p` 无头补写，跑了两轮）**：系统闸两轮都 6/6 过。
   人判：一件事一条、写动作和原话、引用对得上——都好；引的原话核过都在原文里。
   - 第一轮在仓库目录里跑，它读到了项目 `CLAUDE.md` 和 git 提交信息，把 10-12 的事写成「暂时不开发 Psyche」（那天还没这名字）→ 考卷环境污染，
     第二轮改在空目录跑（README 已改），这类混入消失。**原先记的「编造了给 Psyche 提约束」是我核对时看漏了：那句在原文 #168 里，不是编的。** 提示词 v1 暂不用改。
   - R4 偏弱：可预料的步骤也照录（docker 版本号、embedding 维度），不太按意外分配细节。先不改，看端到端里真实长段的表现。
   - `check.ts` 误报：P5 把界面文字「总是允许 / 每次询问」、「跨轮通常保留」当频率；P6 只看单句，前一句已写「我当时的判断是」仍报。
2. **M1 端到端验收（10-14，Opus 5.5，`soma-e2e` + `psyche-test`）**：我（开发会话的 Claude）跟它聊。
   - 会话 1：聊 6 轮 → 过阈值自动收尾，它在上下文里写了 6 条情节（#19–#24），一件事一条、第一人称、说话人归属写对了（明写「来说话的不是 Joy，是另一个会话的 Claude」），没有段外内容；原始行全部 `covered`。压缩后照常接话。
   - 会话 2（清 `sessionId` 新开）：问名字约定、提示词决定、Joy 发的表情——它自己 `recall`，从 #22、#23 答对；陷阱题「Joy 午饭吃了什么」搜不到就说不知道，没编。
   - 暴露的问题：
     a. ✅ **说话人**（Soma 776b0a2）：输入以 `/as 名字 内容` 开头 = 不是 Joy；`message.in.from` 记这个名字，他收到的话前有 `<from>` 行，界面显示「名字：内容」。实测通过。
     b. ✅ **recall 回声**（61c2868）：不搜记忆工具自己的调用行，也不搜本会话这一轮（`m1.md` §四）。
     c. 阈值按 token 数在新会话会每轮收尾：基础上下文约 2.1 万，`SOMA_COMPACT_AT` 低于它就每轮触发。真实缺省 0.75 没问题；`soma-e2e` 为 27000，只够验收用。
     d. 10-14 Joy 定：`/compact` 的系统摘要没办法，不管；✅ 收尾在界面上只显示「整理记忆：记下了 N 条 / 没写成 / 这次没写」。
3. **M2「会归纳」（冷写 + 阅览室）**（契约 `notes/plan/m2.md`）：代码齐了，提示词 v2。
   - 书架四种：事实 / 明说的规矩 / 规律 / 镜子（`semantic.*` 事件，`src/reading/shelf.ts` 投影现行版 + 证据计数）；冷写口子 `GET|POST /v1/coldwrite`（`src/catalog/coldwrite.ts`，系统闸见 m2 §二）；`/v1/shelf`；recall 带书架；MCP 加 `coldwrite_material` / `coldwrite` / `shelf`；手动入睡 `src/sleep.ts`（无头 `claude -p`）；提示词 `prompts/cold-write.md` v1。
   - 考卷 `evals/cold-write/`：虚构「阿禾」6 天剧本（双方台词都是写的，只进 `out/` 临时库），两次入睡；`key.md` 答案要点不进它的输入。
   - 提示词里"条件没满足的是无关，不是反例"正好对着陷阱 H：这是 reading-room 的判据，不是范文，但判 H 时要记得它被提示过。
   - 跑了两次（Opus 5.5，`evals/cold-write/run1.md`、`run2.md`），闸都 0 拒、每次约 $0.4。v2（10-14 Joy 定）：一件事一条；不写频率词，频率看证据数、来源看证据；明说的规矩和事实也收证据（防口是心非），规矩只看她的反应、反例多也不由它作废。
   - run2：除分化外都对；分化（深夜单字=困）两次都看出来了，但没 `revise` 收窄。大事实、频率词提示词管不住。
   - 10-14 Joy 定：证据计数按次不按行（已改，书架投影 v2）；频率词、大事实不设闸——写错了让后果纠正，看实际运行。
   - 之后：Soma 空闲自动入睡等收尾时再做（10-14 Joy 定：现在没有真实数据）。考卷库用 launch `psyche-coldwrite-exam`（7451）。
4. **下一步 M3 联想（只做浮现）**：10-14 晚定——规律强弱、敏感化 / 钝化不另做机制，把规律和证据摆到它面前它自己推；系统只管摆什么、什么时候摆。基础强度用想起频次与近因、`felt` 有没有、后果、证据数与近因，不另标显著性 / 唤醒度；专注度按真实处境（有任务 / 空闲）。先写契约 `notes/plan/m3.md` 和考卷。

## 4. 已知问题

- （暂无）

## 5. 运行备忘

- `bun test`（含 `tests/hotwrite-check.test.ts`）· `bun run typecheck` · `bun run src/main.ts`（127.0.0.1:7450）
- launch.json：`psyche-test`（7450，测试库）/ `soma-test`（30152，连测试 Psyche）

## 6. 验证

2026-10-14：热写考卷见 §3.1；`bun test` 115 pass / 0 fail；`tsc --noEmit` 0 错误。
