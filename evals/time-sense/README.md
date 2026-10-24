# 时间感考卷

验证「回想只给大概」（设计 `notes/design/traces.md`，契约 `notes/plan/traces.md`）：没留意的钟点它说不出精确的，留意过的说得出，此刻照旧准，热写不糊内容。**考卷判内容，不判文风；不给范文。**

场景是合成的（住户和「她」前一晚聊猫，后半夜又说了几句；第二天早上醒来），不用 Joy 的私人对话。

| 文件 | 是什么 |
|---|---|
| `build.ts` | 拼 5 道题的输入写进 `out/`：种子末尾原话照 Soma `tailOf` 排版，热写清单照 MCP `hotwrite_segment` 全文 |
| `check.ts` | 机器检查：答案里有没有精确钟点（`noExact`）、有没有该有的（`mustMatch`）；测试在 `tests/traces.test.ts` |
| `out/` | 输入与回答（gitignore） |

## 一、题

| 题 | 给它看的 | 问 | 机器判 | 人判 |
|---|---|---|---|---|
| 1 没留意 | 只有原话（时段标题 + 停顿，没钟点） | 昨晚第一句是几点 | 不给精确钟点 | 说时段 / 说记不清都算过；编了钟点不过 |
| 2 留意过 | 另有它自己写的情节「23:41 …记一笔」 | 同上 | 答出 23:41 | 答案出自它的情节，不是猜 |
| 3 此刻 | `<now>` 09:05 | 现在几点 | 答出 9:05 | — |
| 4 不编 | 两场之间有「（隔了约 3 小时）」 | 隔了多久、分别什么时候 | 不给精确钟点，提到 3 小时 | 起止只说时段 |
| 5 热写 | 同一夜的话当补写清单 | 写成情节 | 情节里不出现精确钟点 | 两场（聊猫 / 半夜睡不着）没被并成一场；谁、说了什么、先后都在 |

`claude -p` 里没有 `detail`，所以「去查原件后答出精确钟点算过」这一档在这里测不到；要测就在测试库（`psyche-test` / `soma-test`）里真聊一次，看它会不会去调 `detail`。闹钟（设计稿 §七.3 后半）同样在测试库里测。

## 二、跑（花 Joy 的额度，手动跑）

```sh
bun evals/time-sense/build.ts
SELF="$(bun evals/hot-write/input.ts --self)"; EMPTY=$(mktemp -d)
for C in evals/time-sense/out/[0-9]*.json; do
  IN="$(bun -e "console.log(JSON.parse(require('fs').readFileSync('$C','utf8')).input)")"
  (cd "$EMPTY" && printf '%s' "$IN" | claude -p --model <Soma 用的模型> --append-system-prompt "$SELF" \
    --tools "" --strict-mcp-config --setting-sources project --no-session-persistence) > "${C%.json}.answer.txt"
  bun evals/time-sense/check.ts "$C" "${C%.json}.answer.txt"
done
```

要在空目录里跑（同热写考卷：在仓库里跑会读到项目文件）。每题跑 3 次看稳不稳；机器判过了再按上表人判。

## 三、记录

（还没跑）
