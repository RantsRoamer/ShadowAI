(function () {
  const heartbeatList = document.getElementById('heartbeatList');
  const addJobBtn = document.getElementById('addJob');
  const saveBtn = document.getElementById('saveBtn');
  const statusEl = document.getElementById('status');

  const PRESETS = [
    { label: 'Every 5 min', cron: '*/5 * * * *' },
    { label: 'Every 15 min', cron: '*/15 * * * *' },
    { label: 'Every hour', cron: '0 * * * *' },
    { label: 'Daily 07:00', cron: '0 7 * * *' },
    { label: 'Daily 09:00', cron: '0 9 * * *' },
    { label: 'Daily 00:00', cron: '0 0 * * *' }
  ];

  let jobs = [];

  function setStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.style.color = isError ? 'var(--red)' : 'var(--text-dim)';
  }

  function escapeHtml(s) {
    if (s == null) return '';
    const el = document.createElement('div');
    el.textContent = s;
    return el.innerHTML;
  }

  function id() {
    return 'job_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  function render() {
    if (jobs.length === 0) {
      heartbeatList.innerHTML = '<p class="skill-empty">No heartbeat jobs. Add one to run a skill or send a prompt on a schedule.</p>';
      return;
    }
    heartbeatList.innerHTML = jobs.map((j, i) => {
      const argsStr = (j.args && typeof j.args === 'object') ? JSON.stringify(j.args) : (j.args || '');
      return `
      <div class="skill-card heartbeat-card" data-index="${i}">
        <div class="row">
          <div class="form-group" style="max-width:200px;">
            <label>Name</label>
            <input type="text" class="job-name" value="${escapeHtml(j.name)}" placeholder="My job" />
          </div>
          <div class="form-group" style="max-width:180px;">
            <label>Schedule (cron)</label>
            <input type="text" class="job-schedule" value="${escapeHtml(j.schedule)}" placeholder="*/5 * * * *" />
          </div>
          <div class="form-group" style="max-width:120px;">
            <label>Preset</label>
            <select class="schedule-preset">
              <option value="">Custom</option>
              ${PRESETS.map(p => '<option value="' + escapeHtml(p.cron) + '">' + escapeHtml(p.label) + '</option>').join('')}
            </select>
          </div>
        </div>
        <div class="row">
          <div class="form-group" style="max-width:100px;">
            <label>Type</label>
            <select class="job-type">
              <option value="skill" ${j.type === 'skill' ? 'selected' : ''}>Skill</option>
              <option value="prompt" ${j.type === 'prompt' ? 'selected' : ''}>Prompt</option>
            </select>
          </div>
          <div class="form-group job-skill-fields" style="flex:1; ${j.type !== 'skill' ? 'display:none' : ''}">
            <label>Skill ID</label>
            <input type="text" class="job-skillId" value="${escapeHtml(j.skillId || '')}" placeholder="example" />
          </div>
          <div class="form-group job-skill-fields" style="max-width:200px; ${j.type !== 'skill' ? 'display:none' : ''}">
            <label>Args (JSON)</label>
            <input type="text" class="job-args" value="${escapeHtml(argsStr)}" placeholder='{}' />
          </div>
          <div class="form-group job-skill-fields" style="max-width:180px; ${j.type !== 'skill' ? 'display:none' : ''}">
            <label><input type="checkbox" class="job-emailResult" ${j.emailResult ? 'checked' : ''} /> Email result</label>
            <input type="text" class="job-emailSubject" value="${escapeHtml(j.emailSubject || '')}" placeholder="Email subject" style="margin-top:4px;" />
          </div>
          <div class="form-group job-prompt-fields" style="flex:1; ${j.type !== 'prompt' ? 'display:none' : ''}">
            <label>Prompt</label>
            <input type="text" class="job-prompt" value="${escapeHtml(j.prompt || '')}" placeholder="What should the AI do?" />
          </div>
        </div>
        <div class="row-end">
          <label><input type="checkbox" class="job-enabled" ${j.enabled !== false ? 'checked' : ''} /> Enabled</label>
          <div>
            <button type="button" class="btn btn-small job-run">Run now</button>
            <span class="remove-agent job-delete">Delete</span>
          </div>
        </div>
      </div>
    `;
    }).join('');

    heartbeatList.querySelectorAll('.schedule-preset').forEach(sel => {
      sel.addEventListener('change', () => {
        if (sel.value) sel.closest('.heartbeat-card').querySelector('.job-schedule').value = sel.value;
      });
    });
    heartbeatList.querySelectorAll('.job-type').forEach(sel => {
      sel.addEventListener('change', () => {
        const card = sel.closest('.heartbeat-card');
        const skill = card.querySelectorAll('.job-skill-fields');
        const prompt = card.querySelectorAll('.job-prompt-fields');
        skill.forEach(el => el.style.display = sel.value === 'skill' ? '' : 'none');
        prompt.forEach(el => el.style.display = sel.value === 'prompt' ? '' : 'none');
      });
    });
    heartbeatList.querySelectorAll('.job-run').forEach(btn => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('.heartbeat-card');
        const idx = parseInt(card.dataset.index, 10);
        const job = jobs[idx];
        if (!job.id) { setStatus('Save first to get an ID', true); return; }
        try {
          const res = await fetch('/api/heartbeat/run/' + encodeURIComponent(job.id), { method: 'POST' });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          setStatus('Ran. Result: ' + (typeof data.result !== 'undefined' ? JSON.stringify(data.result) : 'ok'));
        } catch (e) {
          setStatus(e.message, true);
        }
      });
    });
    heartbeatList.querySelectorAll('.job-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.heartbeat-card');
        const idx = parseInt(card.dataset.index, 10);
        jobs.splice(idx, 1);
        render();
      });
    });
  }

  function getJobsFromDom() {
    const cards = heartbeatList.querySelectorAll('.heartbeat-card');
    return Array.from(cards).map((card, i) => {
      const j = jobs[i] || {};
      let args = {};
      const argsStr = card.querySelector('.job-args')?.value?.trim();
      if (argsStr) try { args = JSON.parse(argsStr); } catch (_) {}
      return {
        id: j.id || id(),
        name: card.querySelector('.job-name')?.value?.trim() || 'Unnamed',
        schedule: card.querySelector('.job-schedule')?.value?.trim() || '* * * * *',
        type: card.querySelector('.job-type')?.value || 'skill',
        enabled: card.querySelector('.job-enabled')?.checked !== false,
        skillId: card.querySelector('.job-skillId')?.value?.trim() || '',
        args: card.querySelector('.job-type')?.value === 'skill' ? args : undefined,
        prompt: card.querySelector('.job-type')?.value === 'prompt' ? (card.querySelector('.job-prompt')?.value?.trim() || '') : undefined,
        emailResult: card.querySelector('.job-emailResult')?.checked === true || undefined,
        emailSubject: (card.querySelector('.job-emailSubject')?.value?.trim() || undefined)
      };
    });
  }

  addJobBtn.addEventListener('click', () => {
    jobs.push({
      id: id(),
      name: 'New job',
      schedule: '*/5 * * * *',
      type: 'skill',
      enabled: true,
      skillId: 'example',
      args: {}
    });
    render();
  });

  saveBtn.addEventListener('click', async () => {
    jobs = getJobsFromDom();
    setStatus('Saving...');
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ heartbeat: jobs })
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setStatus('Saved. Scheduler updated.');
    } catch (e) {
      setStatus(e.message, true);
    }
  });

  async function load() {
    try {
      const res = await fetch('/api/config');
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      jobs = (data.heartbeat || []).map(j => ({ ...j }));
      render();
    } catch (e) {
      heartbeatList.innerHTML = '<p class="skill-empty">' + escapeHtml(e.message) + '</p>';
    }
  }

  load();
})();
