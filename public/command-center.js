(function () {
  const input = document.getElementById('ccInput');
  const sendBtn = document.getElementById('ccSendBtn');
  const refreshBtn = document.getElementById('ccRefreshBtn');
  const tasksEl = document.getElementById('ccTasks');
  const eventsEl = document.getElementById('ccEvents');
  const missionsEl = document.getElementById('ccMissions');
  const lastDispatchEl = document.getElementById('ccLastDispatch');
  const workingSummaryEl = document.getElementById('ccWorkingSummary');
  const pinnedFactsEl = document.getElementById('ccPinnedFacts');

  let eventsCursor = null;
  let pollTimer = null;
  let inflight = false;

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
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText || 'Request failed');
    return data;
  }

  function renderTasks(tasks) {
    if (!Array.isArray(tasks) || tasks.length === 0) {
      setEmpty(tasksEl, 'No active tasks.');
      return;
    }
    tasksEl.innerHTML = tasks.map(t => {
      const title = esc(t.title || t.goal || t.id);
      const status = esc(t.status || '—');
      const role = t.role ? pill(t.role) : '';
      const agentId = t.agentId ? pill('agent: ' + t.agentId) : '';
      const parent = t.parentMissionId ? pill('mission: ' + t.parentMissionId) : '';
      const priority = (t.priority != null && t.priority !== '') ? pill('prio: ' + t.priority) : '';
      const updatedAt = t.updatedAt ? new Date(t.updatedAt).toLocaleString() : '';
      const goal = esc(t.goal || '');
      return `
        <div class="cc-card">
          <div class="cc-card-title">
            <div>${title}</div>
            <div>${pill(status)}</div>
          </div>
          <div class="cc-card-meta">
            ${role} ${agentId} ${priority} ${parent}
            ${updatedAt ? pill('updated: ' + updatedAt) : ''}
            ${t.id ? pill('id: ' + t.id.slice(0, 8)) : ''}
          </div>
          <div class="cc-card-body">${goal}</div>
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
      return `
        <div class="cc-card">
          <div class="cc-card-title">
            <div>${esc(report.headline || m.title || m.id)}</div>
            <div>${pill(report.outcome || 'complete')}</div>
          </div>
          <div class="cc-card-meta">
            ${when ? pill('completed: ' + when) : ''}
            ${m.id ? pill('mission: ' + String(m.id).slice(0, 14)) : ''}
          </div>
          <div class="cc-card-body">${esc(report.summary || '')}</div>
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

  async function refreshAll() {
    if (inflight) return;
    inflight = true;
    try {
      const snap = await apiJson('/api/hivemind/snapshot');
      if (workingSummaryEl) workingSummaryEl.textContent = renderSummary(snap.workingSummary || '');
      if (pinnedFactsEl) pinnedFactsEl.textContent = renderPinnedFacts(snap.pinned || {});
      renderTasks(snap.activeTasks || []);
      renderMissions(snap.missions || []);
      const ev = await apiJson('/api/hivemind/events?limit=40');
      renderEvents(ev.events || []);
      if (ev.cursor) eventsCursor = ev.cursor;
    } catch (e) {
      setEmpty(tasksEl, 'Error loading tasks: ' + e.message);
      setEmpty(eventsEl, 'Error loading events: ' + e.message);
      if (missionsEl) setEmpty(missionsEl, 'Error loading mission reports: ' + e.message);
      if (workingSummaryEl) workingSummaryEl.textContent = 'Error: ' + e.message;
      if (pinnedFactsEl) pinnedFactsEl.textContent = 'Error: ' + e.message;
    } finally {
      inflight = false;
    }
  }

  async function pollEvents() {
    try {
      const q = eventsCursor ? ('?since=' + encodeURIComponent(eventsCursor) + '&limit=40') : '?limit=40';
      const ev = await apiJson('/api/hivemind/events' + q);
      if (ev.cursor) eventsCursor = ev.cursor;
      if (Array.isArray(ev.events) && ev.events.length > 0) {
        // Fetch full snapshot if there were new events (cheap enough).
        await refreshAll();
      }
    } catch (_) {
      // ignore transient poll errors
    }
  }

  async function dispatchMission() {
    const text = String(input.value || '').trim();
    if (!text) return;
    if (inflight) return;
    inflight = true;
    sendBtn.disabled = true;
    try {
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
      await refreshAll();
    } catch (e) {
      if (lastDispatchEl) {
        lastDispatchEl.hidden = false;
        lastDispatchEl.textContent = 'Dispatch failed: ' + e.message;
      }
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

  refreshAll().then(startPolling);
  window.addEventListener('beforeunload', stopPolling);
})();

