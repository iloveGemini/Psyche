# mac：这台 Mac 上读得到的 Joy 那边

从 Roxy 搬来（`lib/lifecycle/presence.ts`、`weather.ts`、`screen-extension.ts`）。契约：`notes/plan/m8.md` §6.3（报进来）、§6.4（住户自己的感知设置）、§6.5（这一路）。

两样东西：

| | 是什么 | 怎么跑 |
|---|---|---|
| `feed.ts` | 常驻，每 30 秒看键鼠 / 锁屏 / 前台应用，每 30 分钟看天气，变了报 `POST /v1/house/percept` | launchd（见下） |
| `screen.ts` | MCP 服务，工具 `look_at_screen` | 地方按 `manifest.json` 挂（Soma 还不会读 manifest） |

## Joy 开放哪些：`~/.psyche/mac.json`

没有这个文件 = 全关。改了下一圈生效，不用重启。

```json
{ "desk": true, "app": true, "screen": false, "weather": { "latitude": 31.23, "longitude": 121.47, "place": "上海" } }
```

- `desk`：键鼠多久没动、屏幕锁没锁。不弹系统授权。
- `app`：前台应用的名字（不读窗口标题、网址），只在没锁屏、键鼠 2 分钟内动过时读。不弹系统授权。
- `screen`：住户调 `look_at_screen` 时截一张。要给跑它的程序开「系统设置 → 隐私与安全性 → 屏幕录制」；每看一次记进 `~/.psyche/mac-screen.jsonl`。
- `weather`：Open-Meteo，免 key；坐标是天气的地方，`place` 是说法。

## 试跑

```bash
PSYCHE_URL=http://127.0.0.1:7450 PSYCHE_TOKEN_FILE=… bun mcp/mac/feed.ts --once
```

## 常驻（launchd）

`~/Library/LaunchAgents/com.joy.psyche-mac.plist`：`ProgramArguments` = `bun` + 本目录的 `feed.ts`，`EnvironmentVariables` 写 `PSYCHE_URL`、`PSYCHE_TOKEN_FILE`，`KeepAlive` true。
