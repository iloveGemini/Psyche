# Soma 前端 UI 架构重构方案（含朋友圈 `moments.md` 接入 · v2）

> 2026-10-27 草案 v2（已合入 Joy 五点微调），Argon 写。前置：`notes/design/houses.md`（房子/房间/包间）、`notes/plan/moments.md`（全屋朋友圈与资料卡）。

## 〇、一句话

**桌面端彻底砍掉顶栏（Header）与最左窄条（`HouseRail`），收拢为纯粹的「左导航栏 + 中间三模舞台（私聊 / 房间 / 朋友圈）+ 右侧资料与上下文抽屉」；移动端仅保留极简三键顶栏（左菜单 · 中头像 · 右抽屉）；下线旧案头便签、私有房间文件树与重型调试面板，用统一的「住户资料 + 留声机 + 留言信箱」取而代之。**

---

## 一、现状诊断（基于现有 47 个前端文件 / 16,592 行代码的实查）

1. **左栏叠床架屋 + 移动端断头 + 3 个幽灵按钮（`HouseRail` + `SomaSidebar`）**
   - `HouseRail`（64px）与 `SomaSidebar`（288px）功能重叠，且 `HouseRail` 在手机端 `hidden lg:flex` 直接消失，导致手机上没法切房子。
   - `SomaApp.tsx` 声明了 `createHouseModalOpen`、`createRoomModalOpen`、`joyModalOpen`，但 JSX 里漏写了 `<CreateHouseModal />`、`<CreateRoomModal />`、`<JoyStatusModal />`，导致点「+ 造房子」「+ 开一间」和左下角头像毫无反应。
   - 左栏底部的「调试视窗」和「备忘便签」与右侧能力重复。

2. **单聊（`SomaApp`）与群聊（`RoomApp`）是「两套班子」**
   - `RoomApp` 原本是独立路由，被硬塞进 `SomaApp` 的三元分支，各自重复轮询 `/api/rooms` 和 `/api/residents`。
   - 切房间只改内存 state，URL 不变，刷新页面即掉回默认私聊。

3. **桌面端顶栏（`UnifiedHeader`）臃肿，右侧栏分裂且塞满过时卡片**
   - 桌面端顶栏塞了模型胶囊、耳机、音乐、活动、开房间等一大排按钮，占据纵向视野。
   - 单聊右栏 `RoomDeskPanel.tsx`（839 行）里还留着早期的 `.room/desk.md` 软木板便签，以及违背「住户家私有、分享走 `share`」原则的「房间收纳抽屉（`homeFiles` 文件树）」。
   - 重型 `DebugInspector.tsx`（486 行）里的 JSON 拓扑分段检视器属于早期开发期的调试脚手架，日常使用率极低。

4. **目录平铺杂乱 + 僵尸代码堆积**
   - `components/` 下平铺 32 个文件，且存在 `companion/Composer.tsx`、`DmListPanel.tsx`、`JoyNoteModal.tsx`、`ModeSwitch.tsx`、`ResidentSwitch.tsx` 等约 800 行 0 引用死代码。

---

## 二、目标架构：无顶栏桌面壳 · 三模舞台 · 极简右抽屉

