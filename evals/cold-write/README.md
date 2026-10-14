# 冷写考卷

验证冷写（`notes/design/catalog.md` §三，契约 `notes/plan/m2.md`）：剧本化的 6 天对话，埋好规律、分化、明说的规矩、事实改写、镜子和陷阱，两次入睡，看它归纳出什么。**判内容，不判文风；不给范文。**

| 文件 | 是什么 |
|---|---|
| `key.md` | 剧本大纲与答案要点。**只给出题人和判卷人看，不进它的输入** |
| `criteria.md` | 判据：系统闸 / 对答案要点 / 人判 |
| `script.json` | 剧本：虚构的「阿禾」，双方台词都是写好的；每行 `[时刻, her/me, 正文]`，时刻倒退 = 过了零点 |
| `build.ts` | 入临时库到某次入睡为止（幂等，测试在 `tests/coldwrite-build.test.ts`） |
| `out/` | 临时库与产出，gitignore |

## 跑法

```sh
bun evals/cold-write/build.ts --until s1 --fresh   # D1–D3 入 out/exam.db
# 睡 1：src/sleep.ts（待写，m2 §六）对着 out/exam.db 起 Psyche，它调 coldwrite
bun evals/cold-write/build.ts --until s2           # 接着入 D4–D6，睡 1 的书架留着
# 睡 2：同上
```

**剧本不是它的经历**：它那一侧的台词是我们写的（镜子要埋"它的做法"），只进临时库，绝不进 `~/.psyche/test`。
