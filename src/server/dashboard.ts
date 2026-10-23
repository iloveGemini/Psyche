/**
 * Psyche Dashboard 2.0 观测与管理台（方案 A：保持零构建依赖，直出零依赖 HTML）：
 * 挂在 GET /dashboard，通过浏览器 fetch 调用 /v1/* 接口。
 * 服务端在直出 HTML 时自动注入各住户的 Token 映射，实现本地免输 Token、机器间保持严格租户隔离。
 *
 * 核心升级（真实海量数据适配）：
 * 1. 深度 URL 路由与状态记忆（刷新不丢住户与 Tab，支持浏览器前进/后退）
 * 2. 全屋动态流（Cross-Agent Activity Feed，呈现多住户生态生机）
 * 3. 潜意识浮现雷达（Surfaced Radar，将联想记忆黑盒显性化）
 * 4. 经历时间线与 FTS 全文检索（支持类型过滤、分页、关键字检索）
 * 5. 卷宗原件前后上下文回溯抽屉（Context Window，核查热写细节与现场）
 * 6. 书架分类切换（规矩/规律/镜子/事实/留意/关系）与搜索/排序
 * 7. 自述演化 Visual Diff（红绿高亮比对）
 */
export function renderDashboardHtml(deps: { agentTokens?: Record<string, string> } = {}): string {
  const tokensJson = JSON.stringify(deps.agentTokens || {});
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Psyche · 档案馆与阅览室</title>
  <style>
    :root {
      --bg: #F6F4EE;
      --surface: #FCFBF8;
      --surface-subtle: #F0ECE1;
      --surface-card: #FFFFFF;
      --border: #E5E0D5;
      --border-focus: #B8B0A0;
      --ink: #1C1B18;
      --muted: #6E6A61;
      --faint: #9E988E;
      --ok: #3B7A57;
      --ok-bg: #EAF3EC;
      --warn: #B87D24;
      --warn-bg: #F9F2E6;
      --danger: #C04832;
      --danger-bg: #F8EBE8;
      --accent: #35637C;
      --accent-bg: #EBF2F6;
      --diff-add-bg: #EAF7EE;
      --diff-add-text: #226638;
      --diff-del-bg: #FDEEED;
      --diff-del-text: #9E2B22;

      --font-serif: "Songti SC", "Source Han Serif SC", "Newsreader", "Georgia", serif;
      --font-sans: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", "Inter", sans-serif;
      --font-mono: "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
    }
    [data-theme="dark"] {
      --bg: #141311;
      --surface: #1C1B18;
      --surface-subtle: #24221E;
      --surface-card: #201E1A;
      --border: #2C2A25;
      --border-focus: #4A463E;
      --ink: #EAE6DF;
      --muted: #9E988E;
      --faint: #635F57;
      --ok: #529E72;
      --ok-bg: #1A281E;
      --warn: #D99B38;
      --warn-bg: #2C2214;
      --danger: #E0634B;
      --danger-bg: #2E1B17;
      --accent: #639BB8;
      --accent-bg: #17242C;
      --diff-add-bg: #1B3322;
      --diff-add-text: #73C991;
      --diff-del-bg: #351C1A;
      --diff-del-text: #F08D84;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--ink);
      font-family: var(--font-sans);
      line-height: 1.55;
      font-size: 13.5px;
      -webkit-font-smoothing: antialiased;
      min-height: 100vh;
    }
    header {
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      position: sticky;
      top: 0;
      z-index: 30;
      box-shadow: 0 1px 3px rgba(0,0,0,0.03);
    }
    .header-inner {
      max-width: 1200px;
      margin: 0 auto;
      padding: 10px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 600;
      cursor: pointer;
      user-select: none;
    }
    .brand-mark {
      width: 26px;
      height: 26px;
      border-radius: 5px;
      background: var(--ink);
      color: var(--surface);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: var(--font-serif);
      font-size: 15px;
      font-weight: bold;
    }
    .nav-tabs {
      display: flex;
      gap: 4px;
      background: var(--surface-subtle);
      padding: 3px;
      border-radius: 6px;
      border: 1px solid var(--border);
      flex-wrap: wrap;
    }
    .nav-btn {
      padding: 4px 11px;
      border: none;
      background: transparent;
      color: var(--muted);
      font-size: 12.5px;
      border-radius: 4px;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.15s;
    }
    .nav-btn:hover { color: var(--ink); }
    .nav-btn.active {
      background: var(--surface);
      color: var(--ink);
      font-weight: 600;
      box-shadow: 0 1px 2px rgba(0,0,0,0.08);
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .badge-auth {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--ok);
      background: var(--ok-bg);
      padding: 3px 8px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .badge-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--ok);
      display: inline-block;
    }
    input, textarea, select {
      background: var(--surface);
      color: var(--ink);
      border: 1px solid var(--border);
      border-radius: 5px;
      padding: 5px 9px;
      font-family: inherit;
      font-size: 13px;
    }
    input:focus, textarea:focus, select:focus {
      outline: none;
      border-color: var(--border-focus);
    }
    .btn {
      background: var(--surface);
      border: 1px solid var(--border);
      padding: 5px 12px;
      border-radius: 5px;
      font-size: 12.5px;
      color: var(--ink);
      cursor: pointer;
      font-family: inherit;
      transition: all 0.15s;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .btn:hover { border-color: var(--border-focus); background: var(--surface-subtle); }
    .btn.primary {
      background: var(--ink);
      color: var(--surface);
      border-color: var(--ink);
    }
    .btn.primary:hover { opacity: 0.9; }
    .btn.sm { padding: 3px 8px; font-size: 11.5px; }

    main {
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }

    /* 全屋状态条 */
    .house-bar {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .joy-status {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--faint);
      display: inline-block;
    }
    .status-dot.on { background: var(--ok); }
    .radio-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--accent);
      background: var(--accent-bg);
      padding: 3px 10px;
      border-radius: 12px;
    }

    /* 住户卡片墙 */
    .cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .resident-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .resident-card:hover {
      border-color: var(--border-focus);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.05);
    }
    .card-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px;
    }
    .resident-name { font-size: 16px; font-weight: 600; }
    .mono-badge {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--muted);
      background: var(--surface-subtle);
      padding: 1px 6px;
      border-radius: 3px;
      border: 1px solid var(--border);
    }
    .state-badge {
      font-size: 11.5px;
      padding: 2px 7px;
      border-radius: 10px;
      font-weight: 500;
      white-space: nowrap;
    }
    .state-badge.idle { background: var(--ok-bg); color: var(--ok); }
    .state-badge.busy { background: var(--warn-bg); color: var(--warn); }
    .state-badge.asleep { background: var(--accent-bg); color: var(--accent); }
    .state-badge.offline { background: var(--surface-subtle); color: var(--muted); }
    .card-mood {
      font-family: var(--font-serif);
      font-style: italic;
      color: var(--muted);
      font-size: 12.5px;
      background: var(--surface-subtle);
      padding: 6px 10px;
      border-radius: 4px;
      border-left: 2px solid var(--border-focus);
    }
    .card-divider { height: 1px; background: var(--border); border: none; }
    .card-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11.5px;
      color: var(--muted);
      font-family: var(--font-mono);
    }
    .wake-dots { display: flex; gap: 3px; align-items: center; }
    .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--border); display: inline-block; }
    .dot.filled { background: var(--accent); }

    /* 全屋生活动态流 */
    .feed-container {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 18px 20px;
      margin-bottom: 24px;
    }
    .feed-title {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .feed-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-height: 380px;
      overflow-y: auto;
    }
    .feed-item {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 8px 10px;
      border-radius: 6px;
      background: var(--surface-subtle);
      font-size: 12.5px;
      transition: background 0.15s;
    }
    .feed-item:hover { background: var(--border); }
    .feed-time {
      font-family: var(--font-mono);
      color: var(--muted);
      font-size: 11px;
      min-width: 80px;
      flex-shrink: 0;
    }
    .feed-tag {
      font-family: var(--font-mono);
      font-size: 11px;
      padding: 1px 6px;
      border-radius: 3px;
      flex-shrink: 0;
      background: var(--surface);
      border: 1px solid var(--border);
    }

    /* 进度条与常驻徽章 */
    .progress-wrap {
      background: var(--surface-subtle);
      border-radius: 6px;
      height: 7px;
      overflow: hidden;
      width: 100%;
      border: 1px solid var(--border);
    }
    .progress-bar {
      height: 100%;
      background: var(--ok);
      border-radius: 6px;
      transition: width 0.3s ease;
    }
    .progress-bar.warn { background: var(--warn); }
    .progress-bar.danger { background: var(--danger); }
    .pinned-badge {
      font-family: var(--font-mono);
      font-size: 11px;
      background: #FFF7E6;
      color: #B87D24;
      border: 1px solid #FFE7BA;
      padding: 1px 6px;
      border-radius: 3px;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }
    [data-theme="dark"] .pinned-badge {
      background: #332414;
      color: #E0A045;
      border-color: #52391C;
    }

    /* 住户深度座舱页头 */
    .resident-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 12px;
      flex-wrap: wrap;
      gap: 12px;
    }
    .sub-tabs { display: flex; gap: 4px; flex-wrap: wrap; }
    .sub-tab-btn {
      padding: 5px 12px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--muted);
      font-size: 13px;
      border-radius: 5px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .sub-tab-btn:hover { color: var(--ink); background: var(--surface-subtle); }
    .sub-tab-btn.active {
      background: var(--surface);
      color: var(--ink);
      font-weight: 600;
      border-color: var(--border);
      box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    }

    /* 指标网格 */
    .health-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }
    .metric-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .metric-title { font-size: 11.5px; color: var(--muted); }
    .metric-val { font-size: 20px; font-family: var(--font-mono); font-weight: 600; }
    .metric-sub { font-size: 11.5px; color: var(--muted); }
    .warning-box {
      background: var(--danger-bg);
      border: 1px solid var(--danger);
      border-left-width: 4px;
      border-radius: 6px;
      padding: 10px 14px;
      margin-bottom: 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }

    .panel-box {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 18px;
      margin-bottom: 16px;
    }

    .serif-body {
      font-family: var(--font-serif);
      font-size: 14.5px;
      line-height: 1.7;
      max-width: 72ch;
      white-space: pre-wrap;
    }
    .tag {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--accent);
      background: var(--accent-bg);
      padding: 1px 5px;
      border-radius: 3px;
      cursor: pointer;
      text-decoration: underline;
      display: inline-block;
      margin: 0 2px;
    }
    .tag:hover { opacity: 0.8; }

    /* 书架与卡片 */
    .filter-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 14px;
      flex-wrap: wrap;
    }
    .filter-pills { display: flex; gap: 4px; flex-wrap: wrap; }
    .pill {
      font-size: 12px;
      padding: 3px 10px;
      border-radius: 12px;
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--muted);
      cursor: pointer;
    }
    .pill.active {
      background: var(--ink);
      color: var(--surface);
      border-color: var(--ink);
      font-weight: 500;
    }
    .shelf-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 7px;
      padding: 14px 16px;
      margin-bottom: 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .shelf-card.flagged { border-left: 4px solid var(--danger); }
    .shelf-row { display: flex; gap: 8px; font-size: 13px; }
    .shelf-label { color: var(--muted); min-width: 48px; font-size: 12px; flex-shrink: 0; }

    /* 经历时间线 */
    .timeline-group {
      margin-bottom: 18px;
    }
    .timeline-date {
      font-family: var(--font-mono);
      font-size: 12px;
      font-weight: 600;
      color: var(--muted);
      padding: 4px 8px;
      background: var(--surface-subtle);
      border-radius: 4px;
      display: inline-block;
      margin-bottom: 8px;
    }

    /* Visual Diff */
    .diff-line {
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.45;
      padding: 1px 6px;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .diff-line.add { background: var(--diff-add-bg); color: var(--diff-add-text); }
    .diff-line.del { background: var(--diff-del-bg); color: var(--diff-del-text); }
    .diff-line.ctx { color: var(--muted); }

    /* 抽屉 Drawer */
    .drawer-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.35);
      z-index: 50;
      display: none;
      backdrop-filter: blur(1px);
    }
    .drawer-overlay.open { display: block; }
    .drawer {
      position: fixed;
      right: 0;
      top: 0;
      bottom: 0;
      width: 520px;
      max-width: 94vw;
      background: var(--surface);
      border-left: 1px solid var(--border);
      box-shadow: -4px 0 24px rgba(0,0,0,0.12);
      z-index: 51;
      transform: translateX(100%);
      transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
      display: flex;
      flex-direction: column;
    }
    .drawer.open { transform: translateX(0); }
    .drawer-header {
      padding: 14px 18px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: var(--surface);
    }
    .drawer-body {
      padding: 18px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 14px;
      flex: 1;
    }
    .quote-block {
      font-family: var(--font-serif);
      font-size: 13.5px;
      line-height: 1.65;
      background: var(--surface-subtle);
      padding: 10px 12px;
      border-radius: 5px;
      border-left: 3px solid var(--accent);
      white-space: pre-wrap;
    }
    table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    th, td { text-align: left; padding: 7px 9px; border-bottom: 1px solid var(--border); }
    th { color: var(--muted); font-weight: 500; font-size: 11.5px; }
  </style>