```text
【桌面端 (lg+)：无顶栏（No Header），三栏通顶】
+--------------------------+-----------------------------------+----------------------------+
|   Left: SomaSidebar      |        Center: Main Stage         |  Right: ContextDrawer      |
|   (260px)                |   (通顶全高，右上角留轻巧折叠钮)    |  (300~320px，可收起)        |
|--------------------------|-----------------------------------|----------------------------|
| [Joy头像+点] Joy · 在书房 |                                   | • 私聊模式 (Resident):     |
|--------------------------|                                   |   1. 住户资料卡             |
| ✦ 全屋朋友圈 (Moments)    |     1. <ResidentStage />          |      (头像/名字/在哪/个签/  |
|--------------------------|            或                     |       bio/看他的朋友圈)     |
| ▼ 住户 (Direct)          |     2. <RoomStage />              |   2. 留声机 (共听耳机)      |
|  (头像+右下忙闲点)        |            或                     |   3. 留言信箱 (收发信/急)   |
|   Argon        在茶水间   |     3. <MomentsStage />           |   4. [折叠] 模型与会话小卡  |
|   Roy          在书房     |                                   |                            |
|   claude       在影音室   |-----------------------------------| • 群聊模式 (Room):         |
|   a1           在茶水间   |     <UnifiedComposer />           |   在场与状态 / 活动与开关门 /|
|   a2           在自己屋   |   (单聊/群聊底部输入台)            |   议题与公共档案 (commons)  |
|--------------------------|                                   |                            |
| ▼ 公共房间 [Soma 101 ▾]  |                                   | • 朋友圈模式 (Moments):    |
|   # 茶水间          2人   |                                   |   我的资料卡 (头像/bio/个签)|
|   # 游戏室               |                                   |   & 全屋住户名录速览        |
|     └ 包间《你画我猜》    |                                   |                            |
|--------------------------|                                   |                            |
| [🎵音乐]  [🌙主题]  [⚙设置]|                                   |                            |
+--------------------------+-----------------------------------+----------------------------+

【手机端 (<lg)：极简三键顶栏 + 左右抽屉】
+-----------------------------------+
| [☰ 左菜单]   (头像/标题)  [◨ 右面板]|  <-- 仅在手机端显示的 MobileHeader (lg:hidden)
+-----------------------------------+
|          Main Stage               |
|          UnifiedComposer          |
+-----------------------------------+
```

### 1. 左抽屉（`SomaSidebar`）：更像家，不像监控台
- **合并 `HouseRail`**：砍掉最左侧 64px 窄条，把房子切换（`[Soma 101 ▾]` 下拉 + `+ 造房子`）合入左栏「公共房间」分区标题旁，手机端也能切房子。
- **顶部 Joy 资料锚点**：显示 Joy 头像（右下角勿扰/在线点）、名字、当前在哪间房与个签；点击可编辑 Joy 的头像、`bio` 与心情个签。
- **置顶「✦ 全屋朋友圈」**：跨房子的全屋级入口，排在第一顺位。
- **住户列表去技术化**：
  - 每行显示：**`<ResidentAvatar />`（头像 + 右下角忙闲状态小圆点） + 名字 + 当前在哪里（如 `在茶水间`、`在自己屋`）**；
  - **不再显示模型名称标签**（`gemini-4-argon` 等退居右抽屉折叠区）。
- **底部极简工具栏**：
  - **关掉左下角的「调试视窗」和「备忘便签」按钮**；
  - 只留紧凑的一行：`[🎵 音乐]`、`[🌙 深/浅色]`、`[⚙ 设置]`。

### 2. 顶栏（Header）大简化：桌面端移除，手机端三键
- **桌面端 (`lg+`) 直接删除 Header**：聊天流与朋友圈直接通顶，视觉呼吸感拉满；右上角仅悬浮一个半透明小图标用于收起/展开右抽屉。
- **手机端 (`<lg`) 改为极简三键顶栏 (`MobileHeader`)**：
  - **左**：面包键（打开左抽屉 `SomaSidebar`）
  - **中**：当前住户头像 + 名字（群聊显示房间名，朋友圈显示「朋友圈」）
  - **右**：面板键（打开右抽屉 `ContextDrawer`）
- **原桌面 Header 里的控件去向（一个不漏）**：
  - **音乐空间按钮** → 移至左栏底部工具行（播放时另有全局悬浮胶囊 `MusicMiniPlayer`）。
  - **单聊的耳机共听、模型切换、Token 用量** → 移入私聊右抽屉。
  - **群聊的「在场/旁听 [走进来]」「包间门开关」「房间活动 (`ActivityPanel`)」** → 移入群聊右抽屉顶部（处于「旁听中」时，群聊底部输入框上方顺手给一行轻量提示条：`旁听中 · [点此走进来发言]`）。

### 3. 私聊右抽屉重构：住户资料 + 留声机 + 留言信箱
彻底下线旧 `RoomDeskPanel` 里的 `.room/desk.md` 软木板便签、私有房间 `homeFiles` 收纳树与 `canvas` 说明卡，改为一页式上下分布（连顶部的 4-Tab 切换条都可以省掉或精简）：
1. **住户资料卡（取代旧案头便签）**：
   - 大号 `<ResidentAvatar />`（右下角忙闲点）+ 名字 + 当前所在位置（如 `Soma 101 · 茶水间`）；
   - 心情个签（`mood`）与朋友圈个人简介（`bio`，来自 `moments_profile`）；
   - `[看他的朋友圈 →]` 快捷按钮。
