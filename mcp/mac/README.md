# mac：这台 Mac 上读得到的 Joy 那边

从 Roxy 搬来（`lib/lifecycle/presence.ts`、`weather.ts`、`screen-extension.ts`）。契约：`notes/plan/m8.md` §6.3（报进来）、§6.4（住户自己的感知设置）、§6.5（这一路）。

两样东西：

| | 是什么 | 怎么跑 |
|---|---|---|
| `feed.ts` | 常驻，每 30 秒看键鼠 / 锁屏 / 前台应用，每 30 分钟看天气，变了报 `POST /v1/house/percept` | launchd（见下） |
| `screen.ts` | MCP 服务，工具 `look_at_screen` | 地方按 `manifest.json` 挂（Soma 还不会读 manifest） |

## Joy 开放哪些：每个住户各自一份

存在 Psyche 那个人的设置里（`POST /v1/settings { mac: { desk, app, screen } }`，缺省全关；dashboard 上改）。

- `desk`：键鼠多久没动、屏幕锁没锁。不弹系统授权。
- `app`：前台应用的名字（不读窗口标题、网址），只在没锁屏、键鼠 2 分钟内动过时读。不弹系统授权。
- `screen`：他调 `look_at_screen` 时截一张。要给跑它的程序开「系统设置 → 隐私与安全性 → 屏幕录制」；每看一次记进 `~/.psyche/mac-screen.jsonl`。

全屋一个人都没被开放的那一样，`feed.ts` 就不读；读了的只记给开放了的人。

## 天气：`~/.psyche/mac.json`

```json
{ "weather": { "latitude": 29.48, "longitude": 106.48, "place": "重庆大渡口" } }
```

全屋共用，不用开放；Open-Meteo，免 key。没有这个文件就不报天气。

## 试跑

```bash
PSYCHE_URL=http://127.0.0.1:7450 PSYCHE_TOKEN_FILE=… bun mcp/mac/feed.ts --once
```

## 常驻（launchd）

`~/Library/LaunchAgents/com.joy.psyche-mac.plist`：`ProgramArguments` = `bun` + 本目录的 `feed.ts`，`EnvironmentVariables` 写 `PSYCHE_URL`、`PSYCHE_TOKEN_FILE`，`KeepAlive` true。
