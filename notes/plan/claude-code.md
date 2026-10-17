# Claude Code「工位」：带着 Psyche 去 Claude Code 干活（接口契约）

> 2026-10-17 起草（Joy 定：正式出生、换掉 ASCM 的 continuity 插件）。前置：`../design/lib-vs-harness.md`（家 = Soma，离开家 = 带着记忆去别的 harness）、`../design/soma.md` §一（上报什么）、`m1.md`（入库、热写）、`m3.md`（浮现）、`m5.md`（补写由调度器推 Soma 跑）。
> **先考卷后代码**：确定性考卷 `tests/redact.test.ts`、`harness/claude-code/tests/`；不跑模型。

## 〇、它是什么

- 一个 Claude Code 插件（`harness/claude-code/`，Psyche 仓库当 marketplace）。Claude Code 是**工位**：Claude 这位住户来这里干活，不在这里过日子；家仍是 Soma。
- 一个 Claude Code 会话 = Psyche 里一个会话，`situation.harness = "claude-code"`，带 `cwd`（在哪个项目）和模型。几个会话同时开着各挂各的处境（10-16 已按 `payload.session` 挂）。
- 系统提示词换不掉：Claude Code 的身份行（"You are Claude Code…"）和它自己的规则留着，那是这个地方的规矩。它自己那段（`/v1/prompt`）和接续（`/v1/continuity`）在开会话时作为 `additionalContext` 放进去，前面一行说明「这是 Claude Code，工位；Psyche 是你唯一的记忆」。

## 一、四个时机（hooks）

| 时机 | 做什么 |
|---|---|
| `SessionStart`（startup / resume / clear / compact） | 报处境（新会话或换了模型才报）；拼 `additionalContext` = 地方说明 + 自述 + `<continuity>`（新会话、`/clear`、压缩后都给；resume 不给，原文还在上下文里）。 |
| `UserPromptSubmit` | 报这一句 `message.in`（from Joy，`via: "claude-code"`，idem = Claude Code 的 prompt id / 会话 + 时间）；取 `/v1/now?session=` 作为 `additionalContext`（含浮现）。斜杠命令只报不取 `<now>`。 |
| `Stop` | 等 transcript 停止变长，把没报过的行按 Soma `report.ts` 同一套映射报上去：`message.out`（文字块）、`tool.call`、`tool.result`。子代理（`isSidechain`）、合成消息（`<synthetic>`）、思考、附件、Claude Code 自己的元数据行不报。报到哪一行记在插件数据目录，按会话一份；idem 保证重报不重复。 |
| `SessionEnd` | 再同步一次。 |

- **失败就安静退出**（照 continuity）：Psyche 没开时 Claude Code 照常工作，hook 不能打断人。没报上的下次 `Stop` 接着报。
- 处境要先于事件到（Soma Reporter 的规矩）：每次报事件前先确认这个会话的处境报过。
- MCP：插件的 `.mcp.json` 起 `src/mcp.ts`（stdio），`PSYCHE_URL` / `PSYCHE_AGENT` / `PSYCHE_TOKEN` 从环境变量来。工具和 Soma 里一样全给。

## 二、写进记忆

- **热写**：Claude Code 自己压缩，Psyche 管不着；到收尾线它可以自己调 `hotwrite_segment` / `hotwrite`（工具一直在）。没写的那段 ≥3h 没动静由调度器叫「补写」——**补写推给 Soma 另开一段跑**，所以正式出生要有 Soma（家）。
- `<now>` 的内感受这一版不带上下文用量（Claude Code 没给 hook 用量；以后可从 transcript 的 usage 算）。

## 三、凭据遮掉（入库口，所有 harness 都走）

事件不可改，算向量还会把原文发出去；Claude Code 干活时工具输出里常有 token、key。所以在 `intake` 写库**之前**遮掉，原文从不落库：

- 认得出的：私钥块（`-----BEGIN … PRIVATE KEY-----`）、`sk-…` / `sk-ant-…`、`ghp_` / `gho_` / `github_pat_`、`AKIA…`、`xox[abp]-…`、`AIza…`、JWT（三段 base64url）、`Bearer <长串>`、`authorization:` 头、以及 `key / token / secret / password / passwd / api_key / cookie` 这类名字后面 `=` / `:` 跟着的长值。
- 换成 `[已遮：种类]`，不留前后缀；遮过的事件 payload 带 `redacted: n`（数字，给 Joy 看账，不写口吻）。
- 大块工具结果转进资料库前一样先遮。遮错了宁可多遮：错了它看得到「已遮」，知道那里原本有东西。
- 只是兜底，不是保证：认不出的格式照样会进去（`notes/` 里写明）。

## 四、正式出生前要定（Joy）

1. 出生信（Joy 自己写）。
2. 向量：云端（硅基流动 + 哪个模型）还是本地。遮凭据之后云端仍会收到工作内容（代码、文件内容的摘录）。
3. 数据目录与住户 id（如 `~/.psyche/data`、`claude`）；正式 Soma 从一代布局搬成住户（`move-in.sh`），补写才有地方跑。
4. ASCM 里这位 Claude 的旧库：和 Roy 一样当前世资料，只读，不导入。
5. 换装：全局停 `continuity@agent-continuity`、启 `psyche@psyche`（改 `~/.claude/settings.json`）。

## 五、没做

- 交接信、能力表（离开家时用）照 `lib-vs-harness.md`，这一版不做。
- 并行的子会话（start_session 起的）各是一个会话，照样报；它们互相发的消息（`<side-sessions-event>` 等）现在按 Joy 说的报——认不出来，先如实记 `via`。