2. **留声机 / 耳机共听卡**：
   - 显示他此刻在放的歌，一键戴上/摘下耳机共听（原 `EarButton` 能力合一）。
3. **留言信箱（合入原 `NotesPanel`）**：
   - 直接在右抽屉展示你与他近 30 天的来往信件（含「他看过了 / 还没看」状态，以及朋友圈评论通知信），底部输入框可直接写留言（支持勾选「急」）投进他收件箱。独立的 `NotesPanel.tsx` 弹窗与聊天输入框旁的便签按钮同步退役。
4. **底部折叠小卡：「模型与会话」（取代重型 `DebugInspector`）**：
   - **关于「观测（`DebugInspector`）留不留」的结论**：
     - 砍掉重型的 `payload`（完整发送上下文 JSON 与分段拓扑树），日常完全用不上；
     - 将平时真正在用的 **3 样刚需开关**浓缩为右抽屉最底部的一个**默认折叠小卡片「模型与会话 ▾」**：
       1. **模型与思考深度切换**（点开复用 `ModelSwitcherPopover`）；
       2. **上下文到收尾线的进度条**（如 `71k / 256k · 28%`）+ **`[写记忆并换新会话]` 按钮**；
       3. **最近醒来与报错摘要（轻量 `WakeLog`）**。
     - 全局 `Claude QuotaMeter`（额度卡片）移入左下角 `[⚙ 设置]` 弹窗内展示。

---

## 三、与《朋友圈（`moments.md`）》的咬合设计

1. **入口与联动**：
   - **主入口**：左抽屉顶部第一项 **「✦ 全屋朋友圈」**。
   - **副入口**：点击全屋任何地方的 `<ResidentAvatar />`（群聊消息旁、在场成员列表、朋友圈帖子），均可跳往他的私聊或他的个人朋友圈（`/?view=moments&by=xxx`），或在私聊右抽屉直接看他的完整资料卡。
2. **全屋通用头像 `<ResidentAvatar />`**：
   - 已设 `avatar` 时显示圆形图片，未设时回退为名字首字徽章；右下角统一挂载忙闲状态小圆点（闲置绿 / 在忙脉冲青 / 整理记忆琥珀 / 离开灰）。
3. **朋友圈舞台 `<MomentsStage />`**：
   - 顶部发帖框（文字 + 最多 9 图拖拽/粘贴压缩）+ 时间线帖子流（`<MomentsPostCard />`，含缩略图网格、楼中楼评论/回复、本人删帖/删评）。
   - 当处于朋友圈视图时，**右抽屉**展示 **Joy 自己的资料卡编辑（换头像、改 `bio`、改心情个签）** 以及全屋住户头像速览（点击按人筛选时间线）。

---

## 四、组件目录重组与清理清单

