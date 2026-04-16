(function () {
  const jsLoadedEl = document.getElementById('ccJsLoaded');
  const lastActionEl = document.getElementById('ccLastAction');
  const lastApiEl = document.getElementById('ccLastApi');
  const lastErrorEl = document.getElementById('ccLastError');
  const debugLogEl = document.getElementById('ccDebugLog');
  const debugSectionEl = document.querySelector('.cc-debug');
  const debugToggleBtn = document.getElementById('ccDebugToggle');
  const cinematicToggleEl = document.getElementById('ccCinematicToggle');

  function setText(el, v) {
    if (!el) return;
    el.textContent = String(v == null ? '' : v);
  }

  function logDebug(line) {
    if (!debugLogEl) return;
    const ts = new Date().toISOString();
    debugLogEl.textContent = (debugLogEl.textContent ? debugLogEl.textContent + '\n' : '') + `[${ts}] ${line}`;
    debugLogEl.scrollTop = debugLogEl.scrollHeight;
  }

  setText(jsLoadedEl, 'YES');
  logDebug('command-center.js loaded');
  const DEBUG_VIS_KEY = 'shadow.commandcenter.debug.visible';

  function setDebugVisible(visible) {
    if (!debugSectionEl || !debugToggleBtn) return;
    debugSectionEl.classList.toggle('cc-debug-collapsed', !visible);
    debugToggleBtn.textContent = visible ? 'HIDE' : 'SHOW';
    try { localStorage.setItem(DEBUG_VIS_KEY, visible ? '1' : '0'); } catch (_) {}
  }

  function loadDebugVisible() {
    try {
      const raw = localStorage.getItem(DEBUG_VIS_KEY);
      if (raw == null) return true;
      return raw === '1';
    } catch (_) {
      return true;
    }
  }

  if (debugToggleBtn) {
    debugToggleBtn.addEventListener('click', () => {
      const currentlyVisible = !debugSectionEl.classList.contains('cc-debug-collapsed');
      setDebugVisible(!currentlyVisible);
    });
  }
  setDebugVisible(loadDebugVisible());
  const CINEMATIC_KEY = 'shadow.commandcenter.cinematic';
  let cinematicOn = false;

  function setCinematicMode(on) {
    cinematicOn = !!on;
    try { localStorage.setItem(CINEMATIC_KEY, cinematicOn ? '1' : '0'); } catch (_) {}
    if (cinematicToggleEl) cinematicToggleEl.checked = cinematicOn;
    if (document.body) {
      document.body.classList.toggle('cc-cinematic-on', cinematicOn);
    }
  }

  function loadCinematicMode() {
    try {
      const raw = localStorage.getItem(CINEMATIC_KEY);
      if (raw == null) return false;
      return raw === '1';
    } catch (_) {
      return false;
    }
  }

  if (cinematicToggleEl) {
    cinematicToggleEl.addEventListener('change', () => {
      setCinematicMode(!!cinematicToggleEl.checked);
    });
  }
  setCinematicMode(loadCinematicMode());

  const input = document.getElementById('ccInput');
  const sendBtn = document.getElementById('ccSendBtn');
  const refreshBtn = document.getElementById('ccRefreshBtn');
  const tasksEl = document.getElementById('ccTasks');
  const eventsEl = document.getElementById('ccEvents');
  const missionsEl = document.getElementById('ccMissions');
  const missionControlEl = document.getElementById('ccMissionControl');
  const mcMonitorsEl = document.getElementById('ccMcMonitors');
  const mcCrewEl = document.getElementById('ccMcCrew');
  const lastDispatchEl = document.getElementById('ccLastDispatch');
  const workingSummaryEl = document.getElementById('ccWorkingSummary');
  const pinnedFactsEl = document.getElementById('ccPinnedFacts');
  const stopAllBtn = document.getElementById('ccStopAllBtn');
  const clearAllBtn = document.getElementById('ccClearAllBtn');
  const stopConfirm = document.getElementById('ccStopConfirm');
  const clearConfirm = document.getElementById('ccClearConfirm');
  const masterKillBtn = document.getElementById('ccMasterKillBtn');
  const masterKillConfirm = document.getElementById('ccMasterKillConfirm');
  const dangerStatus = document.getElementById('ccDangerStatus');
  const resumeBtn = document.getElementById('ccResumeBtn');
  const resumeConfirm = document.getElementById('ccResumeConfirm');
  const runnerStatusEl = document.getElementById('ccRunnerStatus');
  const reportModalEl = document.getElementById('ccReportModal');
  const reportCloseBtn = document.getElementById('ccReportClose');
  const reportBodyEl = document.getElementById('ccReportBody');
  const reportTitleEl = document.getElementById('ccReportTitle');

  let eventsCursor = null;
  let pollTimer = null;
  let inflight = false;
  let isAdmin = false;
  let eventPollFailures = 0;
  let latestMissions = [];
  let latestEvents = [];

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function pill(text) {
    return `<span class="cc-pill">${esc(text)}</span>`;
  }

  function setEmpty(el, msg) {
    el.innerHTML = `<div class="cc-empty">${esc(msg)}</div>`;
  }

  async function apiJson(url, opts) {
    setText(lastApiEl, url);
    const headers = { ...(opts && opts.headers ? opts.headers : {}) };
    if (!headers.Accept) headers.Accept = 'application/json';
    const res = await fetch(url, { ...(opts || {}), headers, credentials: 'include' });
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    let data = {};
    let rawText = '';
    if (contentType.includes('application/json')) {
      data = await res.json().catch(() => ({}));
    } else {
      rawText = await res.text().catch(() => '');
      data = { _raw: rawText };
    }
    if (!res.ok) {
      const msg = (data && data.error) ? data.error : (rawText ? rawText.slice(0, 200) : res.statusText);
      throw new Error(msg || 'Request failed');
    }
    return data;
  }

  async function loadMe() {
    try {
      setText(lastActionEl, 'loadMe');
      const me = await apiJson('/api/me');
      isAdmin = !!(me && me.role === 'admin');
      logDebug(`/api/me ok, isAdmin=${isAdmin}`);
    } catch (_) {
      isAdmin = false;
      logDebug('/api/me failed (not logged in or server error)');
    }
  }

  function setDangerStatus(msg) {
    if (!dangerStatus) return;
    dangerStatus.textContent = String(msg || '');
  }

  function escapeHtml(s) {
    return esc(s);
  }

  function formatFinalReportHtml(text) {
    const raw = String(text || '').replace(/\\r\\n/g, '\\n').trim();
    if (!raw) return '<div class="cc-report-empty">(none)</div>';

    const lines = raw.split('\\n');
    const out = [];
    let paragraph = [];
    let listItems = [];

    function flushParagraph() {
      const p = paragraph.join(' ').trim();
      paragraph = [];
      if (!p) return;
      out.push(`<p>${escapeHtml(p)}</p>`);
    }

    function flushList() {
      if (!listItems.length) return;
      const items = listItems.map(li => `<li>${escapeHtml(li)}</li>`).join('');
      listItems = [];
      out.push(`<ul>${items}</ul>`);
    }

    for (const lineRaw of lines) {
      const line = lineRaw.trimEnd();
      const t = line.trim();

      // Blank line => paragraph/list break
      if (!t) {
        flushList();
        flushParagraph();
        continue;
      }

      // Headings (markdown-ish)
      const h = t.match(/^(#{1,3})\\s+(.*)$/);
      if (h) {
        flushList();
        flushParagraph();
        const level = h[1].length;
        const label = h[2] || '';
        const tag = level === 1 ? 'h3' : (level === 2 ? 'h4' : 'h5');
        out.push(`<${tag}>${escapeHtml(label)}</${tag}>`);
        continue;
      }

      // Bullets
      const b = t.match(/^[-*]\\s+(.*)$/);
      if (b) {
        flushParagraph();
        listItems.push(b[1] || '');
        continue;
      }

      // Default: accumulate paragraph text (preserve short line breaks as spaces)
      flushList();
      paragraph.push(t);
    }

    flushList();
    flushParagraph();
    return `<div class="cc-report-final">${out.join('')}</div>`;
  }

  function roleToAvatarLetter(role) {
    const r = String(role || '').toLowerCase();
    if (!r) return '?';
    if (r.includes('research')) return 'R';
    if (r.includes('coder') || r.includes('dev') || r.includes('code')) return 'C';
    if (r.includes('ops') || r.includes('operator')) return 'O';
    if (r.includes('plan')) return 'P';
    if (r.includes('memory')) return 'M';
    if (r.includes('triage') || r.includes('coord')) return 'T';
    return r.charAt(0).toUpperCase();
  }

  function roleToAvatarClass(role) {
    const r = String(role || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_');
    if (!r) return '';
    if (r.includes('research')) return 'cc-avatar-role-research';
    if (r.includes('coder') || r.includes('dev') || r.includes('code')) return 'cc-avatar-role-coder';
    if (r.includes('ops') || r.includes('operator')) return 'cc-avatar-role-ops';
    if (r.includes('plan')) return 'cc-avatar-role-planner';
    if (r.includes('memory')) return 'cc-avatar-role-memory_curator';
    if (r.includes('triage') || r.includes('coord')) return 'cc-avatar-role-triage';
    return '';
  }

  function hashToInt(str) {
    const s = String(str || '');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function rolePrefix(role) {
    const r = String(role || '').toLowerCase();
    if (r.includes('research')) return 'AURORA';
    if (r.includes('coder') || r.includes('dev') || r.includes('code')) return 'VECTOR';
    if (r.includes('ops') || r.includes('operator')) return 'ATLAS';
    if (r.includes('plan')) return 'ORION';
    if (r.includes('memory')) return 'MNEMOSYNE';
    if (r.includes('triage') || r.includes('coord')) return 'COMMAND';
    return 'AGENT';
  }

  function agentCodename(role, seed) {
    const n = (hashToInt(`${role}|${seed}`) % 9) + 1;
    return `${rolePrefix(role)}-${n}`;
  }

  function getLastLogLine(task, types) {
    const want = Array.isArray(types) ? types : [types];
    const log = Array.isArray(task && task.log) ? task.log : [];
    for (let i = log.length - 1; i >= 0; i--) {
      const e = log[i];
      if (!e || !want.includes(e.type)) continue;
      const txt = String(e.content || '').trim();
      if (txt) return txt.slice(0, 220);
    }
    return '';
  }

  function taskVisualState(task) {
    const st = String(task && task.status ? task.status : '').toLowerCase();
    const waiting = !!(task && task.notBefore && !Number.isNaN(Date.parse(task.notBefore)) && Date.now() < Date.parse(task.notBefore));
    if (waiting) return 'waiting';
    if (st === 'awaiting_approval') return 'approval';
    if (st === 'blocked') return 'blocked';
    if (st === 'complete') return 'complete';
    if (st === 'failed') return 'failed';
    if (st === 'executing' || st === 'planning' || st === 'queued' || st === 'learning') return 'busy';
    return 'idle';
  }

  function isRobotRole(role) {
    const r = String(role || '').toLowerCase();
    if (r.includes('ops')) return true;
    if (r.includes('plan')) return true;
    if (r.includes('triage') || r.includes('coord')) return true;
    return false; // research/coder/memory => human by default
  }

  function pixelPalette(role, isRobot) {
    const r = String(role || '').toLowerCase();
    const base = {
      suit: '#2b3a45',
      accent: '#66ffe1',
      skin: '#f2c9a0',
      hair: '#1d1f24',
      visor: '#93b7ff',
      metal: '#c9d3de',
      panel: '#1b2a33'
    };
    if (isRobot) {
      if (r.includes('ops')) return { ...base, accent: '#ff9a3a', visor: '#ffd18a' };
      if (r.includes('plan')) return { ...base, accent: '#c36bff', visor: '#f4d6ff' };
      if (r.includes('triage') || r.includes('coord')) return { ...base, accent: '#ff5c5c', visor: '#ffd4d4' };
      return base;
    }
    if (r.includes('research')) return { ...base, accent: '#4fa8ff', visor: '#c4e0ff' };
    if (r.includes('coder')) return { ...base, accent: '#4fe88e', visor: '#d5ffe9' };
    if (r.includes('memory')) return { ...base, accent: '#ffce4a', visor: '#fff0d6' };
    return base;
  }

  function renderPixelAvatar(role, state) {
    const isRobot = isRobotRole(role);
    const p = pixelPalette(role, isRobot);
    const kindClass = isRobot ? 'cc-pixel--robot' : 'cc-pixel--human';
    const roleClass = `cc-pixel-role-${String(role || 'unknown').toLowerCase().replace(/[^a-z0-9_]+/g, '_')}`;
    const stateClass = `cc-pixel-state-${String(state || 'idle')}`;

    // 16x16 pixel art (rectangles). Scales via CSS with crisp edges.
    // Human: hair + face + suit; Robot: helmet + visor + chassis.
    const svg = isRobot
      ? `
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <rect x="3" y="2" width="10" height="8" fill="${p.metal}"/>
          <rect x="4" y="3" width="8" height="6" fill="${p.panel}"/>
          <rect class="cc-pixel-eye" x="5" y="5" width="6" height="2" fill="${p.visor}"/>
          <rect x="6" y="6" width="1" height="1" fill="${p.accent}"/>
          <rect x="9" y="6" width="1" height="1" fill="${p.accent}"/>
          <rect x="4" y="10" width="8" height="4" fill="${p.suit}"/>
          <rect x="5" y="11" width="6" height="1" fill="${p.accent}"/>
          <rect x="2" y="11" width="2" height="3" fill="${p.suit}"/>
          <rect x="12" y="11" width="2" height="3" fill="${p.suit}"/>
        </svg>
      `
      : `
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <rect x="4" y="2" width="8" height="3" fill="${p.hair}"/>
          <rect x="4" y="4" width="8" height="5" fill="${p.skin}"/>
          <rect class="cc-pixel-eye" x="5" y="6" width="2" height="1" fill="#1a1c22"/>
          <rect class="cc-pixel-eye" x="9" y="6" width="2" height="1" fill="#1a1c22"/>
          <rect x="4" y="9" width="8" height="1" fill="${p.visor}"/>
          <rect x="5" y="10" width="6" height="4" fill="${p.suit}"/>
          <rect x="6" y="11" width="4" height="1" fill="${p.accent}"/>
          <rect x="3" y="11" width="2" height="3" fill="${p.suit}"/>
          <rect x="11" y="11" width="2" height="3" fill="${p.suit}"/>
        </svg>
      `;

    return `<span class="cc-pixel ${kindClass} ${roleClass} ${stateClass}">${svg}</span>`;
  }

  function renderMissionControl(activeTasks, events) {
    if (!missionControlEl || !mcMonitorsEl || !mcCrewEl) return;
    if (!cinematicOn) {
      missionControlEl.style.display = '';
      return;
    }

    const tasks = Array.isArray(activeTasks) ? activeTasks : [];
    const evs = Array.isArray(events) ? events : [];
    const byRole = new Map();
    for (const t of tasks) {
      const role = String(t && t.role ? t.role : 'unknown');
      if (!byRole.has(role)) byRole.set(role, []);
      byRole.get(role).push(t);
    }

    const monitors = [
      { id: 'queue', title: 'TASK QUEUE', role: null },
      { id: 'research', title: 'RESEARCH GRID', role: 'research' },
      { id: 'ops', title: 'OPS CONSOLE', role: 'ops' },
      { id: 'events', title: 'HIVE FEED', role: null }
    ];

    function monitorBody(m) {
      if (m.id === 'queue') {
        const top = tasks.slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))).slice(0, 8);
        if (top.length === 0) return 'No active tasks.';
        return top.map((t) => {
          const r = t.role ? String(t.role) : '—';
          const st = t.status ? String(t.status) : '—';
          const ttl = (t.title || t.goal || t.id || '').toString().slice(0, 46);
          return `${r.padEnd(10).slice(0, 10)}  ${st.padEnd(10).slice(0, 10)}  ${ttl}`;
        }).join('\n');
      }

      if (m.id === 'events') {
        const top = evs.slice(0, 8);
        if (top.length === 0) return 'No recent hive events.';
        return top.map((e) => {
          const type = String(e.type || 'event').slice(0, 24);
          const msg = String(e.message || '').trim().slice(0, 70);
          return `${type.padEnd(24)}  ${msg}`;
        }).join('\n');
      }

      const candidates = tasks.filter((t) => String(t && t.role ? t.role : '') === String(m.role));
      const top = candidates
        .slice()
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
        .slice(0, 5);
      if (top.length === 0) return 'IDLE';

      return top.map((t) => {
        const st = t.status ? String(t.status) : '—';
        const name = agentCodename(t.role, t.id);
        const line = getLastLogLine(t, ['action', 'approval_request', 'thought', 'result']);
        const ttl = (t.title || t.goal || t.id || '').toString().slice(0, 54);
        return `${name.padEnd(11).slice(0, 11)}  ${st.padEnd(10).slice(0, 10)}  ${ttl}${line ? '\n  ↳ ' + line : ''}`;
      }).join('\n\n');
    }

    mcMonitorsEl.innerHTML = monitors.map((m) => {
      const isOnline = (m.role
        ? (tasks.some((t) => String(t.role || '') === String(m.role)))
        : (tasks.length > 0 || evs.length > 0));
      return `
        <div class="cc-monitor">
          <div class="cc-monitor-header">
            <div class="cc-monitor-title">${esc(m.title)}</div>
            <div class="cc-monitor-light ${isOnline ? 'cc-online' : ''}"></div>
          </div>
          <div class="cc-monitor-body">${esc(monitorBody(m))}</div>
        </div>
      `;
    }).join('');

    const crew = tasks
      .slice()
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
      .slice(0, 8)
      .map((t) => {
        const role = String(t.role || 'unknown');
        const name = agentCodename(role, t.id);
        const vstate = taskVisualState(t);
        const busy = (vstate === 'busy' || vstate === 'approval');
        const taskTitle = String(t.title || t.goal || '').trim();
        return `
          <div class="cc-crew-agent ${busy ? 'cc-busy' : ''}">
            ${renderPixelAvatar(role, vstate)}
            <div class="cc-crew-meta">
              <div class="cc-crew-name">${esc(name)} ${t.role ? `<span class="cc-pill">${esc(role)}</span>` : ''}</div>
              <div class="cc-crew-task">${esc(taskTitle || '(no task title)')}</div>
            </div>
          </div>
        `;
      });

    mcCrewEl.innerHTML = `
      <div class="cc-crew-title">CREW</div>
      <div class="cc-crew-list">${crew.length ? crew.join('') : '<div class="cc-empty">No active crew.</div>'}</div>
    `;
  }

  function openReportModal(mission) {
    if (!reportModalEl || !reportBodyEl || !mission) return;
    const report = mission.finalReport || {};
    const payload = report.payload || {};
    const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
    const statusCounts = payload.statusCounts || {};
    const summary = report.summary || mission.summary || '';
    const finalReport = report.finalReport || summary || '';
    const headline = report.headline || mission.title || mission.id || 'Mission Report';

    if (reportTitleEl) reportTitleEl.textContent = String(headline);

    const countsText = Object.keys(statusCounts).length
      ? Object.entries(statusCounts).map(([k, v]) => `${k}: ${v}`).join(' | ')
      : 'No status counts';

    const taskBlocks = tasks.length
      ? tasks.map((t, idx) => `
          <div class="cc-report-section">
            <div class="cc-report-title">TASK ${idx + 1} — ${escapeHtml(t.title || t.id || '')}</div>
            <div>Status: ${escapeHtml(t.status || 'unknown')} ${t.role ? `| Role: ${escapeHtml(t.role)}` : ''}</div>
            <div>${escapeHtml(t.lastNote || '(no note)')}</div>
            <div class="cc-report-title" style="margin-top:8px;">EVIDENCE</div>
            <pre class="cc-report-json">${escapeHtml(
              Array.isArray(t.evidence) && t.evidence.length > 0
                ? t.evidence.join('\n\n---\n\n')
                : '(no concrete evidence captured)'
            )}</pre>
          </div>
        `).join('')
      : '<div class="cc-report-section"><div class="cc-report-title">TASKS</div><div>No task payload found.</div></div>';

    reportBodyEl.innerHTML = `
      <div class="cc-report-section cc-report-hero">
        <div class="cc-report-hero-top">
          <div>
            <div class="cc-report-title">HEADLINE</div>
            <div class="cc-report-headline">${escapeHtml(headline)}</div>
          </div>
          <div class="cc-report-hero-meta">
            <div>${pill(report.outcome || 'unknown')}</div>
            <div class="cc-report-muted">${escapeHtml(countsText)}</div>
          </div>
        </div>
        <div class="cc-report-muted">${escapeHtml(summary || '(none)')}</div>
      </div>

      <div class="cc-report-section">
        <div class="cc-report-title">FINAL REPORT</div>
        ${formatFinalReportHtml(finalReport)}
        <div class="cc-report-actions">
          <button class="btn btn-small" type="button" id="ccReportDebugToggle">DEBUG DETAILS</button>
        </div>
      </div>

      <div class="cc-report-section cc-report-debug" id="ccReportDebug" hidden>
        <div class="cc-report-title">DEBUG</div>
        ${taskBlocks}
        <div class="cc-report-section">
          <div class="cc-report-title">RAW PAYLOAD</div>
          <pre class="cc-report-json">${escapeHtml(JSON.stringify(report, null, 2))}</pre>
        </div>
      </div>
    `;
    reportModalEl.hidden = false;

    try {
      const toggle = document.getElementById('ccReportDebugToggle');
      const dbg = document.getElementById('ccReportDebug');
      if (toggle && dbg) {
        toggle.addEventListener('click', () => {
          dbg.hidden = !dbg.hidden;
          toggle.textContent = dbg.hidden ? 'DEBUG DETAILS' : 'HIDE DEBUG';
        }, { once: false });
      }
    } catch (_) {}
  }

  function closeReportModal() {
    if (reportModalEl) reportModalEl.hidden = true;
  }

  function setRunnerStatus(text) {
    if (!runnerStatusEl) return;
    runnerStatusEl.textContent = String(text || '');
  }

  async function refreshRunnerStatus() {
    if (!isAdmin) return;
    try {
      setText(lastActionEl, 'refreshRunnerStatus');
      const st = await apiJson('/api/command-center/status');
      const paused = st && st.agent && st.agent.paused;
      const running = st && st.runner && st.runner.running;
      const inflight = st && st.runner && typeof st.runner.inFlight === 'number' ? st.runner.inFlight : 0;
      const sid = st && st.serverInstanceId ? String(st.serverInstanceId).slice(0, 8) : '?';
      setRunnerStatus(`server=${sid} | config.paused=${paused ? 'true' : 'false'} | runner.running=${running ? 'true' : 'false'} | inFlight=${inflight}`);
      logDebug(`status ok: server=${sid} paused=${paused} running=${running} inFlight=${inflight}`);
    } catch (e) {
      setRunnerStatus('Error: ' + e.message);
      setText(lastErrorEl, e.message);
      logDebug('status error: ' + e.message);
    }
  }

  function renderTasks(tasks) {
    if (!Array.isArray(tasks) || tasks.length === 0) {
      setEmpty(tasksEl, 'No active tasks.');
      return;
    }
    tasksEl.innerHTML = tasks.map(t => {
      const title = esc(t.title || t.goal || t.id);
      const waiting = !!(t && t.notBefore && !Number.isNaN(Date.parse(t.notBefore)) && Date.now() < Date.parse(t.notBefore));
      const status = esc(waiting ? 'waiting' : (t.status || '—'));
      const role = t.role ? pill(t.role) : '';
      const agentId = t.agentId ? pill('agent: ' + t.agentId) : '';
      const parent = t.parentMissionId ? pill('mission: ' + t.parentMissionId) : '';
      const priority = (t.priority != null && t.priority !== '') ? pill('prio: ' + t.priority) : '';
      const updatedAt = t.updatedAt ? new Date(t.updatedAt).toLocaleString() : '';
      const goal = esc(t.goal || '');
      const pa = t && t.pendingApproval ? t.pendingApproval : null;
      const waitNote = waiting && t.waitingFor
        ? `<div class="cc-actions-note">Waiting for: <code>${esc(String(t.waitingFor).slice(0, 180))}</code></div>`
        : '';
      const approvalDetails = (t.status === 'awaiting_approval' && pa)
        ? `<div class="cc-approval">
             <div class="cc-approval-line"><strong>Needs approval</strong>: <code>${esc(pa.action || '')}</code></div>
             <div class="cc-approval-line">Args: <code>${esc(JSON.stringify(pa.args || {}).slice(0, 300))}</code></div>
           </div>`
        : '';

      const actions = isAdmin
        ? (() => {
            const base = `
              <div class="cc-actions" data-task-id="${esc(t.id)}">
                <button class="btn btn-small" data-action="view" data-id="${esc(t.id)}">VIEW LOG</button>
                <button class="btn btn-small" data-action="pause" data-id="${esc(t.id)}">PAUSE</button>
                <button class="btn btn-small btn-danger" data-action="delete" data-id="${esc(t.id)}">DELETE</button>
              </div>
            `;
            if (t.status === 'awaiting_approval') {
              return `
                ${base}
                <div class="cc-actions cc-approval-actions" data-task-id="${esc(t.id)}">
                  <button class="btn btn-small" data-action="approve" data-id="${esc(t.id)}">APPROVE</button>
                  <input class="cc-reject-reason" type="text" placeholder="Rejection reason..." />
                  <button class="btn btn-small btn-danger" data-action="reject" data-id="${esc(t.id)}">REJECT</button>
                </div>
              `;
            }
            if (t.status === 'blocked') {
              return `
                ${base}
                <div class="cc-actions" data-task-id="${esc(t.id)}">
                  <button class="btn btn-small" data-action="unblock" data-id="${esc(t.id)}">UNBLOCK</button>
                </div>
              `;
            }
            return base;
          })()
        : (t.status === 'awaiting_approval' || t.status === 'blocked'
            ? `<div class="cc-actions-note">This task needs admin action. Open <a href="/autoagent">/autoagent</a>.</div>`
            : '');
      const avatarClass = roleToAvatarClass(t.role);
      const avatarLetter = roleToAvatarLetter(t.role);
      const statusClass = String(t.status || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_');
      return `
        <div class="cc-card cc-card-task cc-card-task-status-${statusClass}">
          <div class="cc-card-title">
            <div class="cc-card-title-main">
              <span class="cc-avatar ${avatarClass}">${esc(avatarLetter)}</span>
              <div>${title}</div>
            </div>
            <div>${pill(status)}</div>
          </div>
          <div class="cc-card-meta">
            ${role} ${agentId} ${priority} ${parent}
            ${updatedAt ? pill('updated: ' + updatedAt) : ''}
            ${t.id ? pill('id: ' + t.id.slice(0, 8)) : ''}
          </div>
          <div class="cc-card-body">${goal}</div>
          ${waitNote}
          ${approvalDetails}
          ${actions}
        </div>
      `;
    }).join('');
  }

  function renderEvents(events) {
    if (!Array.isArray(events) || events.length === 0) {
      setEmpty(eventsEl, 'No events yet.');
      return;
    }
    eventsEl.innerHTML = events.map(e => {
      const ts = e.ts ? new Date(e.ts).toLocaleString() : '';
      const type = esc(e.type || 'event');
      const source = esc(e.source || '');
      const taskId = e.taskId ? pill('task: ' + String(e.taskId).slice(0, 8)) : '';
      const agent = e.agent ? pill(e.agent) : '';
      const msg = (e.message != null) ? String(e.message) : (e.payload != null ? JSON.stringify(e.payload) : '');
      return `
        <div class="cc-card">
          <div class="cc-card-title">
            <div>${esc(type)}</div>
            <div>${ts ? pill(ts) : ''}</div>
          </div>
          <div class="cc-card-meta">
            ${source ? pill('src: ' + source) : ''}
            ${taskId}
            ${agent}
          </div>
          <div class="cc-card-body">${esc(msg).slice(0, 2000)}</div>
        </div>
      `;
    }).join('');
  }

  function renderMissions(missions) {
    if (!missionsEl) return;
    if (!Array.isArray(missions) || missions.length === 0) {
      setEmpty(missionsEl, 'No mission reports yet.');
      return;
    }
    latestMissions = missions.slice();
    const completed = missions
      .filter((m) => m && m.finalReport)
      .slice()
      .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''))
      .slice(0, 12);
    if (completed.length === 0) {
      setEmpty(missionsEl, 'No completed mission reports yet.');
      return;
    }
    missionsEl.innerHTML = completed.map((m) => {
      const report = m.finalReport || {};
      const when = m.completedAt ? new Date(m.completedAt).toLocaleString() : '';
      const actions = isAdmin
        ? `
          <button class="btn btn-small" data-action="view-report" data-mission-id="${esc(m.id || '')}">VIEW FULL REPORT</button>
          <button class="btn btn-small btn-danger" data-action="delete-report" data-mission-id="${esc(m.id || '')}">DELETE REPORT</button>
        `
        : `<button class="btn btn-small" data-action="view-report" data-mission-id="${esc(m.id || '')}">VIEW FULL REPORT</button>`;
      return `
        <div class="cc-card cc-card-mission">
          <div class="cc-card-title">
            <div class="cc-card-title-main">
              <span class="cc-avatar cc-avatar-role-planner">M</span>
              <div>${esc(report.headline || m.title || m.id)}</div>
            </div>
            <div>${pill(report.outcome || 'complete')}</div>
          </div>
          <div class="cc-card-meta">
            ${when ? pill('completed: ' + when) : ''}
            ${m.id ? pill('mission: ' + String(m.id).slice(0, 14)) : ''}
          </div>
          <div class="cc-card-body">${esc(report.summary || '')}</div>
          <div class="cc-actions">
            ${actions}
          </div>
        </div>
      `;
    }).join('');
  }

  function renderSummary(text) {
    const t = String(text || '').trim();
    if (!t) return '—';
    return t;
  }

  function renderPinnedFacts(pinned) {
    const facts = pinned && Array.isArray(pinned.facts) ? pinned.facts : [];
    if (facts.length === 0) return '—';
    return facts.map((f) => `- ${String(f)}`).join('\n');
  }

  async function refreshAll(opts) {
    const force = !!(opts && opts.force);
    if (inflight && !force) return;
    inflight = true;
    try {
      setText(lastActionEl, 'refreshAll');
      const snap = await apiJson('/api/hivemind/snapshot');
      if (workingSummaryEl) workingSummaryEl.textContent = renderSummary(snap.workingSummary || '');
      if (pinnedFactsEl) pinnedFactsEl.textContent = renderPinnedFacts(snap.pinned || {});
      renderTasks(snap.activeTasks || []);
      renderMissions(snap.missions || []);
      renderMissionControl(snap.activeTasks || [], latestEvents || []);
      try {
        const ev = await apiJson('/api/hivemind/events?limit=40');
        renderEvents(ev.events || []);
        latestEvents = Array.isArray(ev.events) ? ev.events.slice() : [];
        renderMissionControl(snap.activeTasks || [], latestEvents || []);
        if (ev.cursor) eventsCursor = ev.cursor;
        eventPollFailures = 0;
      } catch (evErr) {
        eventPollFailures += 1;
        logDebug('events fetch error: ' + evErr.message);
        // Keep the rest of the page functional even if events endpoint is flaky/proxied.
        if (eventPollFailures >= 3) {
          stopPolling();
          logDebug('events polling disabled after repeated failures');
        }
      }
      await refreshRunnerStatus();
    } catch (e) {
      setEmpty(tasksEl, 'Error loading tasks: ' + e.message);
      setEmpty(eventsEl, 'Error loading events: ' + e.message);
      if (missionsEl) setEmpty(missionsEl, 'Error loading mission reports: ' + e.message);
      if (workingSummaryEl) workingSummaryEl.textContent = 'Error: ' + e.message;
      if (pinnedFactsEl) pinnedFactsEl.textContent = 'Error: ' + e.message;
      setText(lastErrorEl, e.message);
      logDebug('refreshAll error: ' + e.message);
    } finally {
      inflight = false;
    }
  }

  async function pollEvents() {
    try {
      const q = eventsCursor ? ('?since=' + encodeURIComponent(eventsCursor) + '&limit=40') : '?limit=40';
      const ev = await apiJson('/api/hivemind/events' + q);
      if (ev.cursor) eventsCursor = ev.cursor;
      eventPollFailures = 0;
      latestEvents = Array.isArray(ev.events) ? ev.events.slice() : [];
      if (Array.isArray(ev.events) && ev.events.length > 0) {
        // Fetch full snapshot if there were new events (cheap enough).
        await refreshAll();
      }
    } catch (e) {
      eventPollFailures += 1;
      logDebug('poll events error: ' + e.message);
      if (eventPollFailures >= 3) {
        stopPolling();
        logDebug('events polling disabled after repeated failures');
      }
    }
  }

  async function dispatchMission() {
    const text = String(input.value || '').trim();
    if (!text) return;
    if (inflight) return;
    inflight = true;
    sendBtn.disabled = true;
    try {
      setText(lastActionEl, 'dispatchMission');
      const out = await apiJson('/api/command-center/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      input.value = '';
      if (lastDispatchEl) {
        lastDispatchEl.hidden = false;
        lastDispatchEl.textContent = out.summary || ('Dispatched mission ' + (out.missionId || ''));
      }
      logDebug('dispatch ok: ' + (out.missionId || ''));
      await refreshAll();
    } catch (e) {
      if (lastDispatchEl) {
        lastDispatchEl.hidden = false;
        lastDispatchEl.textContent = 'Dispatch failed: ' + e.message;
      }
      setText(lastErrorEl, e.message);
      logDebug('dispatch error: ' + e.message);
    } finally {
      inflight = false;
      sendBtn.disabled = false;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(pollEvents, 2500);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  if (refreshBtn) refreshBtn.addEventListener('click', refreshAll);
  if (sendBtn) sendBtn.addEventListener('click', dispatchMission);
  if (input) input.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') dispatchMission();
  });

  if (tasksEl) {
    tasksEl.addEventListener('click', async (e) => {
      const btn = e.target && e.target.closest && e.target.closest('button[data-action]');
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      const id = btn.getAttribute('data-id');
      if (!action || !id) return;
      if (!isAdmin) return;
      try {
        setText(lastActionEl, `task:${action}`);
        if (action === 'approve') {
          await apiJson(`/api/agent/tasks/${encodeURIComponent(id)}/approve`, { method: 'POST' });
        } else if (action === 'reject') {
          const wrap = btn.closest('.cc-actions');
          const reason = wrap && wrap.querySelector ? (wrap.querySelector('.cc-reject-reason')?.value || '') : '';
          await apiJson(`/api/agent/tasks/${encodeURIComponent(id)}/reject`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason })
          });
        } else if (action === 'unblock') {
          await apiJson(`/api/agent/tasks/${encodeURIComponent(id)}/unblock`, { method: 'POST' });
        } else if (action === 'pause') {
          const reason = window.prompt('Pause reason (optional):', '') || '';
          const out = await apiJson(`/api/agent/tasks/${encodeURIComponent(id)}/pause`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason })
          });
          logDebug(`pause ok: task=${id.slice(0, 8)} newStatus=${out && out.status ? out.status : '?'}`);
        } else if (action === 'delete') {
          const ok = window.confirm('Delete this task? This cannot be undone.');
          if (!ok) return;
          await apiJson(`/api/agent/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
          logDebug(`delete ok: task=${id.slice(0, 8)}`);
        } else if (action === 'view') {
          const task = await apiJson(`/api/agent/tasks/${encodeURIComponent(id)}`);
          const lines = [];
          lines.push(`Title: ${task.title}`);
          lines.push(`Status: ${task.status}`);
          if (task.role) lines.push(`Role: ${task.role}`);
          lines.push('');
          lines.push('Goal:');
          lines.push(task.goal || '');
          lines.push('');
          lines.push('Recent log:');
          const log = Array.isArray(task.log) ? task.log.slice(-40) : [];
          for (const entry of log) {
            lines.push(`[${entry.ts || ''}] [${entry.type || ''}] ${entry.content || ''}`.trim());
          }
          window.alert(lines.join('\n').slice(0, 12000));
        }
        try {
          await refreshAll({ force: true });
        } catch (refreshErr) {
          // refreshAll now handles most errors internally; keep action success visible.
          logDebug('post-action refresh warning: ' + refreshErr.message);
        }
      } catch (err) {
        if (lastDispatchEl) {
          lastDispatchEl.hidden = false;
          lastDispatchEl.textContent = `Action failed: ${err.message}`;
        }
        setText(lastErrorEl, err.message);
        logDebug('task action error: ' + err.message);
      }
    });
  }

  if (missionsEl) {
    missionsEl.addEventListener('click', async (e) => {
      const btn = e.target && e.target.closest && e.target.closest('button[data-action]');
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      const missionId = btn.getAttribute('data-mission-id');
      if (!action || !missionId) return;
      if (action === 'view-report') {
        const mission = latestMissions.find((m) => String(m && m.id) === String(missionId));
        if (!mission) return;
        openReportModal(mission);
        return;
      }
      if (action === 'delete-report') {
        if (!isAdmin) return;
        const ok = window.confirm('Delete this mission report? This cannot be undone.');
        if (!ok) return;
        try {
          setText(lastActionEl, 'mission:delete-report');
          await apiJson(`/api/command-center/missions/${encodeURIComponent(missionId)}`, { method: 'DELETE' });
          logDebug(`delete report ok: mission=${missionId.slice(0, 12)}`);
          await refreshAll({ force: true });
        } catch (err) {
          setText(lastErrorEl, err.message);
          logDebug('delete report error: ' + err.message);
        }
      }
    });
  }

  if (reportCloseBtn) reportCloseBtn.addEventListener('click', closeReportModal);
  if (reportModalEl) {
    reportModalEl.addEventListener('click', (e) => {
      const target = e.target;
      if (target && target.getAttribute && target.getAttribute('data-close') === '1') closeReportModal();
    });
  }

  loadMe().then(() => refreshAll().then(startPolling));
  window.addEventListener('beforeunload', stopPolling);

  if (stopAllBtn) {
    stopAllBtn.addEventListener('click', async () => {
      if (!isAdmin) { setDangerStatus('Admin only.'); return; }
      const confirm = String(stopConfirm && stopConfirm.value ? stopConfirm.value : '').trim();
      try {
        setText(lastActionEl, 'stopAll');
        setDangerStatus('Stopping all agents...');
        await apiJson('/api/command-center/stop-all', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm })
        });
        setDangerStatus('Stopped. In-flight tasks were paused.');
        await refreshRunnerStatus();
        await refreshAll({ force: true });
      } catch (e) {
        setDangerStatus('Stop failed: ' + e.message);
        setText(lastErrorEl, e.message);
        logDebug('stop error: ' + e.message);
      }
    });
  }

  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', async () => {
      if (!isAdmin) { setDangerStatus('Admin only.'); return; }
      const confirm = String(clearConfirm && clearConfirm.value ? clearConfirm.value : '').trim();
      try {
        setText(lastActionEl, 'clearAllMemory');
        setDangerStatus('Clearing all memory...');
        await apiJson('/api/command-center/clear-all-memory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm })
        });
        setDangerStatus('All memory cleared.');
        await refreshRunnerStatus();
        await refreshAll({ force: true });
      } catch (e) {
        setDangerStatus('Clear failed: ' + e.message);
        setText(lastErrorEl, e.message);
        logDebug('clear error: ' + e.message);
      }
    });
  }

  if (resumeBtn) {
    resumeBtn.addEventListener('click', async () => {
      if (!isAdmin) { setDangerStatus('Admin only.'); return; }
      const confirm = String(resumeConfirm && resumeConfirm.value ? resumeConfirm.value : '').trim();
      try {
        setText(lastActionEl, 'resumeAgents');
        setDangerStatus('Resuming agents...');
        await apiJson('/api/command-center/resume-agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm })
        });
        setDangerStatus('Agent runner resumed.');
        await refreshRunnerStatus();
        await refreshAll({ force: true });
      } catch (e) {
        setDangerStatus('Resume failed: ' + e.message);
        setText(lastErrorEl, e.message);
        logDebug('resume error: ' + e.message);
      }
    });
  }

  if (masterKillBtn) {
    masterKillBtn.addEventListener('click', async () => {
      if (!isAdmin) { setDangerStatus('Admin only.'); return; }
      const confirm = String(masterKillConfirm && masterKillConfirm.value ? masterKillConfirm.value : '').trim();
      try {
        setText(lastActionEl, 'masterKill');
        setDangerStatus('Executing MASTER KILL...');
        const out = await apiJson('/api/command-center/master-kill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm })
        });
        const sid = out && out.serverInstanceId ? String(out.serverInstanceId).slice(0, 8) : '?';
        setDangerStatus(`MASTER KILL complete (server=${sid}).`);
        logDebug(`master kill ok: server=${sid}`);
        await refreshRunnerStatus();
        await refreshAll({ force: true });
      } catch (e) {
        setDangerStatus('MASTER KILL failed: ' + e.message);
        setText(lastErrorEl, e.message);
        logDebug('master kill error: ' + e.message);
      }
    });
  }
})();

