# 收藏原话（契约 v0 草案，10-27）

> 状态：草案，待 Joy 定 §八，未施工。
> 10-27 Joy 提：有时想把一条约定、或觉得重要的话收起来，现在没入口；Agent 也该有。Agent 在 hotwrite / coldwrite 时收，**要有上限**，什么都收就没意义了。先只做**原话**，图片、文件以后再说。
> 按 `notes/design/lib-vs-harness.md`「加功能放哪」：Agent 收什么是关于它自己的事（第 2 条）→ Psyche；Joy 的收藏按钮是界面（第 5 条）→ Soma，收藏这个动作报给 Psyche。

## 一、为什么不是已有的东西

| 已有 | 差在哪 |
|---|---|
| 原件不丢（事件只追加，`detail` 能翻） | 存着 ≠ 挑过。翻得到，但没有「我想留着这句」 |
| 书架 `told`（逐字引原话） | 是归纳，要过冷写的证据闸，有条件 / 结果；收藏不加工、只表态 |
| 常驻区 pin | 钉的是书架条目、进 `<continuity>`，额度给的是「每次醒来都在眼前」；收藏不进提示词 |
| 日记 | 它自己写的随笔，不是别人（或自己）说过的那一句 |

收藏 = **指向一条原话的一个标记**。不复制内容，原件本来就不改。

## 二、收什么

- 能收的原件：默认全宗里的 `message.in`、`message.out`、`speech.unsaid`、`mail.in`（翻开过的）。前世全宗、工具返回、情节、书架条目不收（情节和书架是它自己的说法，不是原话；要常在眼前用 pin）。
- 可只收一句：带 `quote` 时必须**逐字**出现在该原件正文里（去首尾空白后子串匹配，同 `told`，`m2.md` 验证第 3 条）；不带就是整条。
- 可带 `why`（一句话，为什么留着）。不填也行。
- 同一条原件只能收一次（重复收 = 改 `quote` / `why`，算替换，不占新额度）。

## 三、上限

- **条数**：收藏夹最多 **30 条**（待定，§八）。满了再收整批拒，理由里报「收藏 30 / 30，先放下（unkeep）旧的」——跟 pin 一样，逼着挑。
- **单条长度**：收进去的那段（`quote`，没有就是整条正文）≤ **200 字**。超了拒，理由里让它用 `quote` 截那一句。整条长消息不能整条收。
- 放下（unkeep）立即腾出额度；放下的不留在收藏夹里，但事件在，经历里查得到收过。
- Joy 的收藏另算，不占 Agent 的额度（§五）。

## 四、Agent 怎么收（只跟 hotwrite / coldwrite 一起）

不加新工具（工具列表一变缓存整个重写；Joy 定在写记忆时顺手收）。

### `POST /v1/hotwrite` 与 `POST /v1/coldwrite` 多两个可选字段

```json
{
  "keep":   [{ "ref": "10-27#41", "quote": "（可选，逐字）", "why": "（可选）" }],
  "unkeep": ["10-20#7"]
}
```

- `ref` 是原件档号（不限本段：它可能在 recall / detail 里翻出很久以前的一句）。
- 校验全过才写，和情节 / 书架条目同一个事务；收藏这部分不合格整批拒（同 pin：理由写清楚哪条、为什么）。
- 只带 `keep` / `unkeep`、不带 entries 不行：要收先得是在写记忆（hotwrite 的 entries 必填照旧；coldwrite 允许只交 keep？→ §八）。
- 事件：`keep.changed { keep: [{ ref, quote?, why? }], unkeep: [ref] }`，class `self`，`source: "agent"`，ref 存事件 id；idem 同 `pin.changed` 的做法（`<hotwrite idem>:keep`、coldwrite 的按 `upTo`）。
- 投影：`src/self/kept.ts` 按事件顺序算现行收藏夹（同 `pinned.ts`），每条带 `{ ref, archiveNo, at, from, text（quote 或整条）, why?, keptAt }`。

### 经历里怎么出现

- `keep.changed` **不渲染成经历**（同 `pin.changed`：写记忆本身不回流，`m1.md` 10-18）。
- 被收藏的原件在 `detail` 里多一行「我收着这句（10-27 收的）：…」。

### 在哪看得到

