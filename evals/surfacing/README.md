# 浮现考卷

验证浮现（`notes/plan/m3.md`）。大纲与答案要点在 `key.md`（只给出题人和判卷人看）。

| 文件 | 是什么 |
|---|---|
| `key.md` | 剧本大纲与答案要点 |
| `script.json` | D7、D9、D10（D8 是"她没来"，没有对话）；接在冷写考卷 D1–D6 之后 |
| `run3.md` | D10 之后入睡（统计题）首跑 |
| `shelf.json` | 冷写考卷 run2 里它自己写的书架，原样重放（不是我们写的） |
| `episodes.json` | 剧本会话的情节：Opus 5.5 按热写提示词无头补写（它本人写的），原样重放 |
| `hotwrite.ts` | 生成 `episodes.json`（花额度，剧本不改不用重跑） |
| `build.ts` | 底库：4 周基线（代码生成的模板台词，只撑统计）+ D1–D6 + 两次入睡的书架 + D7 + 情节 |
| `a.ts` | 考卷 A：每题复制底库、补上那一刻的事件、dry 跑浮现，按 key.md 判 |
| `b.ts` | 考卷 B：有 / 无浮现两组推同一轮，打印回复与它调的工具 |
| `out/` | 临时库，gitignore |

## 考卷 A（不调对话模型；配了向量会花一点嵌入额度）

```sh
bun evals/surfacing/build.ts
SILICONFLOW_API_KEY=… PSYCHE_EMBED_URL=https://api.siliconflow.cn/v1 PSYCHE_EMBED_MODEL=BAAI/bge-m3 bun evals/surfacing/a.ts
```

不配向量也能跑（只用字面）。10-14：混合 7/7，只用字面 6/7（A3 "耳机"接不上）。
借 ASCM 改（回忆只给情节、空档输入不匹配内容、实词）后仍 7/7，A6 第二轮的噪声没了。

## 考卷 B（有 / 无浮现对照，`claude -p`，手动跑）

```sh
（同上的嵌入环境变量）bun evals/surfacing/b.ts --model claude-opus-5-5 --n 3 [--only B2]
```

每题起一个只读这份库的 Psyche（端口 7460 起），它能自己 recall / detail / shelf。结果在 `out/b/`。首跑见 `run1.md`。

## D10 之后入睡（统计题，`claude -p`，手动跑）

```sh
bun evals/surfacing/build.ts --full                  # out/full.db：底库 + D9、D10
cp evals/surfacing/out/full.db evals/surfacing/out/s3/1/psyche.db
PSYCHE_DATA_DIR=evals/surfacing/out/s3/1 PSYCHE_PORT=7471 bun run src/main.ts   # 另开终端
PSYCHE_URL=http://127.0.0.1:7471 bun run src/sleep.ts --model claude-opus-5-5 --at "2026-10-17 03:00" --log evals/surfacing/out/s3/1/sleep.jsonl
```

D9、D10 的情节已在 `episodes.json`；剧本改了才用 `hotwrite.ts --only sf-d9,sf-d10` 重补。首跑见 `run3.md`。
