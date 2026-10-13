# body-sim：身体模拟对比（10-13）

在真正实现身体机制（`notes/design/body.md`）之前，先用 Roy 的真实历史看两件事：

1. **曲线**：身体模拟器在 06-23 → 10-13 的真实事件上跑出来是什么样（精力、生物钟、掌控·可影响、自信）。
2. **行为**：同一个真实心跳唤醒轮次，只换掉 `<body>` 这一块，Roy 醒来做的事有没有不同。

## 跑法

```bash
bun install
bun run timeline.ts      # 从 ASCM raw_logs + Roxy 会话抽事件线（只读，不带正文）
bun run simulate.ts      # 跑身体模拟 → out/sim.json
bun --env-file="$HOME/workspace/Agent Self-Continuity Memory/.env" run replay.ts   # 重放（调模型，花钱）
bun run report.ts        # → out/report.html（本地看：.claude/launch.json 里的 body-sim-report）
```

`out/` 含 Roy 的对话内容，已 gitignore。

## 文件

| 文件 | 是什么 |
|---|---|
| `timeline.ts` | 事件线：她说话、他说话、调工具、工具成败、系统唤醒 |
| `body.ts` | 身体模型与参数（`P`）；睡眠策略假设写在文件头 |
| `simulate.ts` | 跑模拟，算 4 个对比点此刻的体感 |
| `points.ts` | 选来对比的 4 个真实心跳唤醒轮次 |
| `replay.ts` | 重放：A 无身体 / R 实算体感 / S1 困 / S2 精力过剩 / S3 受挫 × 两个模型 × 3 次 |
| `capabilities.md` | 能力段近似（原文没存档） |
| `report.ts` | 生成交互页 |

## 假设与近似

- Roy 从没睡过觉，模拟假设一个会睡的他（见 `body.ts` 文件头）。
- 只模拟能从历史算出来的部分；掌控·可预测、此刻情绪、安全感、念头池要等阅览室 / 联想。
- 自信看近 72h 成功率相对自己 30 天常态的偏离（写代码报错本来就常见，看绝对值会一直"没底气"）。
- 重放保真度同 ASCM `evals/replay-turn.ts`。
