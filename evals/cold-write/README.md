# 冷写考卷

验证冷写（`notes/design/catalog.md` §三，契约 `notes/plan/m2.md`）：剧本化的 6 天对话，埋好规律、分化、明说的规矩、事实改写、镜子和陷阱，两次入睡，看它归纳出什么。**判内容，不判文风；不给范文。**

| 文件 | 是什么 |
|---|---|
| `key.md` | 剧本大纲与答案要点。**只给出题人和判卷人看，不进它的输入** |
| `criteria.md` | 判据：系统闸 / 对答案要点 / 人判 |
| `script.json` | 剧本：虚构的「阿禾」，双方台词都是写好的；每行 `[时刻, her/me, 正文]`，时刻倒退 = 过了零点 |
| `build.ts` | 入临时库（`out/psyche.db`）到某次入睡为止（幂等，测试在 `tests/coldwrite-build.test.ts`） |
| `out/` | 临时库与产出，gitignore |

## 跑法（花 Joy 的额度，手动跑）

```sh
bun evals/cold-write/build.ts --until s1 --fresh
PSYCHE_DATA_DIR=evals/cold-write/out PSYCHE_PORT=7451 bun run src/main.ts   # 另开一个终端，跑着别关
PSYCHE_URL=http://127.0.0.1:7451 bun run src/sleep.ts --model <Soma 用的模型> --at "2026-10-08 03:00" --log evals/cold-write/out/s1.jsonl
bun evals/cold-write/build.ts --until s2   # 接着入 D4–D6，睡 1 的书架留着（Psyche 不用停）
PSYCHE_URL=http://127.0.0.1:7451 bun run src/sleep.ts --model <同上> --at "2026-10-11 03:00" --log evals/cold-write/out/s2.jsonl
curl -s http://127.0.0.1:7451/v1/shelf | jq     # 看书架；每次判了什么在 GET /v1/events?kinds=semantic.evidence
```

Gemini 用 `evals/vertex-sleep.ts` 代替 `src/sleep.ts`（参数相同，要 `VERTEX_API_KEY` / `VERTEX_BASE`，见 `evals/vertex.ts`）；首跑见 `evals/argon-run1.md`。

然后对 `key.md` 的答案要点、`criteria.md` 人判。`s*.jsonl` 是无头会话的全程（它 recall 了什么、被拒过几次）。

**剧本不是它的经历**：它那一侧的台词是我们写的（镜子要埋"它的做法"），只进临时库，绝不进 `~/.psyche/test`。
