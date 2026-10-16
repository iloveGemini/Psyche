/**
 * Psyche Dashboard 单页前端（notes/design/dashboard.md）：
 * 挂在 GET /dashboard，直出零依赖 HTML，通过浏览器 fetch 调 /v1/*。
 * 服务端在直出 HTML 时自动注入各住户的 Token 映射，实现人类在本地免输 Token、机器间保持严格租户隔离。
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
      --font-serif: "Songti SC", "Source Han Serif SC", "Newsreader", "Georgia", serif;
      --font-sans: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", "Inter", sans-serif;
      --font-mono: "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
    }
    [data-theme="dark"] {
      --bg: #141311;
      --surface: #1C1B18;
      --surface-subtle: #24221E;
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
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--ink);
      font-family: var(--font-sans);
      line-height: 1.55;
      font-size: 14px;
      -webkit-font-smoothing: antialiased;
      min-height: 100vh;
    }
    header {
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      position: sticky;
      top: 0;
      z-index: 20;
    }
    .header-inner {
      max-width: 1140px;
      margin: 0 auto;
      padding: 12px 24px;
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
    }
    .brand-mark {
      width: 24px;
      height: 24px;
      border-radius: 4px;
      background: var(--ink);
      color: var(--surface);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: var(--font-serif);
      font-size: 14px;
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
      padding: 5px 12px;
      border: none;
      background: transparent;
      color: var(--muted);
      font-size: 13px;
      border-radius: 4px;
      cursor: pointer;
      font-family: inherit;
    }
    .nav-btn.active {
      background: var(--surface);
      color: var(--ink);
      font-weight: 600;
      box-shadow: 0 1px 2px rgba(0,0,0,0.06);
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .badge-auth {
      font-family: var(--font-mono);
      font-size: 11.5px;
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
      border-radius: 4px;
      padding: 5px 10px;
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
      border-radius: 4px;
      font-size: 12.5px;
      color: var(--ink);
      cursor: pointer;
      font-family: inherit;
    }
    .btn:hover { border-color: var(--border-focus); }
    .btn.primary {
      background: var(--ink);
      color: var(--surface);
      border-color: var(--ink);
    }
    main {
      max-width: 1140px;
      margin: 0 auto;
      padding: 24px;
    }
    .house-bar {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }
    .joy-status {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .status-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--faint);
      display: inline-block;
    }
    .status-dot.on { background: var(--ok); }
    .cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
      gap: 18px;
      margin-bottom: 28px;
    }
    .resident-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      cursor: pointer;
      transition: border-color 0.15s, transform 0.15s;
    }
    .resident-card:hover {
      border-color: var(--border-focus);
      transform: translateY(-1px);
    }
    .card-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px;
    }
    .resident-name { font-size: 17px; font-weight: 600; }
    .mono-badge {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--muted);
      background: var(--surface-subtle);
      padding: 2px 6px;
      border-radius: 3px;
      border: 1px solid var(--border);
    }
    .state-badge {
      font-size: 12px;
      padding: 2px 8px;
      border-radius: 12px;
      font-weight: 500;
    }
    .state-badge.idle { background: var(--ok-bg); color: var(--ok); }
    .state-badge.busy { background: var(--warn-bg); color: var(--warn); }
    .state-badge.asleep { background: var(--accent-bg); color: var(--accent); }
    .state-badge.offline { background: var(--surface-subtle); color: var(--muted); }
    .card-mood {
      font-family: var(--font-serif);
      font-style: italic;
      color: var(--muted);
      font-size: 13px;
      background: var(--surface-subtle);
      padding: 8px 12px;
      border-radius: 4px;
      border-left: 2px solid var(--border-focus);
    }
    .card-divider { height: 1px; background: var(--border); border: none; }
    .card-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
      color: var(--muted);
      font-family: var(--font-mono);
    }
    .wake-dots { display: flex; gap: 3px; align-items: center; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--border); display: inline-block; }
    .dot.filled { background: var(--accent); }
    .resident-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 14px;
      flex-wrap: wrap;
      gap: 12px;
    }
    .sub-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
    .sub-tab-btn {
      padding: 6px 14px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--muted);
      font-size: 13px;
      border-radius: 5px;
      cursor: pointer;
    }
    .sub-tab-btn.active {
      background: var(--surface);
      color: var(--ink);
      font-weight: 600;
      border-color: var(--border);
    }
    .health-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 14px;
      margin-bottom: 20px;
    }
    .metric-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 15px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .metric-title { font-size: 12px; color: var(--muted); }
    .metric-val { font-size: 22px; font-family: var(--font-mono); font-weight: 600; }
    .metric-sub { font-size: 12px; color: var(--muted); }
    .warning-box {
      background: var(--danger-bg);
      border: 1px solid var(--danger);
      border-left-width: 4px;
      border-radius: 6px;
      padding: 12px 16px;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }
    .sealed-strip {
      background: var(--surface-subtle);
      border: 1px dashed var(--border);
      border-radius: 6px;
      padding: 12px 16px;
      color: var(--muted);
      font-size: 13px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 16px;
      flex-wrap: wrap;
      gap: 8px;
    }
    .panel-box {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 18px;
    }
    .serif-body {
      font-family: var(--font-serif);
      font-size: 15px;
      line-height: 1.7;
      max-width: 68ch;
      white-space: pre-wrap;
    }
    .tag {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--accent);
      background: var(--accent-bg);
      padding: 1px 6px;
      border-radius: 3px;
      cursor: pointer;
      text-decoration: underline;
      display: inline-block;
      margin: 0 2px;
    }
    .shelf-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px 18px;
      margin-bottom: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .shelf-card.flagged { border-left: 4px solid var(--danger); }
    .shelf-row { display: flex; gap: 10px; font-size: 13.5px; }
    .shelf-label { color: var(--muted); min-width: 56px; font-size: 12.5px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }
    th { color: var(--muted); font-weight: 500; font-size: 12px; }
    .drawer-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.3);
      z-index: 50;
      display: none;
    }
    .drawer-overlay.open { display: block; }
    .drawer {
      position: fixed;
      right: 0;
      top: 0;
      bottom: 0;
      width: 440px;
      max-width: 92vw;
      background: var(--surface);
      border-left: 1px solid var(--border);
      box-shadow: -4px 0 24px rgba(0,0,0,0.1);
      z-index: 51;
      transform: translateX(100%);
      transition: transform 0.22s ease;
      display: flex;
      flex-direction: column;
    }
    .drawer.open { transform: translateX(0); }
    .drawer-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .drawer-body {
      padding: 20px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .quote-block {
      font-family: var(--font-serif);
      font-size: 14px;
      line-height: 1.65;
      background: var(--surface-subtle);
      padding: 12px 14px;
      border-radius: 6px;
      border-left: 3px solid var(--accent);
      white-space: pre-wrap;
    }
  </style>
</head>
<body data-theme="light">
  <header>
    <div class="header-inner">
      <div class="brand" onclick="selectResident(null)">
        <div class="brand-mark">Ψ</div>
        <span>Psyche 档案馆与阅览室</span>
      </div>
      <div class="nav-tabs" id="top-nav">
        <button class="nav-btn active" onclick="selectResident(null)">屋子总览</button>
      </div>
      <div class="header-actions">
        <span class="badge-auth" id="auth-badge"><span class="badge-dot"></span> 租户隔离 · 本地直通</span>
        <button class="btn" onclick="openBirthModal()">+ 添加 / 出生</button>
        <button class="btn" onclick="toggleTheme()" id="theme-btn">🌙 深夜台灯</button>
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
      <strong id="drawer-title" style="font-family:var(--font-mono); color:var(--accent);">卷宗抽屉</strong>
      <button class="btn" onclick="closeDrawer()">关闭</button>
    </div>
    <div class="drawer-body" id="drawer-body"></div>
  </div>

  <script>
    const INJECTED_TOKENS = ${tokensJson};
    // 清除可能存留在本地浏览器里的旧单 Token，完全走服务端注入的住户 Token 分发
    try { localStorage.removeItem('psyche_token'); } catch (e) {}

    const STATE = {
      token: '',
      agent: new URLSearchParams(location.search).get('agent') || null,
      subTab: 'health',
      shelfTab: 'shelf',
      shelfFilter: '',
      house: null,
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
    function linkifyTags(text) {
      return esc(text).replace(/\\[?((?:[A-Z0-9_]+\\/)?(?:\\d{4}-)?\\d{2}-\\d{2}#\\d+)\\]?/g, (m, no) =>
        \`<span class="tag" onclick="event.stopPropagation(); inspectArchive('\${no}')">\${no}</span>\`
      );
    }
    async function api(path, opts = {}) {
      const headers = { ...(opts.headers || {}) };
      // 自动匹配 token：优先取目标 agent 的专属 token；若全屋请求（如 /v1/house）则取任意一个有效 token
      const url = new URL(path, location.origin);
      const targetAgent = url.searchParams.get('agent') || STATE.agent;
      const autoToken = (targetAgent && INJECTED_TOKENS[targetAgent]) || (targetAgent ? '' : Object.values(INJECTED_TOKENS)[0]) || '';
      const token = autoToken || STATE.token;
      if (token) headers['authorization'] = 'Bearer ' + token;

      if (opts.body && typeof opts.body === 'object') {
        headers['content-type'] = 'application/json';
        opts.body = JSON.stringify(opts.body);
      }
      const res = await fetch(path, { ...opts, headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      return data;
    }
    function showError(msg) {
      const el = document.getElementById('error-banner');
      if (!msg) { el.style.display = 'none'; return; }
      el.style.display = 'flex';
      el.innerHTML = \`<span>⚠️ \${esc(msg)}</span><button class="btn" onclick="showError(null)">关闭</button>\`;
    }
    function toggleTheme() {
      const dark = document.body.getAttribute('data-theme') === 'dark';
      document.body.setAttribute('data-theme', dark ? 'light' : 'dark');
      document.getElementById('theme-btn').textContent = dark ? '🌙 深夜台灯' : '☀️ 档案纸';
    }
    function selectResident(id) {
      STATE.agent = id;
      const url = new URL(location.href);
      if (id) url.searchParams.set('agent', id);
      else url.searchParams.delete('agent');
      history.replaceState(null, '', url);
      refresh();
    }
    function renderTopNav() {
      const nav = document.getElementById('top-nav');
      const rs = STATE.house?.residents || [];
      nav.innerHTML = [
        \`<button class="nav-btn \${!STATE.agent ? 'active' : ''}" onclick="selectResident(null)">屋子总览</button>\`,
        ...rs.map(r => \`<button class="nav-btn \${STATE.agent === r.id ? 'active' : ''}" onclick="selectResident('\${esc(r.id)}')">\${esc(r.name || r.id)}</button>\`)
      ].join('');
    }
    async function refresh() {
      showError(null);
      try {
        STATE.house = await api('/v1/house');
        renderTopNav();
        if (!STATE.agent) {
          document.getElementById('view-house').style.display = 'block';
          document.getElementById('view-resident').style.display = 'none';
          renderHouse();
        } else {
          document.getElementById('view-house').style.display = 'none';
          document.getElementById('view-resident').style.display = 'block';
          await renderResident(STATE.agent);
        }
      } catch (e) {
        showError(e.message);
      }
    }
    function renderHouse() {
      const h = STATE.house;
      const stateLabel = { idle: '闲', busy: '忙', asleep: '睡着整理', offline: '离线' };
      const el = document.getElementById('view-house');
      el.innerHTML = \`
        <div class="house-bar">
          <div class="joy-status">
            <span class="status-dot \${h.joy?.home ? 'on' : ''}"></span>
            <strong>Joy \${h.joy?.home ? '在家' : '不在家'}</strong>
            <input id="joy-mood-input" value="\${esc(h.joy?.mood || '')}" placeholder="挂个心情个签（回车保存）" style="width:220px;" onkeydown="if(event.key==='Enter') updateJoyMood(this.value)">
            <button class="btn" onclick="updateJoyMood(document.getElementById('joy-mood-input').value)">保存个签</button>
          </div>
          <div style="font-family:var(--font-mono); font-size:12.5px; color:var(--muted);">
            共住 <strong>\${(h.residents || []).length}</strong> 人
          </div>
        </div>
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
                \${r.listening ? \`<div style="font-size:12px; color:var(--accent);">🎧 \${esc(r.listening)}</div>\` : ''}
                <hr class="card-divider">
                <div class="card-footer">
                  <div class="wake-dots">
                    <span>额度 \${used}/\${of}</span> \${dots}
                    \${r.wake?.paused ? '<span style="color:var(--danger); margin-left:4px;">(已暂停)</span>' : ''}
                  </div>
                  <span>\${p.episodes} 情节 · \${p.shelf} 书架 · \${p.openThreads} 卷</span>
                </div>
              </div>
            \`;
          }).join('')}
        </div>
      \`;
    }
    async function updateJoyMood(text) {
      try {
        await api('/v1/house/joy/mood', { method: 'POST', body: { text } });
        refresh();
      } catch (e) { showError(e.message); }
    }
    async function renderResident(id) {
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
            <button class="sub-tab-btn \${STATE.subTab === 'health' ? 'active' : ''}" onclick="setSubTab('health')">记忆体检</button>
            <button class="sub-tab-btn \${STATE.subTab === 'self' ? 'active' : ''}" onclick="setSubTab('self')">我是谁</button>
            <button class="sub-tab-btn \${STATE.subTab === 'reading' ? 'active' : ''}" onclick="setSubTab('reading')">阅览室与经历</button>
            <button class="sub-tab-btn \${STATE.subTab === 'schedule' ? 'active' : ''}" onclick="setSubTab('schedule')">作息与设置</button>
          </div>
        </div>
        <div id="resident-sub-body">加载中…</div>
      \`;
      const body = document.getElementById('resident-sub-body');
      const q = '?agent=' + encodeURIComponent(id);
      if (STATE.subTab === 'health') {
        const h = await api('/v1/health' + q);
        body.innerHTML = \`
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
              <span class="metric-title">单条字数中位数</span>
              <span class="metric-val">\${h.hotwrite.medianChars} 字</span>
              <span class="metric-sub">\${Math.round(h.hotwrite.withFeltRatio * 100)}% 写下感受 · 改写 \${h.hotwrite.revisionsTotal} 次</span>
            </div>
            <div class="metric-card">
              <span class="metric-title">连续性种子容量</span>
              <span class="metric-val">\${h.continuity.seedChars} / \${h.continuity.seedBudget}</span>
              <span class="metric-sub">梗概：天 \${h.continuity.gists.day} · 周 \${h.continuity.gists.week} · 月 \${h.continuity.gists.month}</span>
            </div>
          </div>
          \${(h.coldwrite.warnings || []).map(w => \`
            <div class="warning-box">
              <div>
                <strong style="color:var(--danger);">⚠️ 闭环预警 (\${w.reason === 'no_against' ? '只攒印证 0 反例，留意过宽自我证实' : '超过 7 天未验证'})</strong>
                <div style="font-size:13px; margin-top:4px;">
                  书架条目 \${linkifyTags(w.archiveNo)}（\${w.shelf}）· 印证 \${w.for} · 反例 \${w.against} · 改写 \${w.revisions}
                </div>
              </div>
              <button class="btn" onclick="inspectShelf('\${esc(w.archiveNo)}')">查看证据链 →</button>
            </div>
          \`).join('')}
          <div class="panel-box">
            <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:16px; font-size:13px;">
              <div><strong>书架分布：</strong>事实 \${h.coldwrite.shelves.fact} · 明说规矩 \${h.coldwrite.shelves.told} · 规律 \${h.coldwrite.shelves.rule} · 镜子 \${h.coldwrite.shelves.mirror} · 留意 \${h.coldwrite.shelves.attend} · 关系 \${h.coldwrite.shelves.relation}</div>
              <div><strong>待冷写材料：</strong>新情节 \${h.coldwrite.episodesSinceLast} · 候选证据 \${h.coldwrite.pendingCandidates} · 反馈对 \${h.coldwrite.pendingFeedback}</div>
              <div><strong>线索卷：</strong>承诺 \${h.threads.openPromises} · 挂着的事 \${h.threads.openMatters} · 已合卷 \${h.threads.closedTotal}（最久未动 \${h.threads.oldestIdleDays} 天）</div>
            </div>
          </div>
          <div class="sealed-strip">
            <span>📓 <strong>私密自留地</strong> · 随笔日记 \${h.privateCounts.diaries} 篇（最近 \${fmtTime(h.privateCounts.lastDiaryAt)}）· 住户间信件 \${h.privateCounts.peerMails} 封 · 未翻开信件 \${h.privateCounts.unreadMails} 封</span>
            <span style="font-size:12px;">机制契约：只计数量，不向面板公开正文</span>
          </div>
        \`;
      } else if (STATE.subTab === 'self') {
        const s = await api('/v1/self' + q);
        body.innerHTML = \`
          <div class="panel-box">
            <div style="display:flex; justify-content:space-between; margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid var(--border);">
              <div>
                <strong>现行自述 · 第 \${s.prompt.version} 版</strong>
                <span style="color:var(--muted); font-size:12px; margin-left:8px;">\${s.prompt.chars} 字 \${s.prompt.at ? '· 更新于 ' + fmtTime(s.prompt.at) : '（初我）'}</span>
              </div>
              <div>\${(s.prompt.evidence || []).map(no => linkifyTags(no)).join(' ')}</div>
            </div>
            \${s.prompt.why ? \`<div style="font-size:13px; color:var(--muted); margin-bottom:12px;"><strong>改写原因：</strong>\${esc(s.prompt.why)}</div>\` : ''}
            <div class="serif-body">\${esc(s.prompt.text)}</div>
          </div>
          \${s.origin?.diff ? \`
            <div class="panel-box">
              <strong style="display:block; margin-bottom:8px;">初我初始化改动 (系统 v0 vs Joy)</strong>
              <pre style="font-family:var(--font-mono); font-size:12px; white-space:pre-wrap; color:var(--muted);">\${esc(s.origin.diff)}</pre>
            </div>
          \` : ''}
          <h4 style="font-size:13px; color:var(--muted); margin-bottom:10px; font-family:var(--font-mono);">历史版本 (\${(s.history || []).length})</h4>
          \${(s.history || []).slice().reverse().map(v => \`
            <div class="shelf-card">
              <div style="display:flex; justify-content:space-between;">
                <strong>第 \${v.version} 版 (\${v.chars} 字)</strong>
                <span style="font-family:var(--font-mono); font-size:12px; color:var(--muted);">\${fmtTime(v.at)} · \${linkifyTags(v.archiveNo)}</span>
              </div>
              <div style="font-size:13px; color:var(--muted);">原因：\${esc(v.why)}</div>
              <div style="font-size:12px;">证据：\${(v.evidence || []).map(no => linkifyTags(no)).join(' ')}</div>
            </div>
          \`).join('')}
        \`;
      } else if (STATE.subTab === 'reading') {
        await renderReadingSubTab(id, body);
      } else if (STATE.subTab === 'schedule') {
        const [sched, wakes] = await Promise.all([api('/v1/schedule' + q), api('/v1/wakes?days=7&agent=' + encodeURIComponent(id))]);
        const st = sched.settings || { paused: false, wakeBudget: 3, heartbeat: false };
        body.innerHTML = \`
          <div class="panel-box">
            <strong style="display:block; margin-bottom:12px;">管理员边界设置（只改权限与配额，不改记忆内容）</strong>
            <div style="display:flex; gap:18px; align-items:center; flex-wrap:wrap;">
              <label><input type="checkbox" id="set-paused" \${st.paused ? 'checked' : ''}> 暂停唤醒 (paused)</label>
              <label><input type="checkbox" id="set-hb" \${st.heartbeat ? 'checked' : ''}> 允许心跳开关 (heartbeat)</label>
              <label>每日唤醒额度：<input type="number" id="set-budget" value="\${st.wakeBudget}" style="width:64px;" min="0" max="20"></label>
              <button class="btn primary" onclick="saveResidentSettings('\${esc(id)}')">保存设置</button>
            </div>
          </div>
          <div class="panel-box">
            <strong style="display:block; margin-bottom:8px;">它自己写的现行作息</strong>
            <div style="font-size:13px; color:var(--muted);">
              下次唤醒：\${sched.next ? \`\${fmtTime(sched.next.due)} (\${esc(sched.next.by)}\${sched.next.note ? '：' + esc(sched.next.note) : ''})\` : '暂无'} · 今日已用额度 \${sched.budget?.used ?? 0}/\${sched.budget?.of ?? 3}
            </div>
            \${sched.schedule ? \`<pre style="margin-top:10px; font-family:var(--font-mono); font-size:12px; white-space:pre-wrap; color:var(--ink);">\${esc(JSON.stringify(sched.schedule, null, 2))}</pre>\` : '<div style="margin-top:8px; color:var(--faint);">尚未设定作息</div>'}
          </div>
          <div class="panel-box">
            <strong style="display:block; margin-bottom:10px;">最近 7 天唤醒账本</strong>
            <table>
              <thead><tr><th>时间</th><th>原因</th><th>决定</th><th>花费</th><th>产出</th></tr></thead>
              <tbody>
                \${(wakes.entries || []).slice().reverse().map(e => \`
                  <tr>
                    <td style="font-family:var(--font-mono);">\${fmtTime(e.at)}</td>
                    <td>\${esc(e.by)}\${e.note ? ' · ' + esc(e.note) : ''}</td>
                    <td>\${esc(e.decided)}\${e.reason ? ' (' + esc(e.reason) + ')' : ''}</td>
                    <td style="font-family:var(--font-mono);">\${e.run?.costUsd ? '$' + e.run.costUsd.toFixed(2) : '—'}</td>
                    <td style="font-family:var(--font-mono); font-size:12px;">\${e.run?.produced ? JSON.stringify(e.run.produced) : '—'}</td>
                  </tr>
                \`).join('') || '<tr><td colspan="5" style="color:var(--faint);">暂无记录</td></tr>'}
              </tbody>
            </table>
          </div>
        \`;
      }
    }
    async function renderReadingSubTab(id, body) {
      const q = '?agent=' + encodeURIComponent(id);
      const navHtml = \`
        <div style="display:flex; gap:8px; margin-bottom:16px;">
          <button class="btn \${STATE.shelfTab === 'shelf' ? 'primary' : ''}" onclick="STATE.shelfTab='shelf'; renderResident('\${esc(id)}')">书架</button>
          <button class="btn \${STATE.shelfTab === 'threads' ? 'primary' : ''}" onclick="STATE.shelfTab='threads'; renderResident('\${esc(id)}')">还开着的事</button>
          <button class="btn \${STATE.shelfTab === 'gist' ? 'primary' : ''}" onclick="STATE.shelfTab='gist'; renderResident('\${esc(id)}')">天/周/月梗概</button>
          <button class="btn \${STATE.shelfTab === 'episodes' ? 'primary' : ''}" onclick="STATE.shelfTab='episodes'; renderResident('\${esc(id)}')">经历与情节流</button>
        </div>
      \`;
      if (STATE.shelfTab === 'shelf') {
        const { entries } = await api('/v1/shelf' + q);
        const names = { fact: '事实', told: '明说的规矩', rule: '规律', mirror: '镜子', attend: '留意', relation: '关系' };
        body.innerHTML = navHtml + (entries || []).map(e => {
          const warn = (e.shelf === 'rule' || e.shelf === 'mirror') && e.for >= 3 && e.against === 0;
          return \`
            <div class="shelf-card \${warn ? 'flagged' : ''}">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <span class="mono-badge">\${esc(names[e.shelf] || e.shelf)}\${e.about ? ' · ' + esc(e.about) : ''}</span>
                <span style="font-family:var(--font-mono); font-size:12px; color:var(--muted);">
                  印证 <strong>\${e.for}</strong> · 反例 <strong>\${e.against}</strong> · \${linkifyTags(e.archiveNo)}
                  <button class="btn" style="margin-left:6px; padding:2px 8px;" onclick="inspectShelf('\${esc(e.archiveNo)}')">证据链</button>
                </span>
              </div>
              <div style="font-weight:500; font-size:14.5px;">\${esc(e.text)}</div>
              \${e.when ? \`<div class="shelf-row"><span class="shelf-label">当</span><span>\${esc(e.when)}</span></div>\` : ''}
              \${e.then ? \`<div class="shelf-row"><span class="shelf-label">则</span><span>\${esc(e.then)}</span></div>\` : ''}
              \${e.observe ? \`<div class="shelf-row"><span class="shelf-label">观察</span><span>\${esc(e.observe)}</span></div>\` : ''}
              \${e.quote ? \`<div class="shelf-row"><span class="shelf-label">原话</span><span style="font-family:var(--font-serif); font-style:italic;">“\${esc(e.quote)}”</span></div>\` : ''}
            </div>
          \`;
        }).join('') || (navHtml + '<div style="color:var(--faint);">书架暂空</div>');
      } else if (STATE.shelfTab === 'threads') {
        const t = await api('/v1/threads?all=1&agent=' + encodeURIComponent(id));
        const all = [...(t.open || []), ...(t.closed || [])];
        body.innerHTML = navHtml + (all.map(x => \`
          <div class="shelf-card">
            <div style="display:flex; justify-content:space-between;">
              <strong>[\${x.type === 'promise' ? '答应 ' + esc(x.to) : '挂着的事'}] \${esc(x.title)}</strong>
              <span style="font-family:var(--font-mono); font-size:12px;">\${x.closed ? '已合卷 (' + esc(x.closed.how) + ')' : '开卷中'} · \${linkifyTags(x.archiveNo)}</span>
            </div>
            \${(x.notes || []).map(n => \`<div style="font-size:13px; color:var(--muted);">• \${fmtTime(n.at)}：\${esc(n.text)}</div>\`).join('')}
            \${x.closed ? \`<div style="font-size:13px; color:var(--ok);">合卷原因：\${esc(x.closed.why)}</div>\` : ''}
          </div>
        \`).join('') || '<div style="color:var(--faint);">暂无线索卷</div>');
      } else if (STATE.shelfTab === 'gist') {
        const g = await api('/v1/gist' + q);
        body.innerHTML = navHtml + ((g.gists || []).slice().reverse().map(x => \`
          <div class="panel-box">
            <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
              <strong>[\${esc(x.span)}] \${esc(x.key)}</strong>
              <span style="font-family:var(--font-mono); font-size:12px; color:var(--muted);">\${x.chars} 字 · \${fmtTime(x.at)}</span>
            </div>
            <div class="serif-body">\${esc(x.text)}</div>
          </div>
        \`).join('') || '<div style="color:var(--faint);">尚未写过梗概</div>');
      } else {
        const exp = await api('/v1/experience?limit=80&agent=' + encodeURIComponent(id));
        const eps = (exp.lines || []).filter(l => l.kind === 'episode').reverse();
        body.innerHTML = navHtml + (eps.map(l => \`
          <div class="shelf-card">
            <div style="display:flex; justify-content:space-between;">
              <span class="mono-badge">情节</span>
              <span style="font-family:var(--font-mono); font-size:12px; color:var(--muted);">\${fmtTime(l.at)} · \${linkifyTags(l.archiveNo)}</span>
            </div>
            <div class="serif-body">\${linkifyTags(l.text)}</div>
          </div>
        \`).join('') || '<div style="color:var(--faint);">暂无已热写情节</div>');
      }
    }
    function setSubTab(tab) {
      STATE.subTab = tab;
      renderResident(STATE.agent);
    }
    async function saveResidentSettings(id) {
      try {
        const paused = document.getElementById('set-paused').checked;
        const heartbeat = document.getElementById('set-hb').checked;
        const wakeBudget = Number(document.getElementById('set-budget').value);
        await api('/v1/settings?agent=' + encodeURIComponent(id), { method: 'POST', body: { paused, heartbeat, wakeBudget } });
        refresh();
      } catch (e) { showError(e.message); }
    }
    async function inspectArchive(no) {
      const agent = STATE.agent || STATE.house?.residents?.[0]?.id || '';
      try {
        const d = await api('/v1/archive/' + encodeURIComponent(no) + (agent ? '?agent=' + encodeURIComponent(agent) : ''));
        document.getElementById('drawer-title').textContent = '卷宗原件 · ' + no;
        const p = d.event?.payload || {};
        const text = typeof p.text === 'string' && d.event?.kind !== 'diary' ? p.text : JSON.stringify(p, null, 2);
        document.getElementById('drawer-body').innerHTML = \`
          <div><div style="font-size:12px; color:var(--muted);">发生时间 / 类型</div><div style="font-family:var(--font-mono);">\${fmtTime(d.event?.at)} · \${esc(d.event?.kind)} (\${esc(d.event?.source)})</div></div>
          <div><div style="font-size:12px; color:var(--muted); margin-bottom:6px;">内容</div><div class="quote-block">\${d.event?.kind === 'diary' ? '📓 私密日记正文不公开' : esc(text)}</div></div>
          <div><div style="font-size:12px; color:var(--muted);">正向引用 (\${(d.links || []).length}) / 被引用 (\${(d.referencedBy || []).length})</div></div>
        \`;
        openDrawer();
      } catch (e) { showError(e.message); }
    }
    async function inspectShelf(no) {
      const agent = STATE.agent || STATE.house?.residents?.[0]?.id || '';
      try {
        const d = await api('/v1/shelf/' + encodeURIComponent(no) + (agent ? '?agent=' + encodeURIComponent(agent) : ''));
        document.getElementById('drawer-title').textContent = '书架证据链 · ' + d.currentArchiveNo;
        document.getElementById('drawer-body').innerHTML = \`
          <div>
            <div style="font-size:12px; color:var(--muted); margin-bottom:6px;">版本演变 (\${(d.versions || []).length})</div>
            \${(d.versions || []).map(v => \`
              <div class="shelf-card" style="margin-bottom:8px;">
                <div style="font-family:var(--font-mono); font-size:12px;">\${esc(v.kind)} · \${linkifyTags(v.archiveNo)} (\${fmtTime(v.at)})</div>
                \${v.why ? \`<div style="font-size:12.5px; color:var(--muted);">原因：\${esc(v.why)}</div>\` : ''}
                <div style="font-size:13px;">\${esc(v.fields?.text || JSON.stringify(v.fields))}</div>
              </div>
            \`).join('')}
          </div>
          <div>
            <div style="font-size:12px; color:var(--muted); margin-bottom:6px;">已计证据明细 (\${(d.evidences || []).length})</div>
            \${(d.evidences || []).map(ev => \`
              <div class="shelf-card" style="margin-bottom:8px;">
                <div style="display:flex; justify-content:space-between; font-family:var(--font-mono); font-size:12px;">
                  <span>判定：<strong>\${esc(ev.stance)}</strong></span>
                  <span>\${linkifyTags(ev.archiveNo)} · \${fmtTime(ev.at)}</span>
                </div>
                \${ev.note ? \`<div style="font-size:12.5px; color:var(--muted);">批注：\${esc(ev.note)}</div>\` : ''}
                <div class="quote-block" style="font-size:13px;">\${esc(ev.text)}</div>
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
        <label>住户 ID（小写字母/数字）：<input id="birth-id" placeholder="如 a2" style="width:100%; margin-top:4px;"></label>
        <label>模型（一个模型 = 一个 Agent）：<input id="birth-model" placeholder="如 gemini-4-argon" style="width:100%; margin-top:4px;"></label>
        <label>Soma 地址（可选）：<input id="birth-soma" placeholder="如 http://127.0.0.1:30152" style="width:100%; margin-top:4px;"></label>
        <label>初我补充全文（可选，留空用系统初我）：<textarea id="birth-user" rows="5" style="width:100%; margin-top:4px;"></textarea></label>
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
    refresh();
  </script>
</body>
</html>`;
}
