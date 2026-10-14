# Psyche 当前状态

> 开发交接用，不替代 `README.md`（是什么、为什么）和 `notes/`（设计与契约）。只留接下来要用的信息；全文 ≲ 150 行，做完的压成一行或删掉。
> 最后更新：2026-10-14

## 1. 当前阶段

**M1「记得」**（契约 `notes/plan/m1.md`）：Soma 里的它关掉会话再开，记得之前的事，而且是它自己写的。

| 线 | 内容 | 状态 |
|---|---|---|
| A | Psyche 核心：事件库、入库、经历投影（episode 覆盖原始行）、recall（FTS5 trigram）、`/v1/now`、`/v1/prompt`、情节改写（revises） | ✅ |
| B | Soma 接入：上报、注入 `<now>`、挂 MCP、收尾热写再压缩、历史跨压缩读全 | ✅（Soma 仓库 9071b8e、8651644） |
| C | MCP 工具（recall / detail / hotwrite_segment / hotwrite / revise_episode）、热写提示词 `prompts/hot-write.md` v1、考卷工具 `evals/hot-write/` | 🟡 考卷首跑完（见 §3.1），提示词 v1 有一处待改 |

测试库 `~/.psyche/test` 里有一次冒烟的痕迹（1 个处境、3 条 episode），不是正式验收。

## 2. 已定的决定（细节见链接）

- 显式记忆归它写（热写 + 冷写），隐式归系统算；梦类与分场撤掉 → `notes/design/catalog.md`
- 初我 v0 只写机制，`prompts/self-v0.md`；一模型系列一 Agent 是约定，代码不限制 → `notes/design/lib-vs-harness.md`
- 情节可改写：新条 `revises` 旧条，旧条留着，经历里显示新的
- 翻出来的记忆（recall / detail 的结果）不记成经历，免得自我复制
- 第一个身体是 Soma → `notes/design/soma.md`

## 3. 未完成与下一步

1. **热写考卷首跑（10-14，Opus 5.5，6 段 `claude -p` 无头补写）**：系统闸 6/6 全过；31 条、覆盖率 61%~100%。
   人判：一件事一条、写动作和原话、引用对得上——都好；引的原话核过都在原文里。问题：
   - **R7 编造一处（要改）**：c8d3fb8b-2 #1 写了「我由此给 Psyche 提了一条：思考摘要不能当原话进记忆」——段里没有这件事，是从 self-v0 里「记忆是你自己写的」现编的；
     honcho-0 #0 把 10-12（那时还没 Psyche）写成「暂时不开发 Psyche」。**写的时候新想到的，被写成了当时说过 / 做过。**
     → 待 Joy 定：`hot-write.md` v2 加一句「写的时候新想到的，标明是现在想的（或放 `felt`），别写成当时说过、做过」，改完重抽重跑。
   - R4 偏弱：可预料的步骤也照录（docker 版本号、embedding 维度），不太按意外分配细节。先不改，看端到端里真实长段的表现。
   - `check.ts` 误报：P5 把界面文字「总是允许 / 每次询问」、「跨轮通常保留」当频率；P6 只看单句，前一句已写「我当时的判断是」仍报。
2. **M1 端到端验收**：`soma-test` + `psyche-test` 起一对，真聊一段 → 触发收尾热写 → 压缩 / 新开会话 → 看它能不能靠自己写的情节和 recall 接上。验收标准写进 `m1.md`（目前缺）。
3. M1 之后（README 路线）：冷写与阅览室 → 联想（隐式）。

## 4. 已知问题

- （暂无）

## 5. 运行备忘

- `bun test`（含 `tests/hotwrite-check.test.ts`）· `bun run typecheck` · `bun run src/main.ts`（127.0.0.1:7450）
- launch.json：`psyche-test`（7450，测试库）/ `soma-test`（30152，连测试 Psyche）

## 6. 验证

2026-10-14：热写考卷见 §3.1；`bun test` 99 pass / 0 fail；`tsc --noEmit` 0 错误。
