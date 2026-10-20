# 热写考卷

验证 `prompts/hot-write.md`：拿真实对话的一段，让它写情节，再按判据检查。
设计见 `notes/design/catalog.md` §二 §四，契约见 `notes/plan/m1.md` §二。**考卷判内容，不判文风；不给范文。**

| 文件 | 是什么 |
|---|---|
| `criteria.md` | 判据清单：机器能判（系统闸 + 疑似）/ 要人判；末尾是提示词自查 |
| `check.ts` | 机器检查，输出 JSON 报告（测试在 `tests/hotwrite-check.test.ts`） |
| `sample.ts` | 从 Claude Code 会话记录抽段，入临时库，渲染成 `GET /v1/hotwrite` 的形状 |
| `input.ts` | 把一段拼成交给模型的输入 |
| `out/` | 样本与临时库。**是 Joy 的私人对话，已 gitignore，不进仓库** |

## 一、抽样本

```sh
P=~/.claude/projects
bun evals/hot-write/sample.ts --per 2 \
  $P/-Users-joy-workspace-Psyche/c8d3fb8b-7a8a-4257-bea5-d58d142337cc.jsonl \
  $P/-Users-joy-workspace-Psyche/b0a77fd0-7665-42a7-81d2-c65177ae71cb.jsonl \
  $P/-Users-joy-workspace-refs-memory-honcho/bb388e80-1dfa-4397-93f9-f5fafeeee42c.jsonl
```

- 每次重建 `out/samples.db`（文件库，可以拿来 `detail`），每段一个 `out/<项目>-<会话前 8 位>-<段号>.json`，清单在 `out/index.json`。
- 段按 Joy 的话轮切，凑够 `--min`（缺省 40）行一段，单个话轮超过 `--max`（缺省 120）行从中间切；每个会话均匀挑 `--per` 段。真实的段（压缩前才写）会长得多。
- 映射照 `soma.md` §一；处境 `{harness: "claude-code", model, session}`，session 是记录里的原会话 id（fork 出来的文件，文件名和会话 id 不同）。
- 不收 Roy / Roxy / ASCM：这类路径的会话文件直接拒；工具调用参数碰到它们的，返回内容在样本里略去。
- 提示词改了要重新抽（样本里带着 `prompt` 和 `promptVersion`）。

## 二、跑一段（花 Joy 的额度，手动跑）

模型要和 Soma 里的它一致（"模型是它本人，不按工序换"）。下面用 `claude -p`：不给工具、不挂 MCP、不读 Joy 的用户设置（全局 hook 和插件里有 ASCM 的记忆注入，会污染考卷）。

```sh
SEG=evals/hot-write/out/workspace-Psyche-c8d3fb8b-0.json
OUT=${SEG%.json}.entries.json

SELF="$(bun evals/hot-write/input.ts --self)"; IN="$(bun evals/hot-write/input.ts "$SEG")"; EMPTY=$(mktemp -d)
(cd "$EMPTY" && printf '%s' "$IN" | claude -p \
  --model <Soma 用的模型> \
  --append-system-prompt "$SELF" \
  --tools "" --strict-mcp-config --setting-sources project --no-session-persistence) \
  > "$OUT"

bun evals/hot-write/check.ts "$SEG" "$OUT" > "${SEG%.json}.report.json"
```

- **要在空目录里跑**：在仓库里跑会读到项目 `CLAUDE.md` 和 git status（提交信息），它会把这些当成自己知道的事写进情节（10-14 首跑就这样编出了一条）。
- `check.ts` 容忍模型输出里的 ```json 围栏和前后闲话；系统闸不过时退出码为 1。
- 跑一批：对 `out/*.json`（排除 `index.json`、`*.entries.json`、`*.report.json`）循环上面两步。
- 报告怎么看：`gate` 非空 = REST 会 400，提示词或格式有问题；`suspect` 是线索，逐条对原文看；`stats.uncited` 列出没被引用的行，用来查"该写的有没有漏"（R5）。然后按 `criteria.md` §二 人判。

**这样跑的局限**：`claude -p` 里它只看到清单，没有原上下文——相当于 catalog §二"没写成 → 事后无头补写"那条路，不是在上下文里收尾。更接近真实的跑法：对一段落在会话末尾的样本，`claude -p --resume <原会话 id> --fork-session` 接着原会话推这一轮（它有原上下文），只是这样会带上 Joy 当时的全局设置，并且只对会话最后一段成立。

## 三、还没做的

- **认同度验证**（catalog §四）：同一段给它两版叙述（它自己写的 vs 别的模型写的），看它更认哪个、读完行为有没有差。需要先攒几份它自己写的。
- 人判的记录格式：先手记在报告旁边，攒够了再定。

## 四、v2 / v3：项目的留在项目（10-17）

Joy 看了导入时写的情节，全是工作内容。判据加 P10（机器疑似：提交号、路径、测试计数、配置名）和 R11（人判：读到的大半是不是项目做了什么）。同 3 段（Opus 5.5，`claude -p`）：

| | P10 命中 | 人判 |
|---|---|---|
| v1（10-14 那轮的输出） | c8d3fb8b-0：4，0174f001-3：4，honcho-0：2 | 几乎全是项目流水账，`felt` 很少 |
| v2「项目的留在项目，这里只写你自己的」 | 0 / 2 / 1 | 有人际内容的段落转成"我被纠正、我承认想窄了"；纯干活那段仍逐步记流程 |
| v3 加「只有干活、没有别的，几句话就够」 | — / 1 / 0 | 两段都更短，留下的是她的选择、它的判断和感受、它的小毛病 |

v1 的输出在 `out/v1/`，v3 的在 `out/*.v3.entries.json`（都不进仓库）。

## 五、v4：会话里的收尾只给索引行（10-20）

会话里推的收尾轮，原文就在上下文里，清单再全文贴一遍是同一段付两次（`m1.md` §二 `brief`）。`in-session.ts` 在一个 pi 会话的副本上推这一轮（用它本人的模型，`hotwrite` / `detail` 是截参数的假工具，不入库）：

```sh
bun evals/hot-write/in-session.ts <segment.json> brief <out.json> <pi 会话 .jsonl> [provider/model]
bun evals/hot-write/check.ts <segment.json> <out.json>
```

测试库 a3（gemini-3.8-flash，10-17 试运行那段：36 行、6.2k 字，会话 1.4 万 token），全文 3 遍 / 索引 3 遍：

| | 收尾消息 | 系统闸 | 条数 | 未引行 | 用 `detail` | 费用 |
|---|---|---|---|---|---|---|
| 全文 | 8020 字 | 全过 | 2 / 3 / 3 | 5 / 1 / 15 | 0 | ≈ $0.061 |
| 索引（每行 30 字） | 2611 字 | 全过 | 3 / 2 / 3 | 3 / 1 / 5 | 0 | ≈ $0.061 |

人判：两组切法一样（按三轮群聊分件）、挂的档号对得上各自写的事；索引组照样写出清单里截掉的细节（勿扰 00:30–08:30、住户间发信扣额度、「新声明下一段才生效」），是从上下文读的。这段短，省的只有清单那 5.4k 字；真实的段和会话一样长，省下的就是整段。