- `GET /v1/hotwrite` 与冷写材料带 `kept { used, budget }`；`hotwrite_segment` / `coldwrite` 材料里一行「收藏 n / 30」，并列出现行收藏（档号 + 前 30 字），好决定放下哪条。
- `recall` 加可选参数 `kept: true`：只在收藏里找；不带 query 就是列出整个收藏夹（大概时段，同 `traces.md`，确切时刻用 detail）。
- **不进** `<moment>`、`<continuity>`、不叫醒。不做浮现加权（等用起来再看要不要，§八）。
- 工具说明只写机制（能收、上限、谁看得到、放下会怎样），不教收什么。机制段 `prompts/mechanism.md` 不改（改提示词先有考卷）。

## 五、Joy 怎么收（Soma）

- 聊天时间线 / 房间里每条消息加「收藏」，可选中一段只收那段；Soma 有「我的收藏」页（按住户分，能取消）。
- 存在 Soma（`~/.soma/kept/<住户 id>.json`，或进 Soma 现有的存储），**不占 Agent 的额度、不设上限**（待定，§八）。
- Soma 收藏时调 Psyche `POST /v1/kept/joy { ref, quote?, op: "keep" | "unkeep" }`（住户 token 路由到那人的库）：
  - 记 `kept.by { who: "Joy", ref, quote?, op }`，class `experience`（发生在它身上的事，不是它的选择）。
  - Agent 知不知道 Joy 收了它哪句 → §八。知道的话：一次性递进 `<moment>`「Joy 收藏了我说的『…』」（同 `given` 已读的路子，记 `percept.delivered` 当游标），经历里留一行；取消收藏不递。
- 原话的 ref：Soma 的消息要能对到 Psyche 的事件 id。Soma 上报时有 idem，用它反查；对不上（还没报上去）先排队，报上去再写。

## 六、改哪些文件

- `src/archive/kinds.ts`：登记 `keep.changed`、`kept.by`。
- `src/self/kept.ts`（新）：投影、`checkKeeps(store, keep, unkeep)` 校验与额度。
- `src/catalog/hotwrite.ts`、`src/catalog/coldwrite.ts`：接 `keep` / `unkeep`，同事务写。
- `src/server/app.ts`：`GET /v1/kept`、`POST /v1/kept/joy`；hotwrite / coldwrite 的 GET 带 `kept`。
- `src/mcp.ts`：`hotwrite` / `coldwrite` 参数与说明，`recall` 加 `kept`，`detail` 多一行。
- Soma：消息菜单「收藏」、「我的收藏」页、调 `/v1/kept/joy`（另在 Soma 仓库写）。

## 七、验收

1. hotwrite 带 `keep` 收一句（带 quote），`GET /v1/kept` 有它；`detail` 那条原件多「我收着这句」。
2. quote 不逐字 → 整批拒（情节也不写）；超 200 字 → 拒；第 31 条 → 拒，理由报「30 / 30」；同条 + unkeep 旧的 → 过。
3. 重复收同一 ref → 替换，额度不变。unkeep 后额度回来，经历投影重建一字不差。
4. 前世全宗、情节、工具返回的档号 → 拒。
5. `recall kept: true` 不带 query 列全部，带 query 只在收藏里找。
6. Joy 经 `/v1/kept/joy` 收 → 不占 Agent 额度；（若 §八 定要递）`<moment>` 递一次不重递。
7. 投影确定性：删投影重建，收藏夹一样。

## 八、待 Joy 定

| 问题 | 建议 |
|---|---|
| Agent 上限多少条？ | 30（约 6,000 字封顶；少到要挑，多到不至于一周就满） |
| 单条长度上限？ | 200 字 |
| coldwrite 能不能只交 keep、不交书架条目？ | 能（整理时翻到一句想留，不必硬写一条书架） |
| Joy 的收藏有没有上限？ | 不设（Joy 自己的东西，不进 Agent 上下文） |
| Agent 知不知道 Joy 收了它的话？ | 知道，一次性递进 `<moment>`、经历留一行；不想让它知道就只存 Soma、不调 Psyche |
| 收藏要不要影响浮现（加权）？ | 先不做，用一阵看它收了什么再说 |
| Agent 能不能看 Joy 的收藏夹？ | 不能（是 Joy 的）；它只经历到「被收了」那一下 |