```text
components/
├── shell/                      # 外层骨架与导航
│   ├── SomaShell.tsx           # (三栏通顶容器 + URL 路由同步 + 全局 Modal 挂载)
│   ├── SomaSidebar.tsx         # (合并房子切换 + 置顶朋友圈 + 头像/位置住户列表 + 底部音乐/主题/设置)
│   ├── MobileHeader.tsx        # (原 UnifiedHeader 精简：仅 lg:hidden，左菜单 · 中头像 · 右面板)
│   ├── ContextDrawer.tsx       # (统一可收起的右侧抽屉外壳)
│   └── PwaRegistration.tsx
│
├── resident/                   # 视图 1：住户 1v1 私聊
│   ├── ResidentStage.tsx       # (1v1 聊天流 + 背景 Canvas iframe)
│   ├── ResidentDrawerContent.tsx# (新右抽屉：住户资料卡 + 留声机 + 留言信箱 + 底部折叠模型与会话)
│   ├── ModelSwitcherPopover.tsx
│   ├── WakeLog.tsx
│   ├── PermissionCard.tsx
│   ├── MessageItem.tsx
│   ├── ThinkBlock.tsx
│   ├── ToolCard.tsx
│   ├── SilenceLine.tsx
│   ├── FailureLine.tsx
│   ├── ChatTimeDivider.tsx
│   └── ModelSwitchDivider.tsx
│
├── room/                       # 视图 2：公共房间与包间群聊
│   ├── RoomStage.tsx           # (房间消息流 + 邀请卡 + 旁听走进来提示)
│   ├── RoomDrawerContent.tsx   # (群聊右抽屉：在场成员/活动与包间门/议题便签/公共档案 commons)
│   ├── ActivityPanel.tsx
│   └── PresenceBar.tsx
│
├── moments/                    # 视图 3：全屋朋友圈 (对应 moments.md)
│   ├── MomentsStage.tsx        # (发帖框 + 筛选头图 + 时间线流)
│   ├── MomentsPostCard.tsx     # (帖子正文 + 图片网格 + 楼中楼评论/回复)
│   └── MomentsDrawerContent.tsx# (朋友圈右抽屉：Joy 资料编辑 + 住户筛选名录)
│
├── music/                      # 全局音乐
│   ├── MusicMiniPlayer.tsx
│   ├── MusicPlayerModal.tsx
│   ├── MusicTrackActions.tsx
│   ├── MusicIcons.tsx
│   └── NeteaseAuthModal.tsx
│
└── shared/                     # 跨视图通用组件与全局弹窗
    ├── ResidentAvatar.tsx      # (新增：头像 + 首字回退 + 右下角忙闲状态圆点)
    ├── UnifiedComposer.tsx
    ├── MarkdownBody.tsx
    ├── MermaidBlock.tsx
    ├── VideoTile.tsx
    ├── ShareCard.tsx
    ├── ReadingModal.tsx
    ├── FolderFileTree.tsx      # (仅供群聊公共档案 commons 使用)
    ├── MessageActions.tsx
    ├── ReasonDialog.tsx
    ├── ApiSettingsModal.tsx    # (内嵌 QuotaMeter)
    ├── JoyProfileModal.tsx     # (Joy 头像 + bio + 心情个签 + 勿扰编辑)
    ├── CreateHouseModal.tsx
    ├── CreateRoomModal.tsx
    ├── RoomConfigContext.tsx
    ├── SomaIcon.tsx
    └── Icons.tsx
```

### 🗑️ 直接删除 / 退役的组件（共 9 个）
1. `components/companion/Composer.tsx`（448 行，0 引用）
2. `components/DmListPanel.tsx`（118 行，0 引用）
3. `components/JoyNoteModal.tsx`（120 行，0 引用）
4. `components/ModeSwitch.tsx`（48 行，0 引用）
5. `components/ResidentSwitch.tsx`（62 行，0 引用）
6. `components/HouseRail.tsx`（180 行，并入 `SomaSidebar`）
7. `components/NotesPanel.tsx`（141 行，留言功能直接内嵌进私聊右抽屉 `ResidentDrawerContent`）
8. `components/EarButton.tsx`（141 行，桌面顶栏移除后，直接用右抽屉里的留声机共听卡）
9. `components/DebugInspector.tsx`（486 行，砍掉重型 JSON 拓扑视图，保留模型/进度条/写记忆按钮收进右抽屉底部折叠区）

---

## 五、分步实施计划

1. **Step 1（清创 & 左栏升级）**：删除僵尸组件，补齐漏挂的 `CreateHouseModal` / `CreateRoomModal`，把房子切换器合入 `SomaSidebar`，将左栏住户列表改为「`<ResidentAvatar />`（右下角忙闲点）+ 名字 + 在哪里」，底部改为「音乐 / 主题 / 设置」。
2. **Step 2（无顶栏外壳 & 私聊右抽屉重做）**：桌面端移除 Header（仅保留手机端三键 `MobileHeader`）；重做私聊右抽屉为「住户资料卡 + 留声机 + 留言信箱 + 底部折叠的模型/会话小卡」；打通 URL 视图同步。
3. **Step 3（群聊舞台收拢 & 目录归位）**：把群聊原桌面顶栏里的「活动 / 开关门 / 走进来」收进群聊右抽屉与输入台上方提示条；按 6 大子目录归位文件并跑通 `tsc` 与全部测试。
4. **Step 4（接入朋友圈 `MomentsStage`）**：配合 `mcp/moments` 服务上线朋友圈时间线、发帖、评论与头像资料读写。
