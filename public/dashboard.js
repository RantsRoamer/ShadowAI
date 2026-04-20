(function () {
  let lastRuns = [];
  function relativeTime(iso) {
    if (!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 0) return 'just now';
    const s = Math.floor(diff / 1000);
    if (s < 60) return s + 's ago';
    const m = Math.floor(s / 60);
    if (m < 60) return m + ' min ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' hr ago';
    return Math.floor(h / 24) + ' day(s) ago';
  }

  function futureRelative(iso) {
    if (!iso) return '—';
    const diff = new Date(iso).getTime() - Date.now();
    if (diff <= 0) return 'now';
    const s = Math.floor(diff / 1000);
    if (s < 60) return 'in ' + s + 's';
    const m = Math.floor(s / 60);
    if (m < 60) return 'in ' + m + ' min';
    const h = Math.floor(m / 60);
    if (h < 24) return 'in ' + h + ' hr';
    return 'in ' + Math.floor(h / 24) + ' day(s)';
  }

  function escapeHtml(s) {
    if (s == null) return '';
    const el = document.createElement('div');
    el.textContent = s;
    return el.innerHTML;
  }

  async function load() {
    try {
      const res = await fetch('/api/dashboard');
      if (!res.ok) throw new Error(res.statusText);
      const d = await res.json();

      // Ollama card
      const ollamaStatus = document.getElementById('ollamaStatus');
      const ollamaModel = document.getElementById('ollamaModel');
      if (d.ollama) {
        ollamaStatus.innerHTML = `<span class="dash-card-dot ${d.ollama.connected ? 'online' : 'offline'}"></span>${d.ollama.connected ? 'Online' : 'Offline'}`;
        ollamaModel.textContent = d.ollama.model || '—';
      }

      // Chats
      const chatsTotal = document.getElementById('chatsTotal');
      if (d.chats) chatsTotal.textContent = d.chats.total;

      // Skills
      const skillsValue = document.getElementById('skillsValue');
      const skillsSub = document.getElementById('skillsSub');
      if (d.skills) {
        skillsValue.textContent = d.skills.enabled + ' / ' + d.skills.total;
        skillsSub.textContent = 'enabled';
      }

      // Memory
      const memoryValue = document.getElementById('memoryValue');
      const memorySub = document.getElementById('memorySub');
      if (d.memory) {
        memoryValue.textContent = d.memory.freeformLines;
        memorySub.textContent = 'entries · ' + d.memory.structuredKeys + ' keys';
      }

      // Projects
      const projectsValue = document.getElementById('projectsValue');
      const projectsSub = document.getElementById('projectsSub');
      if (d.projects) {
        projectsValue.textContent = d.projects.total;
        projectsSub.textContent = d.projects.total === 1 ? 'project' : 'projects';
      }
      if (d.observability && d.observability.health) {
        const obsRunHealth = document.getElementById('obsRunHealth');
        const obsRunSub = document.getElementById('obsRunSub');
        if (obsRunHealth) obsRunHealth.textContent = String(d.observability.health.last24FailedRuns || 0);
        if (obsRunSub) obsRunSub.textContent = 'failed of ' + String(d.observability.health.last24Runs || 0) + ' runs (24h)';
      }

      // Recent chats
      const recentChats = document.getElementById('recentChats');
      if (d.chats && d.chats.recent && d.chats.recent.length > 0) {
        recentChats.innerHTML = d.chats.recent.map(c => `
          <li>
            <span class="dash-item-title">${escapeHtml(c.title || 'Untitled')}</span>
            <span class="dash-item-meta">${relativeTime(c.updatedAt)}</span>
            <a href="/app" class="dash-item-action">[Open]</a>
          </li>
        `).join('');
      } else {
        recentChats.innerHTML = '<li><span class="dash-empty">No chats yet.</span></li>';
      }

      // Scheduled jobs
      const scheduledJobs = document.getElementById('scheduledJobs');
      if (d.heartbeat && d.heartbeat.jobs && d.heartbeat.jobs.length > 0) {
        scheduledJobs.innerHTML = d.heartbeat.jobs.slice(0, 6).map(j => `
          <li>
            <span class="dash-item-title">${escapeHtml(j.name)}</span>
            <span class="dash-item-meta">${escapeHtml(j.schedule || '')} · ${j.enabled ? (j.nextRunAt ? futureRelative(j.nextRunAt) : '—') : 'disabled'}</span>
          </li>
        `).join('');
      } else {
        scheduledJobs.innerHTML = '<li><span class="dash-empty">No scheduled jobs.</span></li>';
      }

      // Recent projects
      const recentProjects = document.getElementById('recentProjects');
      if (d.projects && d.projects.recent && d.projects.recent.length > 0) {
        recentProjects.innerHTML = d.projects.recent.map(p => `
          <li>
            <span class="dash-item-title">${escapeHtml(p.name || 'Untitled')}</span>
            <span class="dash-item-meta">${relativeTime(p.updatedAt)}</span>
            <a href="/project?id=${encodeURIComponent(p.id)}" class="dash-item-action">[Open]</a>
          </li>
        `).join('');
      } else {
        recentProjects.innerHTML = '<li><span class="dash-empty">No projects yet.</span></li>';
      }
    } catch (e) {
      document.querySelector('.dashboard-main').insertAdjacentHTML('afterbegin',
        '<p style="color:var(--red);font-size:12px;">Failed to load dashboard: ' + escapeHtml(e.message) + '</p>');
    }
  }

  async function loadObservability() {
    const status = (document.getElementById('obsStatusFilter') || {}).value || '';
    const params = new URLSearchParams({ limit: '20', offset: '0' });
    if (status) params.set('status', status);
    const list = document.getElementById('pipelineRuns');
    if (!list) return;
    try {
      const res = await fetch('/api/observability/runs?' + params.toString());
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      lastRuns = Array.isArray(data.items) ? data.items : [];
      if (lastRuns.length === 0) {
        list.innerHTML = '<li><span class="dash-empty">No runs found.</span></li>';
        return;
      }
      list.innerHTML = lastRuns.map((r) => `
        <li>
          <span class="dash-item-title">${escapeHtml(r.pipelineName || r.pipelineId)}</span>
          <span class="dash-item-meta">${escapeHtml(r.status)} · ${relativeTime(r.startedAt)}</span>
          <a href="#" data-run-id="${escapeHtml(r.id)}" class="dash-item-action">[Details]</a>
        </li>
      `).join('');
      list.querySelectorAll('a[data-run-id]').forEach((a) => {
        a.addEventListener('click', async (e) => {
          e.preventDefault();
          await openRunDrilldown(a.getAttribute('data-run-id'));
        });
      });
    } catch (e) {
      list.innerHTML = '<li><span class="dash-empty">Failed to load observability: ' + escapeHtml(e.message) + '</span></li>';
    }
  }

  async function openRunDrilldown(runId) {
    const panel = document.getElementById('runDrilldown');
    const body = document.getElementById('runDrilldownBody');
    if (!panel || !body) return;
    try {
      const res = await fetch('/api/observability/runs/' + encodeURIComponent(runId));
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      panel.style.display = 'block';
      body.textContent = JSON.stringify(data, null, 2);
    } catch (e) {
      panel.style.display = 'block';
      body.textContent = 'Failed to load run details: ' + e.message;
    }
  }

  const obsStatusFilter = document.getElementById('obsStatusFilter');
  if (obsStatusFilter) {
    obsStatusFilter.addEventListener('change', () => { loadObservability(); });
  }
  const obsRefreshBtn = document.getElementById('obsRefreshBtn');
  if (obsRefreshBtn) {
    obsRefreshBtn.addEventListener('click', () => { load(); loadObservability(); });
  }

  load();
  loadObservability();
})();
