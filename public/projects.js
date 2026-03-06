(function () {
  const projectList = document.getElementById('projectList');
  const newProjectBtn = document.getElementById('newProjectBtn');
  const reportEnabled = document.getElementById('reportEnabled');
  const reportToEmail = document.getElementById('reportToEmail');
  const reportSchedule = document.getElementById('reportSchedule');
  const reportScheduleCustom = document.getElementById('reportScheduleCustom');
  const reportProjectChecks = document.getElementById('reportProjectChecks');
  const reportSaveBtn = document.getElementById('reportSaveBtn');
  const reportStatus = document.getElementById('reportStatus');
  const reportLastRun = document.getElementById('reportLastRun');

  function loadProjects() {
    projectList.innerHTML = '<li class="project-list-loading">Loading…</li>';
    Promise.all([fetch('/api/projects').then(r => r.ok ? r.json() : []), fetch('/api/projects/report-config').then(r => r.ok ? r.json() : null)])
      .then(([projects, reportConfig]) => {
        if (!projects || projects.length === 0) {
          projectList.innerHTML = '<li class="project-list-empty">No projects yet. Create one to get started.</li>';
        } else {
          projectList.innerHTML = projects.map(p => {
            const updated = p.updatedAt ? new Date(p.updatedAt).toLocaleString() : '—';
            return `
            <li class="project-card">
              <a href="/project?id=${encodeURIComponent(p.id)}">
                <p class="project-card-name">${escapeHtml(p.name || 'Untitled project')}</p>
                <p class="project-card-meta">Updated ${updated}</p>
              </a>
              <div class="project-card-actions">
                <a href="/project?id=${encodeURIComponent(p.id)}" class="btn">Open</a>
                <button type="button" class="btn danger delete-project" data-id="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name || '')}">Delete</button>
              </div>
            </li>`;
          }).join('');
          projectList.querySelectorAll('.delete-project').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.preventDefault();
              const id = btn.getAttribute('data-id');
              const name = btn.getAttribute('data-name') || id;
              if (!confirm(`Delete project "${name}"? This cannot be undone.`)) return;
              fetch(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' })
                .then(r => r.ok ? r.json() : Promise.reject(new Error(r.statusText)))
                .then(() => loadProjects())
                .catch(err => alert('Failed to delete: ' + err.message));
            });
          });
        }
        applyReportConfig(projects || [], reportConfig);
      })
      .catch(() => {
        projectList.innerHTML = '<li class="project-list-empty">Failed to load projects.</li>';
      });
  }

  function applyReportConfig(projects, reportConfig) {
    if (!reportConfig) return;
    reportEnabled.checked = !!reportConfig.enabled;
    reportToEmail.value = reportConfig.toEmail || '';
    const schedule = reportConfig.schedule || '0 8 * * *';
    const isCustom = !Array.from(reportSchedule.options).some(o => o.value === schedule);
    if (isCustom) {
      reportSchedule.value = 'custom';
      reportScheduleCustom.value = schedule;
      reportScheduleCustom.style.display = 'block';
    } else {
      reportSchedule.value = schedule;
      reportScheduleCustom.style.display = 'none';
    }
    const selectedIds = new Set(reportConfig.projectIds || []);
    reportProjectChecks.innerHTML = (projects || []).map(p => `
      <label>
        <input type="checkbox" class="report-project-check" data-id="${escapeHtml(p.id)}" ${selectedIds.has(p.id) ? 'checked' : ''} />
        <span>${escapeHtml(p.name || 'Untitled project')}</span>
      </label>
    `).join('');
    if (reportConfig.lastRunAt) {
      const d = new Date(reportConfig.lastRunAt);
      reportLastRun.textContent = 'Last sent: ' + d.toLocaleString();
    } else {
      reportLastRun.textContent = '';
    }
  }

  if (reportSchedule) {
    reportSchedule.addEventListener('change', function () {
      reportScheduleCustom.style.display = this.value === 'custom' ? 'block' : 'none';
      if (this.value !== 'custom') reportScheduleCustom.value = '';
    });
  }

  if (reportSaveBtn) {
    reportSaveBtn.addEventListener('click', function () {
      const schedule = reportSchedule.value === 'custom'
        ? (reportScheduleCustom.value || '').trim() || '0 8 * * *'
        : reportSchedule.value;
      const projectIds = Array.from(reportProjectChecks.querySelectorAll('.report-project-check:checked')).map(cb => cb.getAttribute('data-id'));
      reportStatus.textContent = '';
      reportStatus.classList.remove('saved');
      fetch('/api/projects/report-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: reportEnabled.checked,
          toEmail: reportToEmail.value.trim(),
          schedule: schedule,
          projectIds: projectIds
        })
      })
        .then(r => r.ok ? r.json() : Promise.reject(new Error(r.statusText)))
        .then(() => {
          reportStatus.textContent = 'Saved.';
          reportStatus.classList.add('saved');
          setTimeout(() => { reportStatus.textContent = ''; reportStatus.classList.remove('saved'); }, 3000);
        })
        .catch(err => {
          reportStatus.textContent = 'Failed: ' + err.message;
        });
    });
  }

  newProjectBtn.addEventListener('click', () => {
    const name = prompt('Project name', 'Untitled project') || 'Untitled project';
    fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() })
    })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(r.statusText)))
      .then(project => {
        window.location.href = '/project?id=' + encodeURIComponent(project.id);
      })
      .catch(err => alert('Failed to create project: ' + err.message));
  });

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  loadProjects();
})();
