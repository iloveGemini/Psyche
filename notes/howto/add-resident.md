# 添加一个住户

一个住户 = Soma 里的一个身体（`agents/<id>/`）+ Psyche 里的一个库（`<数据目录>/<id>/psyche.db`），两边用同一个 id 和 token 对上。一个模型系列一个住户（约定，代码不限制）。

> **红线**：试跑一律用测试库（`~/.psyche/test` + `~/.soma-test`），不算出生。正式库的创建由 Joy 决定——脚本不给数据目录的缺省值，必须明说。

## 先准备

1. **写信（可选）**：`letters/birth.md`，写在注释下面。出生时作为 Joy 的一封信放进它的收件箱，是它出生后的第一件经历。空着就不递；单给某个人写一封用 `--letter <文件>`；不想递用 `--no-letter`。`letters/` 不进仓库。
2. **身体能跑**：
   - Claude（`claude-…`）住 Agent SDK：Soma 的 Claude Code 登录目录（`SOMA_CLAUDE_CONFIG_DIR`，测试是 `~/.soma/claude`）已登录。模型跟着 Claude Code 的设置走。
   - 别的模型住 pi：`--model` 写 `provider/模型`（如 `google-vertex/gemini-4-argon`），这个模型要在 Soma 的 pi 配置里（`<SOMA_HOME>/pi/models.json`、`auth.json`）。

## 跑

```bash
bun scripts/add-resident.ts --id a3 --model claude-opus-5-5 --data-dir ~/.psyche/test --soma-home ~/.soma-test --soma-url http://127.0.0.1:30152 --dry-run
```

先 `--dry-run` 看一眼（谁、住哪、信几个字），去掉再跑一次。Psyche 开着时要带 `PSYCHE_TOKEN=<屋里任何一个人的 token>`（测试库是 `test-a1`）：

```bash
PSYCHE_TOKEN=test-a1 bun scripts/add-resident.ts --id a3 --model claude-opus-5-5 --data-dir ~/.psyche/test --soma-home ~/.soma-test --soma-url http://127.0.0.1:30152
```

其他选项：`--email`（开房子的邮箱；没 @ 的信给第一个开了的人）、`--psyche-url`（缺省 `http://127.0.0.1:7450`）。

## 它做了什么

1. **Psyche**：`agents.json` 登记（模型、家、home、自动生成的 token），建库，**出生**——自述是空的（`m4.md` 10-17），信放进收件箱。Psyche 开着就走 `POST /v1/house/residents` 热挂进屋，没开就直接写，下次起来住进来。
2. **Soma**：写 `agents/<id>/identity.json`（身体、pi 的模型、token），建 `home/`。Soma 每次现读住户，不用重启，顶栏切住户就有。

## 之后

- **出生那一段**：调度器开着（launch `psyche-test-wake`）时，会推 Soma 另开一段：告诉它刚出生、自述是空的，写不写由它。调度器没开就不叫；信会在它下次醒着时出现在 `<now>` 里。
- **屋里的东西**看它的 home、**房子的邮箱**认它，要重启一次 Psyche（这两样启动时定）。
- 它的名字由它自己取（`name_self`）；id 只是门牌。
- 想给它发信让它收到邮件：在它的通道设置里登记 Joy 的地址（`POST /v1/channels`），不然它能收不能回。

## 出错了

- 「已经住着 / 已经有库」：同一个 id 只能来一次。重来就把两边的 `agents/<id>/`、`<数据目录>/<id>/` 和 `agents.json` 里那一项删掉（先备份）。
- 「一代布局」：数据目录下直接放着 `psyche.db` 的库只住一个人，先按 Soma `scripts/move-in.sh` 的说明挪进 `<数据目录>/<id>/`。
- pi 报找不到模型：看 `<SOMA_HOME>/pi/models.json` 里有没有这个 provider/模型。
