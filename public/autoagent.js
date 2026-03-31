(function () {
  'use strict';

  let selectedTaskId = null;
  let refreshTimer = null;

  // ---- Utility ----

  function statusBadge(status) {
    return `<span class="agent-badge agent-badge-${status}">${status.replace('_', ' ')}</span>`;
  }

  function shortTs(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleTimeString();
    } catch (_) { return iso; }
  }

  function progressPct(task) {
    if (!task.plan || task.plan.length === 0) return 0;
    const done = task.plan.filter(s => s.status === 'done').length;
    return Math.round((done / task.plan.length) * 100);
  }

  // ---- Approval queue ----

  async function loadApprovalQueue() {
    let tasks;
    try {
      const r = await fetch('/api/agent/tasks');
      if (!r.ok) return;
      const index = await r.json();
      const pending = index.filter(e => e.status === 'awaiting_approval');
      const queue = document.getElementById('approvalQueue');
      const list = document.getElementById('approvalList');
      if (pending.length === 0) {
        queue.style.display = 'none';
        list.innerHTML = '';
        return;
      }
      queue.style.display = '';
      const details = await Promise.all(pending.map(e =>
        fetch(`/api/agent/tasks/${e.id}`).then(r => r.ok ? r.json() : null)
      ));
      list.innerHTML = '';
      for (const task of details) {
        if (!task || !task.pendingApproval) continue;
        const pa = task.pendingApproval;
        const div = document.createElement('div');
        div.className = 'agent-approval-item';
        div.innerHTML = `
          <strong>${escHtml(task.title)}</strong>
          <div class="agent-approval-action">
            Action: <code>${escHtml(pa.action)}</code><br>
            Args: <code>${escHtml(JSON.stringify(pa.args).slice(0, 300))}</code>
          </div>
          <div class="agent-approval-buttons">
            <button class="btn btn-small approve-btn" data-id="${task.id}">Approve</button>
            <input type="text" class="form-control rejection-reason agent-rejection-input" placeholder="Rejection reason..." />
            <button class="btn btn-small btn-danger reject-btn" data-id="${task.id}">Reject</button>
          </div>`;
        list.appendChild(div);
      }
      list.querySelectorAll('.approve-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          await fetch(`/api/agent/tasks/${btn.dataset.id}/approve`, { method: 'POST' });
          refresh();
        });
      });
      list.querySelectorAll('.reject-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const reason = btn.closest('.agent-approval-buttons')
            .querySelector('.rejection-reason')?.value || '';
          await fetch(`/api/agent/tasks/${btn.dataset.id}/reject`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason })
          });
          refresh();
        });
      });
    } catch (_) {}
  }

  // ---- Task list ----

  async function loadTaskList() {
    const list = document.getElementById('taskList');
    let index;
    try {
      const r = await fetch('/api/agent/tasks');
      if (!r.ok) { list.innerHTML = '<p class="config-note">Error loading tasks.</p>'; return; }
      index = await r.json();
    } catch (_) { list.innerHTML = '<p class="config-note">Error loading tasks.</p>'; return; }

    if (index.length === 0) {
      list.innerHTML = '<p class="config-note">No tasks yet. Create one below.</p>';
      return;
    }

    // Sort: awaiting_approval first, then by updatedAt desc
    index.sort((a, b) => {
      if (a.status === 'awaiting_approval' && b.status !== 'awaiting_approval') return -1;
      if (b.status === 'awaiting_approval' && a.status !== 'awaiting_approval') return 1;
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });

    list.innerHTML = '';
    for (const entry of index) {
      const card = document.createElement('div');
      card.className = 'agent-task-card' + (entry.id === selectedTaskId ? ' active' : '');
      card.dataset.id = entry.id;

      const pct = 0;
      card.innerHTML = `
        <div class="agent-task-title">${escHtml(entry.title)}</div>
        <div class="agent-task-meta">
          ${statusBadge(entry.status)}
          <div class="agent-progress"><div class="agent-progress-bar" style="width:${pct}%"></div></div>
          <span>${shortTs(entry.updatedAt)}</span>
        </div>`;

      card.addEventListener('click', () => selectTask(entry.id));
      list.appendChild(card);
    }
  }

  // ---- Task detail ----

  async function selectTask(id) {
    selectedTaskId = id;

    document.querySelectorAll('.agent-task-card').forEach(c => {
      c.classList.toggle('active', c.dataset.id === id);
    });

    const detail = document.getElementById('taskDetail');
    detail.style.display = '';

    let task;
    try {
      const r = await fetch(`/api/agent/tasks/${id}`);
      if (!r.ok) return;
      task = await r.json();
    } catch (_) { return; }

    document.getElementById('detailTitle').textContent = task.title;
    document.getElementById('detailGoal').textContent = task.goal;
    const statusEl = document.getElementById('detailStatus');
    statusEl.className = `agent-badge agent-badge-${task.status}`;
    statusEl.textContent = task.status.replace('_', ' ');

    const unblockBtn = document.getElementById('unblockTaskBtn');
    unblockBtn.style.display = task.status === 'blocked' ? '' : 'none';
    unblockBtn.onclick = async () => {
      await fetch(`/api/agent/tasks/${id}/unblock`, { method: 'POST' });
      refresh();
    };

    document.getElementById('deleteTaskBtn').onclick = async () => {
      if (!confirm(`Delete task "${task.title}"?`)) return;
      await fetch(`/api/agent/tasks/${id}`, { method: 'DELETE' });
      selectedTaskId = null;
      document.getElementById('taskDetail').style.display = 'none';
      refresh();
    };

    document.getElementById('closeDetailBtn').onclick = () => {
      selectedTaskId = null;
      document.getElementById('taskDetail').style.display = 'none';
      document.querySelectorAll('.agent-task-card').forEach(c => c.classList.remove('active'));
    };

    const planEl = document.getElementById('detailPlan');
    if (task.plan && task.plan.length > 0) {
      planEl.innerHTML = '';
      task.plan.forEach((s, i) => {
        const li = document.createElement('li');
        const isCurrent = i === task.currentStep && task.status === 'executing';
        li.className = s.status === 'done' ? 'step-done' : (isCurrent ? 'step-current' : '');
        li.textContent = s.description;
        planEl.appendChild(li);
      });
      const pct = progressPct(task);
      const card = document.querySelector(`.agent-task-card[data-id="${id}"] .agent-progress-bar`);
      if (card) card.style.width = `${pct}%`;
    } else {
      planEl.innerHTML = '<li style="list-style:none;color:var(--text-dim)">Plan not yet created.</li>';
    }

    const learningsDiv = document.getElementById('detailLearnings');
    const learningsContent = document.getElementById('detailLearningsContent');
    const l = task.learnings;
    if (l && (l.skillsCreated?.length > 0 || l.factsAdded?.length > 0 || l.strategyNotes)) {
      learningsDiv.style.display = '';
      let html = '';
      if (l.skillsCreated?.length > 0) html += `<p class="config-note">Skills created: ${l.skillsCreated.map(escHtml).join(', ')}</p>`;
      if (l.factsAdded?.length > 0) html += `<p class="config-note">Facts stored: ${l.factsAdded.map(escHtml).join(', ')}</p>`;
      learningsContent.innerHTML = html;
    } else {
      learningsDiv.style.display = 'none';
    }

    const logEl = document.getElementById('detailLog');
    if (task.log && task.log.length > 0) {
      logEl.innerHTML = task.log.map(e =>
        `<div class="agent-log-entry log-${e.type}">` +
        `<span class="log-ts">${shortTs(e.ts)}</span>` +
        `<span class="log-type">[${e.type}]</span> ${escHtml(e.content)}` +
        `</div>`
      ).join('');
      logEl.scrollTop = logEl.scrollHeight;
    } else {
      logEl.innerHTML = '<span style="color:var(--text-dim)">No log entries yet.</span>';
    }
  }

  // ---- New task form ----

  document.getElementById('newTaskBtn').addEventListener('click', () => {
    const form = document.getElementById('newTaskForm');
    form.style.display = form.style.display === 'none' ? '' : 'none';
  });

  document.getElementById('cancelTaskBtn').addEventListener('click', () => {
    document.getElementById('newTaskForm').style.display = 'none';
    document.getElementById('taskGoal').value = '';
    document.getElementById('taskStatus').textContent = '';
  });

  document.getElementById('submitTaskBtn').addEventListener('click', async () => {
    const goal = document.getElementById('taskGoal').value.trim();
    const blockedBehavior = document.getElementById('taskBlockedBehavior').value;
    const statusEl = document.getElementById('taskStatus');
    if (!goal) { statusEl.textContent = 'Goal is required.'; statusEl.className = 'status error'; return; }
    statusEl.textContent = 'Creating...';
    statusEl.className = 'status';
    try {
      const r = await fetch('/api/agent/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal, blockedBehavior })
      });
      if (!r.ok) {
        const e = await r.json();
        statusEl.textContent = e.error || 'Error';
        statusEl.className = 'status error';
        return;
      }
      const task = await r.json();
      document.getElementById('newTaskForm').style.display = 'none';
      document.getElementById('taskGoal').value = '';
      statusEl.textContent = '';
      refresh();
      selectTask(task.id);
    } catch (_) {
      statusEl.textContent = 'Network error.';
      statusEl.className = 'status error';
    }
  });

  // ---- Config ----

  async function loadConfig() {
    try {
      const r = await fetch('/api/agent/config');
      if (!r.ok) return;
      const cfg = await r.json();
      document.getElementById('cfgMaxConcurrent').value = cfg.maxConcurrent ?? 2;
      document.getElementById('cfgLoopInterval').value = cfg.loopIntervalMs ?? 5000;
    } catch (_) {}
  }

  document.getElementById('saveConfigBtn').addEventListener('click', async () => {
    const statusEl = document.getElementById('configStatus');
    statusEl.textContent = 'Saving...';
    statusEl.className = 'status';
    try {
      const r = await fetch('/api/agent/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxConcurrent: Number(document.getElementById('cfgMaxConcurrent').value),
          loopIntervalMs: Number(document.getElementById('cfgLoopInterval').value)
        })
      });
      if (!r.ok) { const e = await r.json(); statusEl.textContent = e.error || 'Error'; statusEl.className = 'status error'; return; }
      statusEl.textContent = 'Saved.';
      statusEl.className = 'status ok';
      setTimeout(() => { statusEl.textContent = ''; }, 2000);
    } catch (_) { statusEl.textContent = 'Error.'; statusEl.className = 'status error'; }
  });

  // ---- Refresh ----

  async function refresh() {
    await Promise.all([loadApprovalQueue(), loadTaskList()]);
    if (selectedTaskId) await selectTask(selectedTaskId);
  }

  function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(refresh, 5000);
  }

  // ---- XSS protection ----

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---- Init ----

  loadConfig();
  refresh();
  startAutoRefresh();
})();
