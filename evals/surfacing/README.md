# 浮现考卷

验证浮现（`notes/plan/m3.md`）。大纲与答案要点在 `key.md`（只给出题人和判卷人看）。

| 文件 | 是什么 |
|---|---|
| `key.md` | 剧本大纲与答案要点 |
| `script.json` | D7、D9、D10（D8 是"她没来"，没有对话）；接在冷写考卷 D1–D6 之后 |
| `shelf.json` | 冷写考卷 run2 里它自己写的书架，原样重放（不是我们写的） |
| `build.ts` | 底库：4 周基线（代码生成的模板台词，只撑统计）+ D1–D6 + 两次入睡的书架 + D7 |
| `a.ts` | 考卷 A：每题复制底库、补上那一刻的事件、dry 跑浮现，按 key.md 判 |
| `out/` | 临时库，gitignore |

## 考卷 A（不调对话模型；配了向量会花一点嵌入额度）

```sh
bun evals/surfacing/build.ts
SILICONFLOW_API_KEY=… PSYCHE_EMBED_URL=https://api.siliconflow.cn/v1 PSYCHE_EMBED_MODEL=BAAI/bge-m3 bun evals/surfacing/a.ts
```

不配向量也能跑（只用字面）。10-14：混合 7/7，只用字面 6/7（A3 "耳机"接不上）。

## 考卷 B（有 / 无浮现对照，`claude -p`，手动跑）

待写。