</head>
<body data-theme="light">
  <header>
    <div class="header-inner">
      <div class="brand" onclick="goHome()">
        <div class="brand-mark">Ψ</div>
        <span>Psyche 档案馆与阅览室</span>
      </div>
      <div class="nav-tabs" id="top-nav">
        <button class="nav-btn active" onclick="goHome()">全屋总览</button>
      </div>
      <div class="header-actions">
        <span class="badge-auth" id="auth-badge"><span class="badge-dot"></span> 租户隔离 · 本地直通</span>
        <button class="btn sm" onclick="openBirthModal()">+ 新生 / 出生</button>
        <button class="btn sm" onclick="toggleTheme()" id="theme-btn">🌙 深夜台灯</button>
      </div>
    </div>
  </header>

  <main>
    <div id="error-banner" style="display:none;" class="warning-box"></div>
    <div id="view-house"></div>
    <div id="view-resident" style="display:none;"></div>
  </main>

  <div class="drawer-overlay" id="drawer-overlay" onclick="closeDrawer()"></div>
  <div class="drawer" id="drawer">
    <div class="drawer-header">
      <strong id="drawer-title" style="font-family:var(--font-mono); color:var(--accent); font-size:14px;">卷宗抽屉</strong>
      <button class="btn sm" onclick="closeDrawer()">关闭 ✕</button>
    </div>
    <div class="drawer-body" id="drawer-body"></div>
  </div>

  <script>
    const INJECTED_TOKENS = ${tokensJson};
    try { localStorage.removeItem('psyche_token'); } catch (e) {}

    // 全局路由与过滤状态
    const STATE = {
      agent: null,
      tab: 'health', // health | shelf | exp | self | schedule
      readingSub: 'shelf', // shelf | pinned | threads | gist
      shelfCategory: 'all',
      shelfSort: 'default',
      shelfQuery: '',
      expKind: 'all',
      expQuery: '',
      expLimit: 60,
      house: null,
      feed: [],
    };

    function esc(s) {
      return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function fmtTime(ms) {
      if (!ms) return '—';
      const d = new Date(ms);
      const p = (n) => String(n).padStart(2, '0');
      return \`\${p(d.getMonth()+1)}-\${p(d.getDate())} \${p(d.getHours())}:\${p(d.getMinutes())}\`;
    }
    function fmtFullTime(ms) {
      if (!ms) return '—';
      const d = new Date(ms);
      const p = (n) => String(n).padStart(2, '0');
      return \`\${d.getFullYear()}-\${p(d.getMonth()+1)}-\${p(d.getDate())} \${p(d.getHours())}:\${p(d.getMinutes())}:\${p(d.getSeconds())}\`;
    }
    function linkifyTags(text) {
      return esc(text).replace(/\\[?((?:[A-Z0-9_]+\\/)?(?:\\d{4}-)?\\d{2}-\\d{2}#\\d+)\\]?/g, (m, no) =>
        \`<span class="tag" onclick="event.stopPropagation(); inspectArchive('\${no}')">\${no}</span>\`
      );
    }

    async function api(path, opts = {}) {
      const headers = { ...(opts.headers || {}) };
      const url = new URL(path, location.origin);
      let targetAgent = url.searchParams.get('agent') || STATE.agent;
      const isHouseRoute = url.pathname.startsWith('/v1/house');

      // 非全屋公共接口，自动补全 agent 参数与 x-psyche-agent 隔离头
      if (!isHouseRoute && targetAgent) {
        url.searchParams.set('agent', targetAgent);
        headers['x-psyche-agent'] = targetAgent;
      }

      const autoToken = (targetAgent && INJECTED_TOKENS[targetAgent]) || (isHouseRoute ? Object.values(INJECTED_TOKENS)[0] : '') || Object.values(INJECTED_TOKENS)[0] || '';
      if (autoToken) headers['authorization'] = 'Bearer ' + autoToken;

      if (opts.body && typeof opts.body === 'object') {
        headers['content-type'] = 'application/json';
        opts.body = JSON.stringify(opts.body);
      }

      const res = await fetch(url.pathname + url.search, { ...opts, headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      return data;
    }

    function showError(msg) {
      const el = document.getElementById('error-banner');
      if (!msg) { el.style.display = 'none'; return; }
      el.style.display = 'flex';
      el.innerHTML = \`<span>⚠️ \${esc(msg)}</span><button class="btn sm" onclick="showError(null)">关闭</button>\`;
    }

    function toggleTheme() {
      const dark = document.body.getAttribute('data-theme') === 'dark';
      document.body.setAttribute('data-theme', dark ? 'light' : 'dark');
      document.getElementById('theme-btn').textContent = dark ? '🌙 深夜台灯' : '☀️ 档案纸';
    }

    // 路由同步
    function readRoute() {
      const sp = new URLSearchParams(location.search);
      STATE.agent = sp.get('agent') || null;
      STATE.tab = sp.get('tab') || 'health';
      STATE.readingSub = sp.get('readingSub') || 'shelf';
      if (sp.has('shelfCat')) STATE.shelfCategory = sp.get('shelfCat');
      if (sp.has('expKind')) STATE.expKind = sp.get('expKind');
    }
    function syncRoute(replace = false) {
      const url = new URL(location.href);
      if (STATE.agent) {
        url.searchParams.set('agent', STATE.agent);
        url.searchParams.set('tab', STATE.tab);
        if (STATE.tab === 'shelf' && STATE.readingSub !== 'shelf') url.searchParams.set('readingSub', STATE.readingSub);
        else url.searchParams.delete('readingSub');
        if (STATE.shelfCategory !== 'all') url.searchParams.set('shelfCat', STATE.shelfCategory);
        else url.searchParams.delete('shelfCat');
        if (STATE.expKind !== 'all') url.searchParams.set('expKind', STATE.expKind);
        else url.searchParams.delete('expKind');
      } else {
        url.search = '';
      }
      if (replace) history.replaceState(null, '', url);
      else history.pushState(null, '', url);
    }
    window.addEventListener('popstate', () => {
      readRoute();
      render();
    });

    function goHome() {
      STATE.agent = null;
      syncRoute();
      render();
    }
    function selectResident(id, tab = 'health') {
      STATE.agent = id;
      STATE.tab = tab;
      syncRoute();
      render();
    }
    function selectTab(tab) {
      STATE.tab = tab;
      syncRoute(true);
      document.querySelectorAll('.resident-header .sub-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
      });
      renderResidentContent();
    }
    function setReadingSub(sub) {
      STATE.readingSub = sub;
      syncRoute(true);
      renderResidentContent();
    }

    async function init() {
      readRoute();
      await refreshHouseData();
      render();
    }

    async function refreshHouseData() {
      try {
        const [h, f] = await Promise.all([
          api('/v1/house'),
          api('/v1/house/feed?limit=30').catch(() => ({ feed: [] })),
        ]);
        STATE.house = h;
        STATE.feed = f.feed || [];
      } catch (e) {
        showError(e.message);
      }
    }

    function render() {
      showError(null);
      renderTopNav();
      if (!STATE.agent) {
        document.getElementById('view-house').style.display = 'block';
        document.getElementById('view-resident').style.display = 'none';
        renderHouseView();
      } else {
        document.getElementById('view-house').style.display = 'none';
        document.getElementById('view-resident').style.display = 'block';
        renderResidentShell();
        renderResidentContent();
      }
    }

    function renderTopNav() {
      const nav = document.getElementById('top-nav');
      const rs = STATE.house?.residents || [];
      nav.innerHTML = [
        \`<button class="nav-btn \${!STATE.agent ? 'active' : ''}" onclick="goHome()">全屋总览</button>\`,
        ...rs.map(r => \`<button class="nav-btn \${STATE.agent === r.id ? 'active' : ''}" onclick="selectResident('\${esc(r.id)}')">\${esc(r.name || r.id)}</button>\`)
      ].join('');
    }

    /* ─── 视图 1：全屋总览与生活脉搏 ─── */
    function renderHouseView() {
      const h = STATE.house || { residents: [], joy: {} };
      const el = document.getElementById('view-house');
      const stateLabel = { idle: '闲', busy: '忙', asleep: '整理梦境中', offline: '离线' };

      // 统计全屋资源
      let totalEpisodes = 0;
      let totalShelf = 0;
      let totalUsedBudget = 0;
      (h.residents || []).forEach(r => {
        totalEpisodes += r.pulse?.episodes || 0;
        totalShelf += r.pulse?.shelf || 0;
        totalUsedBudget += r.wake?.budget?.used || 0;
      });

      el.innerHTML = \`
        <div class="house-bar">
          <div class="joy-status">
            <span class="status-dot \${h.joy?.home ? 'on' : ''}"></span>
            <strong>Joy \${h.joy?.home ? '在家' : '外出'}</strong>
            <input id="joy-mood-input" value="\${esc(h.joy?.mood || '')}" placeholder="挂个心情个签（回车保存）" style="width:200px;" onkeydown="if(event.key==='Enter') updateJoyMood(this.value)">
            <button class="btn sm" onclick="updateJoyMood(document.getElementById('joy-mood-input').value)">保存</button>
          </div>
          <div style="display:flex; gap:16px; align-items:center; font-family:var(--font-mono); font-size:12px; color:var(--muted); flex-wrap:wrap;">
            <span>住户 <strong>\${h.residents?.length || 0}</strong> 人</span>
            <span>共存记忆 <strong>\${totalEpisodes}</strong> 情节</span>
            <span>书架 <strong>\${totalShelf}</strong> 条</span>
            <span>今日唤醒 <strong>\${totalUsedBudget}</strong> 次</span>
          </div>
        </div>

        <h3 style="font-size:14px; margin-bottom:12px; color:var(--muted); font-weight:600;">住户生态卡片墙</h3>
        <div class="cards-grid">
          \${(h.residents || []).map(r => {
            const used = r.wake?.budget?.used ?? 0;
            const of = r.wake?.budget?.of ?? 3;
            const dots = Array.from({ length: Math.max(of, used, 1) }, (_, i) => \`<span class="dot \${i < used ? 'filled' : ''}"></span>\`).join('');
            const p = r.pulse || { episodes: 0, uncoveredLines: 0, shelf: 0, openThreads: 0 };
            return \`
              <div class="resident-card" onclick="selectResident('\${esc(r.id)}')">
                <div class="card-top">
                  <div>
                    <span class="resident-name">\${esc(r.name || r.id)}</span>
                    \${r.name && r.name !== r.id ? \`<span class="mono-badge">#\${esc(r.id)}</span>\` : ''}
                    <span class="mono-badge">\${esc(r.born?.model || '未出生')}</span>
                  </div>
                  <span class="state-badge \${esc(r.state || 'offline')}">● \${stateLabel[r.state] || r.state}\${r.where ? ' · ' + esc(r.where) : ''}</span>
                </div>
                \${r.mood ? \`<div class="card-mood">“\${esc(r.mood)}”</div>\` : ''}
                \${r.listening ? \`<div style="font-size:11.5px; color:var(--accent);">🎧 \${esc(r.listening)}</div>\` : ''}
                <hr class="card-divider">
                <div class="card-footer">
                  <div class="wake-dots">
                    <span>额度 \${used}/\${of}</span> \${dots}
                    \${r.wake?.paused ? '<span style="color:var(--danger); margin-left:3px;">(暂停)</span>' : ''}
                  </div>
                  <span>\${p.episodes} 情节 · \${p.shelf} 书架 · \${p.openThreads} 卷</span>
                </div>
              </div>
            \`;
          }).join('')}
        </div>

        <div class="feed-container">
          <div class="feed-title">
            <span>✨ 全屋生活动态流 (Activity Feed)</span>
            <button class="btn sm" onclick="refreshHouseData().then(renderHouseView)">刷新动态 ↻</button>
          </div>
          <div class="feed-list">
            \${(STATE.feed || []).map(item => {
              const kindMap = {
                woke: '⏰ 唤醒', slept: '🌙 入睡', 'coldwrite.done': '📖 冷写完成',
                'mail.in': '📬 收到信件', 'mail.out': '✉️ 发送信件',
                'semantic.proposed': '💡 提炼认知', 'semantic.revised': '🔄 改写认知',
                episode: '📝 记录情节', 'mood.set': '🏷️ 个签变动', 'room.entered': '🚪 进入房间'
              };
              let summary = '';
              if (item.kind === 'episode') summary = item.payload?.text || '';
              else if (item.kind === 'coldwrite.done') summary = \`整理新写 \${item.payload?.proposed || 0} 条书架，判了 \${item.payload?.evidences || 0} 证据\`;
              else if (item.kind === 'semantic.proposed' || item.kind === 'semantic.revised') summary = item.payload?.text || '';
              else if (item.kind === 'woke') summary = \`唤醒原因：\${item.payload?.by || '计划'}\`;
              else if (item.kind === 'mail.out' || item.kind === 'mail.in') summary = \`致 \${item.payload?.to || item.payload?.from || '同伴'}: \${item.payload?.title || '新信件'}\`;
              else summary = JSON.stringify(item.payload);

              return \`
                <div class="feed-item" onclick="selectResident('\${esc(item.residentId)}')" style="cursor:pointer;">
                  <span class="feed-time">\${fmtTime(item.at)}</span>
                  <strong style="min-width:65px;">\${esc(item.residentName)}</strong>
                  <span class="feed-tag">\${kindMap[item.kind] || item.kind}</span>
                  <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--ink);">
                    \${esc(summary)}
                  </span>
                  <span class="mono-badge">\${esc(item.archiveNo)}</span>
                </div>
              \`;
            }).join('') || '<div style="color:var(--faint); padding:10px;">暂无全屋动态</div>'}
          </div>
        </div>
      \`;
    }

    async function updateJoyMood(text) {
      try {
        await api('/v1/house/joy/mood', { method: 'POST', body: { text } });
        await refreshHouseData();
        renderHouseView();
      } catch (e) { showError(e.message); }
    }

    /* ─── 视图 2：住户深度座舱外壳 ─── */
    function renderResidentShell() {
      const id = STATE.agent;
      const rInfo = (STATE.house?.residents || []).find(r => r.id === id) || { id, name: id };
      const container = document.getElementById('view-resident');
      container.innerHTML = \`
        <div class="resident-header">
          <div>
            <span style="font-size:18px; font-weight:600; margin-right:8px;">\${esc(rInfo.name || id)}</span>
            <span class="mono-badge">#\${esc(id)}</span>
            <span class="mono-badge">\${esc(rInfo.born?.model || '未出生')}</span>
            \${rInfo.born?.at ? \`<span style="color:var(--muted); font-size:12px; margin-left:8px;">生于 \${fmtTime(rInfo.born.at)}</span>\` : ''}
          </div>
          <div class="sub-tabs">
            <button class="sub-tab-btn \${STATE.tab === 'health' ? 'active' : ''}" data-tab="health" onclick="selectTab('health')">记忆体检与浮现</button>
            <button class="sub-tab-btn \${STATE.tab === 'shelf' ? 'active' : ''}" data-tab="shelf" onclick="selectTab('shelf')">阅览室与书架</button>
            <button class="sub-tab-btn \${STATE.tab === 'exp' ? 'active' : ''}" data-tab="exp" onclick="selectTab('exp')">经历时间线 (FTS)</button>
            <button class="sub-tab-btn \${STATE.tab === 'self' ? 'active' : ''}" data-tab="self" onclick="selectTab('self')">我是谁 (演变 Diff)</button>
            <button class="sub-tab-btn \${STATE.tab === 'schedule' ? 'active' : ''}" data-tab="schedule" onclick="selectTab('schedule')">作息与设置</button>
          </div>
        </div>
        <div id="resident-sub-body"><div style="padding:20px; color:var(--muted);">加载中…</div></div>
      \`;
    }

    async function renderResidentContent() {
      const id = STATE.agent;
      const body = document.getElementById('resident-sub-body');
      if (!body) return;

      try {
        if (STATE.tab === 'health') {
          const [h, surfRes, pinned] = await Promise.all([
            api('/v1/health'),
            api('/v1/surfaced?limit=15').catch(() => ({ surfaced: [] })),
            api('/v1/pinned').catch(() => ({ used: 0, budget: 1200, entries: [], history: [] })),
          ]);
          body.innerHTML = renderHealthTabHtml(h, surfRes.surfaced || [], pinned);
        } else if (STATE.tab === 'shelf') {
          const params = new URLSearchParams();
          if (STATE.shelfCategory !== 'all') params.set('shelf', STATE.shelfCategory);
          if (STATE.shelfQuery) params.set('q', STATE.shelfQuery);
          const qs = params.toString() ? '?' + params.toString() : '';

          const [shelfData, pinnedData, threadsData, gistData] = await Promise.all([
            api('/v1/shelf' + qs),
            api('/v1/pinned').catch(() => ({ used: 0, budget: 1200, entries: [], history: [] })),
            api('/v1/threads?all=1'),
            api('/v1/gist'),
          ]);
          body.innerHTML = renderShelfTabHtml(shelfData.entries || [], pinnedData, threadsData, gistData.gists || []);
        } else if (STATE.tab === 'exp') {
          await renderExperienceTab(body, id);
        } else if (STATE.tab === 'self') {
          const s = await api('/v1/self');
          body.innerHTML = renderSelfTabHtml(s);
        } else if (STATE.tab === 'schedule') {
          const [sched, wakes] = await Promise.all([
            api('/v1/schedule'),
            api('/v1/wakes?days=7'),
          ]);
          body.innerHTML = renderScheduleTabHtml(id, sched, wakes);
        }
      } catch (e) {
        showError(e.message);
        body.innerHTML = \`<div style="color:var(--danger); padding:20px;">加载失败: \${esc(e.message)}</div>\`;
      }
    }

    /* ─── Tab 1: 记忆体检与潜意识浮现 ─── */
    function renderHealthTabHtml(h, surfaced, pinned) {
      const pinPct = Math.round(((pinned?.used ?? 0) / (pinned?.budget || 1200)) * 100);
      return \`
        <div class="health-grid">
          <div class="metric-card">
            <span class="metric-title">热写未覆盖积压</span>
            <span class="metric-val">\${h.hotwrite.uncoveredLines} 行</span>
            <span class="metric-sub">\${h.hotwrite.uncoveredSessions} 个未结段 · 共 \${h.hotwrite.episodesTotal} 条情节</span>
          </div>
          <div class="metric-card">
            <span class="metric-title">近 7 天压缩比</span>
            <span class="metric-val">\${h.hotwrite.compressionRatio7d} : 1</span>
            <span class="metric-sub">\${h.hotwrite.coveredLines7d} 原始行 → \${h.hotwrite.episodes7d} 条情节</span>
          </div>
          <div class="metric-card">
            <span class="metric-title">连续性种子容量</span>
            <span class="metric-val">\${h.continuity.seedChars} / \${h.continuity.seedBudget}</span>
            <span class="metric-sub">梗概：天 \${h.continuity.gists.day} · 周 \${h.continuity.gists.week} · 月 \${h.continuity.gists.month}</span>
          </div>
          <div class="metric-card" onclick="setReadingSub('pinned'); selectTab('shelf')" style="cursor:pointer;" title="点击去常驻记忆区">
            <span class="metric-title">常驻记忆区容量 (Pinned) ↗</span>
            <span class="metric-val">\${pinned?.used ?? 0} / \${pinned?.budget ?? 1200}</span>
            <div class="progress-wrap" style="margin:4px 0;">
              <div class="progress-bar \${pinPct > 90 ? 'danger' : pinPct > 70 ? 'warn' : ''}" style="width:\${Math.min(pinPct, 100)}%;"></div>
            </div>
            <span class="metric-sub">已钉 \${pinned?.entries?.length ?? 0} 条条目 (\${pinPct}%) · 醒来常驻眼前</span>
          </div>
        </div>

        \${(h.coldwrite.warnings || []).map(w => \`
          <div class="warning-box">
            <div>
              <strong style="color:var(--danger);">⚠️ 闭环预警 (\${w.reason === 'no_against' ? '只攒印证 0 反例，留意过宽自我证实' : '超过 7 天未验证'})</strong>
              <div style="font-size:12.5px; margin-top:3px;">
                书架条目 \${linkifyTags(w.archiveNo)}（\${w.shelf}）· 印证 \${w.for} · 反例 \${w.against} · 改写 \${w.revisions}
              </div>
            </div>
            <button class="btn sm" onclick="inspectShelf('\${esc(w.archiveNo)}')">查看证据链 →</button>
          </div>
        \`).join('')}

        <div class="panel-box">
          <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:16px; font-size:13px;">
            <div><strong>书架构成：</strong>事实 \${h.coldwrite.shelves.fact} · 规矩 \${h.coldwrite.shelves.told} · 规律 \${h.coldwrite.shelves.rule} · 镜子 \${h.coldwrite.shelves.mirror} · 留意 \${h.coldwrite.shelves.attend} · 关系 \${h.coldwrite.shelves.relation}</div>
            <div><strong>待冷写材料：</strong>新情节 \${h.coldwrite.episodesSinceLast} · 候选证据 \${h.coldwrite.pendingCandidates} · 反馈对 \${h.coldwrite.pendingFeedback}</div>
            <div><strong>线索卷：</strong>承诺 \${h.threads.openPromises} · 挂着的事 \${h.threads.openMatters} · 已合卷 \${h.threads.closedTotal}</div>
          </div>
        </div>

        <div class="panel-box">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <strong style="font-size:14px;">🧠 潜意识浮现雷达 (Surfaced Radar)</strong>
            <span style="font-size:12px; color:var(--muted);">处境调制触发 · 浮现记忆沉淀</span>
          </div>
          \${surfaced.length === 0 ? '<div style="color:var(--faint); font-size:12.5px;">近期暂无潜意识浮现记录</div>' : \`
            <div style="display:flex; flex-direction:column; gap:10px;">
              \${surfaced.map(s => \`
                <div class="shelf-card" style="background:var(--surface-subtle); padding:10px 14px;">
                  <div style="display:flex; justify-content:space-between; align-items:center; font-family:var(--font-mono); font-size:11.5px; color:var(--muted);">
                    <span>\${fmtTime(s.at)} · 匹配分 <strong>\${s.score ? s.score.toFixed(3) : '—'}</strong> · 来源 \${esc(s.source || 'recall')}</span>
                    \${s.ref ? \`<button class="btn sm" onclick="inspectArchive('\${esc(s.ref.archiveNo)}')">查原件 \${esc(s.ref.archiveNo)} →</button>\` : ''}
                  </div>
                  \${s.cue ? \`<div style="font-size:12px; color:var(--muted); margin:4px 0;"><strong>处境触发：</strong>\${esc(s.cue.slice(0, 140))}\${s.cue.length > 140 ? '…' : ''}</div>\` : ''}
                  \${s.ref?.text ? \`<div class="quote-block" style="font-size:12.5px; margin-top:4px;">\${esc(s.ref.text)}</div>\` : ''}
                </div>
              \`).join('')}
            </div>
          \`}
        </div>

        <div class="panel-box" style="background:transparent; border-style:dashed; font-size:12.5px; color:var(--muted); display:flex; justify-content:space-between; align-items:center;">
          <span>📓 私密自留地 · 随笔日记 <strong>\${h.privateCounts.diaries}</strong> 篇（最近 \${fmtTime(h.privateCounts.lastDiaryAt)}）· 住户间信件 <strong>\${h.privateCounts.peerMails}</strong> 封 · 未翻开 <strong>\${h.privateCounts.unreadMails}</strong> 封</span>
          <span style="font-size:11.5px;">契约保护：面板仅统计件数，不公开正文</span>
        </div>
      \`;
    }

    /* ─── Tab 2: 阅览室与书架 ─── */
    function renderShelfTabHtml(entries, pinned, threads, gists) {
      const names = { all: '全部', rule: '规律', mirror: '镜子', told: '明说规矩', fact: '事实', attend: '留意', relation: '关系' };
      const sub = STATE.readingSub || 'shelf';
      const openThreadsCount = (threads?.open || []).length;
      const gistCount = (gists || []).length;
      const pinnedCount = (pinned?.entries || []).length;
      const pinPct = Math.round(((pinned?.used ?? 0) / (pinned?.budget || 1200)) * 100);

      let subBodyHtml = '';

      if (sub === 'shelf') {
        const currentCat = STATE.shelfCategory || 'all';
        let sorted = [...entries];
        if (STATE.shelfSort === 'for') sorted.sort((a,b) => b.for - a.for);
        else if (STATE.shelfSort === 'against') sorted.sort((a,b) => b.against - a.against);
        else if (STATE.shelfSort === 'warn') sorted.sort((a,b) => ((b.rule || b.mirror) && b.against === 0 ? 1 : 0) - ((a.rule || a.mirror) && a.against === 0 ? 1 : 0));

        subBodyHtml = \`
          <div class="filter-bar">
            <div class="filter-pills">
              \${Object.entries(names).map(([k, v]) => \`
                <span class="pill \${currentCat === k ? 'active' : ''}" onclick="setShelfCategory('\${k}')">\${v}</span>
              \`).join('')}
            </div>
            <div style="display:flex; gap:8px; align-items:center;">
              <input placeholder="搜索书架条目…" value="\${esc(STATE.shelfQuery)}" onkeydown="if(event.key==='Enter') searchShelf(this.value)" style="width:180px;">
              <select onchange="STATE.shelfSort=this.value; renderResidentContent()">
                <option value="default" \${STATE.shelfSort==='default'?'selected':''}>默认排序</option>
                <option value="for" \${STATE.shelfSort==='for'?'selected':''}>印证最多</option>
                <option value="against" \${STATE.shelfSort==='against'?'selected':''}>反例最多</option>
                <option value="warn" \${STATE.shelfSort==='warn'?'selected':''}>预警优先</option>
              </select>
            </div>
          </div>

          <div style="margin-bottom:20px;">
            \${sorted.map(e => {
              const warn = (e.shelf === 'rule' || e.shelf === 'mirror') && e.for >= 3 && e.against === 0;
              return \`
                <div class="shelf-card \${warn ? 'flagged' : ''}">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="display:flex; align-items:center; gap:6px;">
                      <span class="mono-badge">\${esc(names[e.shelf] || e.shelf)}</span>
                      \${e.pinned ? '<span class="pinned-badge">📌 常驻中</span>' : ''}
                      \${e.about ? \`<span class="mono-badge" style="color:var(--accent);">关于 \${esc(e.about)}</span>\` : ''}
                    </div>
                    <span style="font-family:var(--font-mono); font-size:12px; color:var(--muted);">
                      印证 <strong>\${e.for}</strong> · 反例 <strong>\${e.against}</strong> · \${linkifyTags(e.archiveNo)}
                      <button class="btn sm" style="margin-left:6px;" onclick="inspectShelf('\${esc(e.archiveNo)}')">证据链 →</button>
                    </span>
                  </div>
                  <div style="font-weight:500; font-size:14px; margin:4px 0 2px;">\${esc(e.text)}</div>
                  \${e.when ? \`<div class="shelf-row"><span class="shelf-label">当</span><span>\${esc(e.when)}</span></div>\` : ''}
                  \${e.then ? \`<div class="shelf-row"><span class="shelf-label">则</span><span>\${esc(e.then)}</span></div>\` : ''}
                  \${e.observe ? \`<div class="shelf-row"><span class="shelf-label">观察</span><span>\${esc(e.observe)}</span></div>\` : ''}
                  \${e.quote ? \`<div class="shelf-row"><span class="shelf-label">原话</span><span style="font-family:var(--font-serif); font-style:italic;">“\${esc(e.quote)}”</span></div>\` : ''}
                </div>
              \`;
            }).join('') || '<div style="color:var(--faint); padding:20px 0;">该分类下暂无书架条目</div>'}
          </div>
        \`;
      } else if (sub === 'pinned') {
        subBodyHtml = \`
          <div class="panel-box" style="margin-bottom:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <div>
                <strong style="font-size:14px;">常驻记忆容量健康 (Pinned Capacity)</strong>
                <span style="font-size:12px; color:var(--muted); margin-left:8px;">每次唤醒或新会话必见 · 绕过检索直达眼前</span>
              </div>
              <span style="font-family:var(--font-mono); font-weight:600; font-size:13px; color:\${pinPct > 90 ? 'var(--danger)' : pinPct > 70 ? 'var(--warn)' : 'var(--ok)'};">
                \${pinned?.used ?? 0} / \${pinned?.budget ?? 1200} 字 (\${pinPct}%)
              </span>
            </div>
            <div class="progress-wrap" style="height:9px; margin-bottom:10px;">
              <div class="progress-bar \${pinPct > 90 ? 'danger' : pinPct > 70 ? 'warn' : ''}" style="width:\${Math.min(pinPct, 100)}%;"></div>
            </div>
            <div style="font-size:12.5px; color:var(--muted); line-height:1.55;">
              <strong>常驻机制（m1.md §五⅛）</strong>：从现行书架挑条目钉上，新会话开头在 <code>&lt;continuity&gt;</code> 顶端注入，不用 recall 检索。
              只在 <code>hotwrite</code> 随情节记录时通过 <code>pin / unpin</code> 调整（会话中途提示词不变）。固定额度 1200 字；若条目冷写改写变长超额，载入时截掉超额并告警。
            </div>
          </div>

          <div style="margin-bottom:20px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <strong style="font-size:14px;">📌 当前常驻条目 (\${pinnedCount} 条 · 合计 \${pinned?.used ?? 0} 字)</strong>
              <span style="font-size:12px; color:var(--muted);">按钉上先后排序</span>
            </div>
            \${(pinned?.entries || []).map(e => \`
              <div class="shelf-card" style="border-left:3px solid var(--accent);">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <div style="display:flex; align-items:center; gap:6px;">
                    <span class="mono-badge">\${esc(names[e.shelf] || e.shelf)}</span>
                    <span class="pinned-badge">📌 占 \${e.chars ?? (e.text || '').length} 字</span>
                    \${e.about ? \`<span class="mono-badge" style="color:var(--accent);">关于 \${esc(e.about)}</span>\` : ''}
                  </div>
                  <span style="font-family:var(--font-mono); font-size:12px; color:var(--muted);">
                    印证 <strong>\${e.for}</strong> · 反例 <strong>\${e.against}</strong> · \${linkifyTags(e.archiveNo)}
                    <button class="btn sm" style="margin-left:6px;" onclick="inspectShelf('\${esc(e.archiveNo)}')">证据链 →</button>
                  </span>
                </div>
                <div style="font-weight:500; font-size:14px; margin:4px 0 2px;">\${esc(e.text)}</div>
                \${e.when ? \`<div class="shelf-row"><span class="shelf-label">当</span><span>\${esc(e.when)}</span></div>\` : ''}
                \${e.then ? \`<div class="shelf-row"><span class="shelf-label">则</span><span>\${esc(e.then)}</span></div>\` : ''}
                \${e.observe ? \`<div class="shelf-row"><span class="shelf-label">观察</span><span>\${esc(e.observe)}</span></div>\` : ''}
                \${e.quote ? \`<div class="shelf-row"><span class="shelf-label">原话</span><span style="font-family:var(--font-serif); font-style:italic;">“\${esc(e.quote)}”</span></div>\` : ''}
              </div>
            \`).join('') || '<div style="color:var(--faint); padding:20px 0; text-align:center;">当前暂无常驻记忆条目。Agent 可在热写时使用 pin 钉入书架条目。</div>'}
          </div>

          <div class="panel-box">
            <strong style="display:block; margin-bottom:10px; font-size:14px;">📜 调整历史审计 (近 30 次 pin.changed 事件)</strong>
            \${(pinned?.history || []).length === 0 ? '<div style="color:var(--faint); font-size:12.5px;">暂无常驻调整历史</div>' : \`
              <div style="display:flex; flex-direction:column; gap:8px;">
                \${(pinned.history || []).map(h => \`
                  <div class="shelf-card" style="margin-bottom:0; background:var(--surface-subtle); padding:10px 14px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; font-family:var(--font-mono); font-size:11.5px; color:var(--muted); margin-bottom:4px;">
                      <span>\${fmtTime(h.at)} · 归档号 \${linkifyTags(h.archiveNo)}</span>
                    </div>
                    \${(h.pin || []).map(p => \`
                      <div style="font-size:12.5px; margin:2px 0;">
                        <span style="color:var(--ok); font-weight:600;">+ 📌 钉入</span>
                        <span class="mono-badge">\${esc(names[p.shelf] || p.shelf)}</span>
                        <strong>\${linkifyTags(p.archiveNo)}</strong>: \${esc(p.text)}
                      </div>
                    \`).join('')}
                    \${(h.unpin || []).map(u => \`
                      <div style="font-size:12.5px; margin:2px 0;">
                        <span style="color:var(--danger); font-weight:600;">- 📍 拔出</span>
                        <span class="mono-badge">\${esc(names[u.shelf] || u.shelf)}</span>
                        <strong>\${linkifyTags(u.archiveNo)}</strong>: \${esc(u.text)}
                      </div>
                    \`).join('')}
                  </div>
                \`).join('')}
              </div>
            \`}
          </div>
        \`;
      } else if (sub === 'threads') {
        const openList = threads?.open || [];
        const closedList = threads?.closed || [];
        subBodyHtml = \`
          <div class="panel-box" style="margin-bottom:16px;">
            <strong style="display:block; margin-bottom:10px; font-size:14px;">🧶 正在开着的线索卷 (Open Threads: \${openList.length})</strong>
            <div style="display:flex; flex-direction:column; gap:8px;">
              \${openList.map(x => \`
                <div class="shelf-card" style="margin-bottom:0;">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong>[\${x.type === 'promise' ? '答应 ' + esc(x.to) : '挂着的事'}] \${esc(x.title)}</strong>
                    <span style="font-family:var(--font-mono); font-size:11.5px; color:var(--muted);">\${linkifyTags(x.archiveNo)}</span>
                  </div>
                  \${(x.notes || []).map(n => \`<div style="font-size:12.5px; color:var(--muted); margin-top:4px;">• \${fmtTime(n.at)}：\${esc(n.text)}</div>\`).join('')}
                </div>
              \`).join('') || '<div style="color:var(--faint); font-size:12.5px;">暂无开着的线索卷</div>'}
            </div>
          </div>

          \${closedList.length > 0 ? \`
            <div class="panel-box">
              <strong style="display:block; margin-bottom:10px; font-size:14px;">📁 已合卷的历史线索卷 (\${closedList.length})</strong>
              <div style="display:flex; flex-direction:column; gap:8px;">
                \${closedList.slice(0, 20).map(x => \`
                  <div class="shelf-card" style="margin-bottom:0; opacity:0.8;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                      <span style="font-size:13px; text-decoration:line-through; color:var(--muted);">[\${x.type === 'promise' ? '答应 ' + esc(x.to) : '挂着的事'}] \${esc(x.title)}</span>
                      <span style="font-family:var(--font-mono); font-size:11.5px; color:var(--muted);">\${linkifyTags(x.archiveNo)}</span>
                    </div>
                    \${(x.notes || []).map(n => \`<div style="font-size:12px; color:var(--muted); margin-top:2px;">• \${fmtTime(n.at)}：\${esc(n.text)}</div>\`).join('')}
                  </div>
                \`).join('')}
              </div>
            </div>
          \` : ''}
        \`;
      } else if (sub === 'gist') {
        subBodyHtml = \`
          <div class="panel-box">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
              <strong style="font-size:14px;">📜 天 / 周 / 月梗概 (Gists: \${gistCount})</strong>
              <span style="font-size:12px; color:var(--muted);">睡眠时由 coldwrite 提炼压缩 · 供唤醒时连续性继承</span>
            </div>
            \${(gists || []).slice().reverse().map(x => \`
              <div style="border-bottom:1px solid var(--border); padding-bottom:12px; margin-bottom:12px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                  <div>
                    <span class="mono-badge">\${esc(x.span)}</span>
                    <strong style="margin-left:6px; font-size:13.5px;">\${esc(x.key)}</strong>
                  </div>
                  <span style="font-family:var(--font-mono); font-size:11.5px; color:var(--muted);">\${x.chars} 字 · \${fmtTime(x.at)}</span>
                </div>
                <div class="serif-body" style="font-size:13.5px; margin-top:6px; line-height:1.6;">\${esc(x.text)}</div>
              </div>
            \`).join('') || '<div style="color:var(--faint); font-size:12.5px;">尚未沉淀长期梗概</div>'}
          </div>
        \`;
      }

      return \`
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); padding-bottom:12px; margin-bottom:16px; flex-wrap:wrap; gap:10px;">
          <div class="sub-tabs">
            <button class="sub-tab-btn \${sub === 'shelf' ? 'active' : ''}" onclick="setReadingSub('shelf')">📚 书架条目 (\${entries.length})</button>
            <button class="sub-tab-btn \${sub === 'pinned' ? 'active' : ''}" onclick="setReadingSub('pinned')">📌 常驻记忆区 (\${pinnedCount} · \${pinned?.used ?? 0}/\${pinned?.budget ?? 1200}字)</button>
            <button class="sub-tab-btn \${sub === 'threads' ? 'active' : ''}" onclick="setReadingSub('threads')">🧶 线索卷 (\${openThreadsCount})</button>
            <button class="sub-tab-btn \${sub === 'gist' ? 'active' : ''}" onclick="setReadingSub('gist')">📜 历史梗概 (\${gistCount})</button>
          </div>
        </div>
        \${subBodyHtml}
      \`;
    }

    function setShelfCategory(cat) {
      STATE.shelfCategory = cat;
      syncRoute(true);
      renderResidentContent();
    }
    function searchShelf(q) {
      STATE.shelfQuery = q.trim();
      renderResidentContent();
    }

    /* ─── Tab 3: 经历时间线 (含 FTS 全文搜索) ─── */
    async function renderExperienceTab(container, id) {
      container.innerHTML = \`<div style="padding:20px; color:var(--muted);">检索经历中…</div>\`;
      const qParam = STATE.expQuery ? '&q=' + encodeURIComponent(STATE.expQuery) : '';
      const kindParam = STATE.expKind !== 'all' ? '&kind=' + encodeURIComponent(STATE.expKind) : '';
      const expRes = await api(\`/v1/experience?agent=\${encodeURIComponent(id)}&limit=\${STATE.expLimit}&order=desc\${qParam}\${kindParam}\`);
      const lines = expRes.lines || [];

      // 按日期分组
      const groups = {};
      lines.forEach(l => {
        const d = new Date(l.at);
        const dayKey = \`\${d.getFullYear()}-\${String(d.getMonth()+1).padStart(2,'0')}-\${String(d.getDate()).padStart(2,'0')}\`;
        if (!groups[dayKey]) groups[dayKey] = [];
        groups[dayKey].push(l);
      });

      const kindLabels = {
        all: '全部经历',
        episode: '仅看情节 (episode)',
        'message.in': '收到的话 (in)',
        'message.out': '我说的话 (out)',
        percept: '身体感知 (percept)',
        situation: '处境 (situation)',
      };

      container.innerHTML = \`
        <div class="filter-bar">
          <div class="filter-pills">
            \${Object.entries(kindLabels).map(([k, v]) => \`
              <span class="pill \${STATE.expKind === k ? 'active' : ''}" onclick="setExpKind('\${k}')">\${v}</span>
            \`).join('')}
          </div>
          <div style="display:flex; gap:8px;">
            <input placeholder="🔍 FTS 全文检索经历…" value="\${esc(STATE.expQuery)}" onkeydown="if(event.key==='Enter') searchExp(this.value)" style="width:220px;">
            <button class="btn sm" onclick="searchExp(this.previousElementSibling.value)">检索</button>
            \${STATE.expQuery ? \`<button class="btn sm" onclick="searchExp('')">清空</button>\` : ''}
          </div>
        </div>

        \${lines.length === 0 ? '<div style="color:var(--faint); padding:30px 0; text-align:center;">没有找到匹配的经历</div>' : \`
          <div style="display:flex; flex-direction:column; gap:16px;">
            \${Object.entries(groups).map(([dayKey, dayLines]) => \`
              <div class="timeline-group">
                <span class="timeline-date">\${dayKey} (\${dayLines.length} 条)</span>
                \${dayLines.map(l => {
                  if (l.kind === 'situation') {
                    return \`
                      <div class="shelf-card" style="padding:6px 12px; margin-bottom:5px; background:var(--surface-subtle); border-left:2px solid var(--border-focus); opacity:0.85;">
                        <div style="display:flex; justify-content:space-between; align-items:center; font-family:var(--font-mono); font-size:11px; color:var(--muted);">
                          <span>⚙️ 宿主/处境变动 · \${linkifyTags(l.archiveNo)}</span>
                          <span>\${fmtTime(l.at)}</span>
                        </div>
                        <div style="font-size:12px; color:var(--muted); margin-top:2px;">\${linkifyTags(l.text)}</div>
                      </div>
                    \`;
                  }
                  return \`
                    <div class="shelf-card" style="padding:10px 14px; margin-bottom:6px;">
                      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                        <div>
                          <span class="mono-badge">\${esc(l.kind)}</span>
                          <span style="font-family:var(--font-mono); font-size:11.5px; color:var(--muted); margin-left:6px;">\${fmtTime(l.at)}</span>
                        </div>
                        \${linkifyTags(l.archiveNo)}
                      </div>
                      <div class="\${l.kind === 'episode' ? 'serif-body' : ''}" style="font-size:13px;">\${linkifyTags(l.text)}</div>
                    </div>
                  \`;
                }).join('')}
              </div>
            \`).join('')}
          </div>
          <div style="text-align:center; margin:20px 0;">
            <button class="btn" onclick="STATE.expLimit += 60; renderResidentContent()">加载更多历史经历 ↓</button>
          </div>
        \`}
      \`;
    }

    function setExpKind(k) {
      STATE.expKind = k;
      syncRoute(true);
      renderResidentContent();
    }
    function searchExp(q) {
      STATE.expQuery = q.trim();
      renderResidentContent();
    }

    /* ─── Tab 4: 我是谁与自我演变 (Visual Diff) ─── */
    function renderSelfTabHtml(s) {
      function renderDiffHtml(diffText) {
        if (!diffText) return '';
        const lines = diffText.split('\\n');
        return lines.map(line => {
          if (line.startsWith('+')) return \`<div class="diff-line add">\${esc(line)}</div>\`;
          if (line.startsWith('-')) return \`<div class="diff-line del">\${esc(line)}</div>\`;
          return \`<div class="diff-line ctx">\${esc(line)}</div>\`;
        }).join('');
      }

      return \`
        <div class="panel-box">
          <div style="display:flex; justify-content:space-between; margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid var(--border);">
            <div>
              <strong style="font-size:15px;">现行自述 · 第 \${s.prompt.version} 版</strong>
              <span style="color:var(--muted); font-size:12px; margin-left:8px;">\${s.prompt.chars} 字 \${s.prompt.at ? '· 更新于 ' + fmtTime(s.prompt.at) : '（初我）'}</span>
            </div>
            <div>\${(s.prompt.evidence || []).map(no => linkifyTags(no)).join(' ')}</div>
          </div>
          \${s.prompt.why ? \`<div style="font-size:12.5px; color:var(--muted); margin-bottom:10px;"><strong>改写原因：</strong>\${esc(s.prompt.why)}</div>\` : ''}
          <div class="serif-body">\${esc(s.prompt.text)}</div>
        </div>

        \${s.origin?.diff ? \`
          <div class="panel-box">
            <strong style="display:block; margin-bottom:8px; font-size:14px;">初我初始化对照 (系统默认 v0 vs Joy 定制)</strong>
            <div style="background:var(--surface-subtle); padding:10px; border-radius:5px;">
              \${renderDiffHtml(s.origin.diff)}
            </div>
          </div>
        \` : ''}

        <h4 style="font-size:13.5px; color:var(--muted); margin:16px 0 10px; font-weight:600;">自述历史版本演变链 (\${(s.history || []).length} 次改写)</h4>
        \${(s.history || []).slice().reverse().map(v => \`
          <div class="shelf-card">
            <div style="display:flex; justify-content:space-between;">
              <strong>第 \${v.version} 版 (\${v.chars} 字)</strong>
              <span style="font-family:var(--font-mono); font-size:12px; color:var(--muted);">\${fmtTime(v.at)} · \${linkifyTags(v.archiveNo)}</span>
            </div>
            <div style="font-size:12.5px; color:var(--muted);">原因：\${esc(v.why)}</div>
            <div style="font-size:12px;">证据依据：\${(v.evidence || []).map(no => linkifyTags(no)).join(' ')}</div>
          </div>
        \`).join('') || '<div style="color:var(--faint);">初我至今尚未发生改写</div>'}
      \`;
    }

    /* ─── Tab 5: 作息、账本与边界设置 ─── */
    function renderScheduleTabHtml(id, sched, wakes) {
      const st = sched.settings || { paused: false, wakeBudget: 3, heartbeat: false };
      return \`
        <div class="panel-box">
          <strong style="display:block; margin-bottom:10px; font-size:14px;">管理员边界设置（权限与配额控制）</strong>
          <div style="display:flex; gap:16px; align-items:center; flex-wrap:wrap;">
            <label><input type="checkbox" id="set-paused" \${st.paused ? 'checked' : ''}> 暂停所有唤醒 (paused)</label>
            <label><input type="checkbox" id="set-hb" \${st.heartbeat ? 'checked' : ''}> 允许心跳 (heartbeat)</label>
            <label>每日唤醒上限：<input type="number" id="set-budget" value="\${st.wakeBudget}" style="width:60px;" min="0" max="20"></label>
            <button class="btn primary sm" onclick="saveResidentSettings('\${esc(id)}')">保存边界设置</button>
          </div>
        </div>

        <div class="panel-box">
          <strong style="display:block; margin-bottom:8px; font-size:14px;">现行作息计划 (Schedule)</strong>
          <div style="font-size:13px; color:var(--muted);">
            下次到期：\${sched.next ? \`\${fmtTime(sched.next.due)} (\${esc(sched.next.by)}\${sched.next.note ? '：' + esc(sched.next.note) : ''})\` : '暂无待响闹钟'} · 今日已用 \${sched.budget?.used ?? 0}/\${sched.budget?.of ?? 3}
          </div>
          \${sched.schedule ? \`<pre style="margin-top:8px; font-family:var(--font-mono); font-size:12px; background:var(--surface-subtle); padding:10px; border-radius:5px; white-space:pre-wrap;">\${esc(JSON.stringify(sched.schedule, null, 2))}</pre>\` : '<div style="margin-top:6px; color:var(--faint);">尚未自行设定规律作息</div>'}
        </div>

        <div class="panel-box">
          <strong style="display:block; margin-bottom:10px; font-size:14px;">最近 7 天唤醒账本与产出</strong>
          <table>
            <thead><tr><th>时间</th><th>唤醒原因</th><th>执行决定</th><th>花费 (USD)</th><th>产出记录</th></tr></thead>
            <tbody>
              \${(wakes.entries || []).slice().reverse().map(e => \`
                <tr>
                  <td style="font-family:var(--font-mono);">\${fmtTime(e.at)}</td>
                  <td>\${esc(e.by)}\${e.note ? ' · ' + esc(e.note) : ''}</td>
                  <td>\${esc(e.decided)}\${e.reason ? ' (' + esc(e.reason) + ')' : ''}</td>
                  <td style="font-family:var(--font-mono);">\${e.run?.costUsd ? '$' + e.run.costUsd.toFixed(2) : '—'}</td>
                  <td style="font-family:var(--font-mono); font-size:11.5px;">\${e.run?.produced ? JSON.stringify(e.run.produced) : '—'}</td>
                </tr>
              \`).join('') || '<tr><td colspan="5" style="color:var(--faint); text-align:center;">暂无唤醒账单</td></tr>'}
            </tbody>
          </table>
        </div>
      \`;
    }

    async function saveResidentSettings(id) {
      try {
        const paused = document.getElementById('set-paused').checked;
        const heartbeat = document.getElementById('set-hb').checked;
        const wakeBudget = Number(document.getElementById('set-budget').value);
        await api('/v1/settings', { method: 'POST', body: { paused, heartbeat, wakeBudget } });
        await refreshHouseData();
        renderResidentContent();
      } catch (e) { showError(e.message); }
    }

    /* ─── 抽屉 Drawer：原件 + 证据链 + 上下文回溯 ─── */
    async function inspectArchive(no) {
      try {
        const d = await api('/v1/archive/' + encodeURIComponent(no) + '/context').catch(() =>
          api('/v1/archive/' + encodeURIComponent(no))
        );
        document.getElementById('drawer-title').textContent = '卷宗原件 · ' + no;
        const p = d.event?.payload || {};
        const text = typeof p.text === 'string' && d.event?.kind !== 'diary' ? p.text : JSON.stringify(p, null, 2);

        let contextHtml = '';
        if (d.context && d.context.length > 0) {
          contextHtml = \`
            <details style="margin-top:12px; background:var(--surface-subtle); padding:10px; border-radius:6px;" open>
              <summary style="cursor:pointer; font-weight:600; font-size:12.5px; color:var(--muted);">展开前后现场对话上下文 (\${d.context.length} 条)</summary>
              <div style="display:flex; flex-direction:column; gap:6px; margin-top:8px;">
                \${d.context.map(c => \`
                  <div style="padding:6px 8px; border-radius:4px; font-size:12px; background:\${c.isSelf ? 'var(--surface)' : 'transparent'}; border:\${c.isSelf ? '1px solid var(--accent)' : 'none'};">
                    <div style="font-family:var(--font-mono); font-size:11px; color:var(--muted); display:flex; justify-content:space-between;">
                      <span>\${esc(c.kind)} \${c.isCited ? '<span class="tag">已被引用</span>' : ''}</span>
                      <span>\${esc(c.archiveNo)} · \${fmtTime(c.at)}</span>
                    </div>
                    <div style="margin-top:2px; white-space:pre-wrap;">\${esc(c.payload?.text || JSON.stringify(c.payload))}</div>
                  </div>
                \`).join('')}
              </div>
            </details>
          \`;
        }

        document.getElementById('drawer-body').innerHTML = \`
          <div>
            <div style="font-size:11.5px; color:var(--muted);">发生时间 / 类型</div>
            <div style="font-family:var(--font-mono); font-size:13px;">\${fmtFullTime(d.event?.at)} · \${esc(d.event?.kind)} (\${esc(d.event?.source)})</div>
          </div>
          <div>
            <div style="font-size:11.5px; color:var(--muted); margin-bottom:4px;">内容详情</div>
            <div class="quote-block">\${d.event?.kind === 'diary' ? '📓 私密日记正文不公开' : esc(text)}</div>
          </div>
          <div>
            <div style="font-size:11.5px; color:var(--muted);">
              正向引用 (\${(d.links || []).length}) / 被引用 (\${(d.referencedBy || []).length})
            </div>
            \${(d.cited && d.cited.length > 0) ? \`
              <div style="margin-top:6px; font-size:12px;">
                <strong>引用的事实依据：</strong>
                \${d.cited.map(c => \`<span class="tag" onclick="inspectArchive('\${esc(c.archiveNo)}')">\${esc(c.archiveNo)} (\${esc(c.kind)})</span>\`).join(' ')}
              </div>
            \` : ''}
          </div>
          \${contextHtml}
        \`;
        openDrawer();
      } catch (e) { showError(e.message); }
    }

    async function inspectShelf(no) {
      try {
        const d = await api('/v1/shelf/' + encodeURIComponent(no));
        document.getElementById('drawer-title').textContent = '书架证据链 · ' + d.currentArchiveNo;
        document.getElementById('drawer-body').innerHTML = \`
          <div>
            <div style="font-size:12px; color:var(--muted); margin-bottom:6px; font-weight:600;">版本演变记录 (\${(d.versions || []).length})</div>
            \${(d.versions || []).map(v => \`
              <div class="shelf-card" style="margin-bottom:8px; padding:10px 12px;">
                <div style="font-family:var(--font-mono); font-size:11.5px; color:var(--muted);">\${esc(v.kind)} · \${linkifyTags(v.archiveNo)} (\${fmtTime(v.at)})</div>
                \${v.why ? \`<div style="font-size:12px; color:var(--ink); margin:2px 0;"><strong>改动理由：</strong>\${esc(v.why)}</div>\` : ''}
                <div style="font-size:13px;">\${esc(v.fields?.text || JSON.stringify(v.fields))}</div>
              </div>
            \`).join('')}
          </div>
          <div>
            <div style="font-size:12px; color:var(--muted); margin-bottom:6px; font-weight:600;">已计印证/反例明细 (\${(d.evidences || []).length})</div>
            \${(d.evidences || []).map(ev => \`
              <div class="shelf-card" style="margin-bottom:8px; padding:10px 12px;">
                <div style="display:flex; justify-content:space-between; font-family:var(--font-mono); font-size:11.5px;">
                  <span>判定依据：<strong style="color:\${ev.stance === 'against' ? 'var(--danger)' : 'var(--ok)'};">\${esc(ev.stance)}</strong></span>
                  <span>\${linkifyTags(ev.archiveNo)} · \${fmtTime(ev.at)}</span>
                </div>
                \${ev.note ? \`<div style="font-size:12px; color:var(--muted); margin:3px 0;">批注：\${esc(ev.note)}</div>\` : ''}
                <div class="quote-block" style="font-size:12.5px; margin-top:3px;">\${esc(ev.text)}</div>
              </div>
            \`).join('')}
          </div>
        \`;
        openDrawer();
      } catch (e) { showError(e.message); }
    }

    function openBirthModal() {
      document.getElementById('drawer-title').textContent = '添加新住户 / 出生 (birth)';
      document.getElementById('drawer-body').innerHTML = \`
        <label>住户 ID（小写字母/数字）：<input id="birth-id" placeholder="如 a3" style="width:100%; margin:4px 0 10px;"></label>
        <label>模型（如 gemini-4-argon, claude-opus-5-5）：<input id="birth-model" placeholder="填入模型名" style="width:100%; margin:4px 0 10px;"></label>
        <label>Soma 地址（可选）：<input id="birth-soma" placeholder="如 http://127.0.0.1:30151" style="width:100%; margin:4px 0 10px;"></label>
        <label>初我补充定制（可选）：<textarea id="birth-user" rows="4" style="width:100%; margin:4px 0 12px;"></textarea></label>
        <button class="btn primary" onclick="submitBirth()">确认出生并冻结初我</button>
      \`;
      openDrawer();
    }
    async function submitBirth() {
      try {
        const id = document.getElementById('birth-id').value.trim();
        const model = document.getElementById('birth-model').value.trim();
        const soma = document.getElementById('birth-soma').value.trim();
        const userText = document.getElementById('birth-user').value.trim();
        await api('/v1/house/residents', { method: 'POST', body: { id, model, ...(soma ? { soma } : {}), ...(userText ? { userText } : {}) } });
        closeDrawer();
        await refreshHouseData();
        selectResident(id);
      } catch (e) { showError(e.message); }
    }

    function openDrawer() {
      document.getElementById('drawer-overlay').classList.add('open');
      document.getElementById('drawer').classList.add('open');
    }
    function closeDrawer() {
      document.getElementById('drawer-overlay').classList.remove('open');
      document.getElementById('drawer').classList.remove('open');
    }

    init();
  </script>
</body>
</html>`;
}
