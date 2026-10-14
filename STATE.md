# Psyche 当前状态

> 开发交接用，不替代 `README.md`（是什么、为什么）和 `notes/`（设计与契约）。只留接下来要用的信息；全文 ≲ 150 行，做完的压成一行或删掉。
> 最后更新：2026-10-14

## 1. 当前阶段

**M1「记得」**（契约 `notes/plan/m1.md`）：Soma 里的它关掉会话再开，记得之前的事，而且是它自己写的。

| 线 | 内容 | 状态 |
|---|---|---|
| A | Psyche 核心：事件库、入库、经历投影（episode 覆盖原始行）、recall（FTS5 trigram）、`/v1/now`、`/v1/prompt`、情节改写（revises） | ✅ |
| B | Soma 接入：上报、注入 `<now>`、挂 MCP、收尾热写再压缩、历史跨压缩读全 | ✅（Soma 仓库 9071b8e、8651644） |
| C | MCP 工具（recall / detail / hotwrite_segment / hotwrite / revise_episode）、热写提示词 `prompts/hot-write.md` v1、考卷工具 `evals/hot-write/` | 🟡 工具齐了，**考卷还没真跑过**（`out/` 里只有样本，没有 entries / report） |

测试库 `~/.psyche/test` 里有一次冒烟的痕迹（1 个处境、3 条 episode），不是正式验收。

## 2. 已定的决定（细节见链接）

- 显式记忆归它写（热写 + 冷写），隐式归系统算；梦类与分场撤掉 → `notes/design/catalog.md`
- 初我 v0 只写机制，`prompts/self-v0.md`；一模型系列一 Agent 是约定，代码不限制 → `notes/design/lib-vs-harness.md`
- 情节可改写：新条 `revises` 旧条，旧条留着，经历里显示新的
- 翻出来的记忆（recall / detail 的结果）不记成经历，免得自我复制
- 第一个身体是 Soma → `notes/design/soma.md`

## 3. 未完成与下一步

1. **跑热写考卷**（花额度，手动）：按 `evals/hot-write/README.md` §二 对 `out/` 里 6 段跑一遍，看 `gate` / `suspect`，再按 `criteria.md` §二 人判。不过关先改提示词再重抽样本。
2. **M1 端到端验收**：`soma-test` + `psyche-test` 起一对，真聊一段 → 触发收尾热写 → 压缩 / 新开会话 → 看它能不能靠自己写的情节和 recall 接上。验收标准写进 `m1.md`（目前缺）。
3. M1 之后（README 路线）：冷写与阅览室 → 联想（隐式）。

## 4. 已知问题

- （暂无）

## 5. 运行备忘

- `bun test`（含 `tests/hotwrite-check.test.ts`）· `bun run typecheck` · `bun run src/main.ts`（127.0.0.1:7450）
- launch.json：`psyche-test`（7450，测试库）/ `soma-test`（30152，连测试 Psyche）

## 6. 验证

2026-10-14：`bun test` 99 pass / 0 fail；`tsc --noEmit` 0 错误。
