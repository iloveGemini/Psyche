# Soma：第一个身体

> 2026-10-14 定。前置：`lib-vs-harness.md`（原则）、`catalog.md`（热写 / 冷写）、`channel-and-heartbeat.md`。
> 仓库：`~/workspace/Soma`。原则写在 `lib-vs-harness.md`，这里只写 Soma 和 Psyche 之间的契约。

## Soma 是什么

- 用 Agent SDK 常驻**一个** Claude Code 会话（streaming input，进程挂了按 `resume` 接回同一会话）。
- 前端从 Roxy 拷出聊天部分；事件总线协议同 Roxy 的 line-events。
- 独立配置目录 `CLAUDE_CONFIG_DIR=~/.soma/claude`：Joy 自己 Claude Code 的全局 hook、插件（包括 ASCM continuity）不在这里跑，Soma 的会话也不出现在那边。**Psyche 是它唯一的记忆**。
  - 试跑（launch.json 的 `soma-test`）也指向这个目录，为的是共用登录和 `settings.json`；会话记录按工作目录分开（`~/.soma/home` / `~/.soma-test/home` 各一个 `projects/` 子目录），状态跟 `SOMA_HOME` 走，记忆连测试库，所以不串。共用的只有设置、skills 和输入历史。
- 名字：Soma（希腊语"身体"）与 Psyche 成对。不是被搁置的那个"身体"（`body.md` 模拟生理）——这里的身体就是能力：Claude Code 的工具。

## 分工

| Soma（身体） | Psyche（本体） |
|---|---|
| 从 SDK 消息流上报事件 | 入库、档号、投影 |
| 每轮注入 `<now>`，会话开始注入系统提示词 | 组装器产出两者 |
| 通过 SDK 的 `mcpServers` 挂上 Psyche 的工具 | 提供工具：recall、写条目、冷写、改作息、收发信、换地方… |
| 接管压缩时机：快到阈值先让它热写，再压缩 | 热写时附本段档号清单；系统闸校验 |
| 进门 / 出门（位置租约） | 记它在哪；同一时间只在一处跑 |
| 被唤醒：收到 Psyche 的唤醒就开一轮 | 心跳调度、唤醒额度 |
| **不注入性格** | 性格只来自它自己的自述 |

## 一、上报

从 `session.ts` 的 `handle()` 里取，映射到已登记的 kind（`src/archive/kinds.ts`）：

| SDK 消息 | 事件 | 幂等键 |
|---|---|---|
| 她说的话（`say`） | `message.in`（from: Joy，via） | `said.id` |
| assistant 文本（整段，非 delta） | `message.out` | 消息 uuid + 块序号 |
| `tool_use` | `tool.call` | tool_use id |
| `tool_result` | `tool.result`（大块自动转资料库） | tool_use id + `:result` |
| `system/init`（模型、权限模式）、提示词变化 | `POST /v1/situation`（harness: soma、模型、harness 提示词哈希） | 只在变化时写 |

- 思考（thinking）先不上报：它是过程，不是经历。要不要收，等热写跑起来再看它用不用得上。
- 子代理内部步骤不上报（Soma 前端也不显示），只报那一次工具调用和结果。

## 二、注入

- **系统提示词**（变化慢）：自述、明说的规矩、经验触发条件、馆藏地图摘要。~~用 `appendSystemPrompt` 挂在 Claude Code 预设之后~~ **10-14 改**：不再用预设——SDK 预设的身份句是"和用户一起朝用户的目标做事"，还带一节 Claude Code 自己的文件记忆。现在整段是字符串：**它自己那段在前**（Psyche `/v1/prompt`），**地方的在后**（Soma `lib/soma/harness-prompt.ts`：这是哪、有什么 + 预设里工具与执行规则的原文快照，只删不改）。`autoMemoryEnabled: false`。地方提示词的 sha256 记进处境 `harnessPrompt`，正文进资料库；它自己那段的版本记 `selfPromptVersion`。
- **`<now>`**（每轮）：经 `UserPromptSubmit` hook 的 `additionalContext` 注入；被唤醒那一轮直接作为输入的一部分。
- Soma 自己的 `CLAUDE.md` / 项目文件只写"这是哪、有什么"，**不写性格**（`lib-vs-harness.md` 红线）。

## 三、热写与压缩

- 关掉自动压缩（`autoCompactEnabled: false`），Soma 用 `getContextUsage()` 盯用量。
- 到阈值：先推一轮"收尾"——带上 Psyche 给的本段清单，让它写情节条目（经 MCP 写入）；写完再触发压缩。
- 兜底：`PreCompact` hook（万一压缩不是 Soma 触发的）、会话被关时事后无头补写（`catalog.md` §二）。
- 阈值先用 Roxy 的经验值，跑起来再调。

## 四、位置与唤醒

- Soma 一个常驻会话，天然只在一处。开一轮前向门户"进门"；它在别处（如 Roxy）进不来，Soma 这边就退化成通道：显示"它在 Roxy"，她的话变 `mail.in`（`channel-and-heartbeat.md` §三）。
- 唤醒：Psyche 的心跳决定醒，经 Soma 的接口推一轮进来。Soma 是第一个能被无头唤醒的地方，能力表里登记。

## 待查（实现前验证）

- `autoCompactEnabled` / `autoCompactThreshold`、`getContextUsage()`、`PreCompact` 在 streaming 会话里的实际行为。
- `appendSystemPrompt` 与 `snapshot: true` 的关系：系统提示词被"录下来"后，自述改了要到下次压缩才生效——可以接受（人改习惯也不是即刻），但要让它知道。
- Soma 的 line 状态字段叫 `roy`（从 Roxy 拷来）；它出生时没有名字，这里改成中性的名字。
