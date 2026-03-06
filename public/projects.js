(function () {
  const projectList = document.getElementById('projectList');
  const newProjectBtn = document.getElementById('newProjectBtn');
  const reportsList = document.getElementById('reportsList');
  const addReportBtn = document.getElementById('addReportBtn');
  const reportFormWrap = document.getElementById('reportFormWrap');
  const reportFormTitle = document.getElementById('reportFormTitle');
  const reportName = document.getElementById('reportName');
  const reportEnabled = document.getElementById('reportEnabled');
  const reportToEmail = document.getElementById('reportToEmail');
  const reportSchedule = document.getElementById('reportSchedule');
  const reportScheduleCustom = document.getElementById('reportScheduleCustom');
  const reportProjectChecks = document.getElementById('reportProjectChecks');
  const reportPromptInput = document.getElementById('reportPromptInput');
  const reportSaveBtn = document.getElementById('reportSaveBtn');
  const reportCancelBtn = document.getElementById('reportCancelBtn');
  const reportStatus = document.getElementById('reportStatus');

  let projects = [];
  let editingReportId = null;

  const SCHEDULE_LABELS = {
    '0 8 * * *': 'Daily 8:00',
    '0 9 * * *': 'Daily 9:00',
    '0 7 * * *': 'Daily 7:00',
    '0 18 * * *': 'Daily 18:00',
    '0 8 * * 1': 'Mon 8:00',
    '0 9 * * 1': 'Mon 9:00',
    '0 8 * * 5': 'Fri 8:00'
  };

  function switchTab(tabId) {
    document.querySelectorAll('.projects-tab').forEach(t => {
      t.classList.toggle('active', t.getAttribute('data-tab') === tabId);
      t.setAttribute('aria-selected', t.getAttribute('data-tab') === tabId ? 'true' : 'false');
    });
    document.querySelectorAll('.projects-panel').forEach(p => {
      const isActive = p.id === tabId + '-panel';
      p.classList.toggle('active', isActive);
      if (p.hidden !== undefined) p.hidden = !isActive;
    });
    if (tabId === 'reports') {
      if (projects.length === 0) {
        fetch('/api/projects').then(r => r.ok ? r.json() : []).then(p => { projects = p || []; loadReports(); });
      } else {
        loadReports();
      }
    }
  }

  document.querySelectorAll('.projects-tab').forEach(btn => {
    btn.addEventListener('click', function () {
      switchTab(this.getAttribute('data-tab'));
    });
  });

  function escapeHtml(s) {
    if (s == null) return '';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function loadProjects() {
    projectList.innerHTML = '<li class="project-list-loading">Loading…</li>';
    fetch('/api/projects')
      .then(r => r.ok ? r.json() : [])
      .then(list => {
        projects = list || [];
        if (projects.length === 0) {
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
      })
      .catch(() => {
        projectList.innerHTML = '<li class="project-list-empty">Failed to load projects.</li>';
      });
  }

  function loadReports() {
    if (!reportsList) return;
    reportsList.innerHTML = '<li class="reports-loading">Loading…</li>';
    fetch('/api/projects/reports')
      .then(r => r.ok ? r.json() : [])
      .then(reports => {
        if (!reports || reports.length === 0) {
          reportsList.innerHTML = '<li class="reports-empty">No reports yet. Click “Add report” to create one.</li>';
          return;
        }
        reportsList.innerHTML = reports.map(r => {
          const scheduleLabel = SCHEDULE_LABELS[r.schedule] || r.schedule || '—';
          const lastRun = r.lastRunAt ? new Date(r.lastRunAt).toLocaleString() : 'Never';
          const projCount = Array.isArray(r.projectIds) ? r.projectIds.length : 0;
          return `
          <li class="report-card" data-id="${escapeHtml(r.id)}">
            <div class="report-card-main">
              <span class="report-card-name">${escapeHtml(r.name || 'Report')}</span>
              <span class="report-card-meta">${escapeHtml(scheduleLabel)} · ${escapeHtml(r.toEmail || '')} · ${projCount} project(s)</span>
              <span class="report-card-last">Last sent: ${escapeHtml(lastRun)}</span>
            </div>
            <div class="report-card-actions">
              <button type="button" class="btn btn-small report-edit" data-id="${escapeHtml(r.id)}">Edit</button>
              <button type="button" class="btn btn-small report-send" data-id="${escapeHtml(r.id)}">Send now</button>
              <button type="button" class="btn btn-small danger report-delete" data-id="${escapeHtml(r.id)}">Delete</button>
            </div>
          </li>`;
        }).join('');
        reportsList.querySelectorAll('.report-edit').forEach(btn => {
          btn.addEventListener('click', () => openReportForm(btn.getAttribute('data-id')));
        });
        reportsList.querySelectorAll('.report-send').forEach(btn => {
          btn.addEventListener('click', () => sendReportNow(btn.getAttribute('data-id')));
        });
        reportsList.querySelectorAll('.report-delete').forEach(btn => {
          btn.addEventListener('click', () => deleteReport(btn.getAttribute('data-id')));
        });
      })
      .catch(() => {
        reportsList.innerHTML = '<li class="reports-empty">Failed to load reports.</li>';
      });
  }

  function renderProjectChecks(selectedIds) {
    if (!reportProjectChecks) return;
    const set = new Set(selectedIds || []);
    reportProjectChecks.innerHTML = projects.map(p =>
      `<label><input type="checkbox" class="report-project-check" data-id="${escapeHtml(p.id)}" ${set.has(p.id) ? 'checked' : ''} /><span>${escapeHtml(p.name || 'Untitled')}</span></label>`
    ).join('');
  }

  function openReportForm(reportId) {
    editingReportId = reportId || null;
    reportFormTitle.textContent = reportId ? 'Edit report' : 'New report';
    reportStatus.textContent = '';
    if (reportId) {
      fetch('/api/projects/reports/' + encodeURIComponent(reportId))
        .then(r => r.ok ? r.json() : null)
        .then(report => {
          if (!report) return;
          reportName.value = report.name || '';
          reportEnabled.checked = report.enabled !== false;
          reportToEmail.value = report.toEmail || '';
          const schedule = report.schedule || '0 8 * * *';
          const isCustom = !Object.keys(SCHEDULE_LABELS).includes(schedule);
          reportSchedule.value = isCustom ? 'custom' : schedule;
          reportScheduleCustom.style.display = isCustom ? 'block' : 'none';
          reportScheduleCustom.value = isCustom ? schedule : '';
          reportPromptInput.value = report.reportPrompt || '';
          renderProjectChecks(report.projectIds || []);
          reportFormWrap.style.display = 'block';
        });
    } else {
      reportName.value = '';
      reportEnabled.checked = true;
      reportToEmail.value = '';
      reportSchedule.value = '0 8 * * *';
      reportScheduleCustom.style.display = 'none';
      reportScheduleCustom.value = '';
      reportPromptInput.value = '';
      renderProjectChecks([]);
      reportFormWrap.style.display = 'block';
    }
  }

  function closeReportForm() {
    editingReportId = null;
    reportFormWrap.style.display = 'none';
  }

  if (reportSchedule) {
    reportSchedule.addEventListener('change', function () {
      reportScheduleCustom.style.display = this.value === 'custom' ? 'block' : 'none';
      if (this.value !== 'custom') reportScheduleCustom.value = '';
    });
  }

  if (addReportBtn) {
    addReportBtn.addEventListener('click', () => openReportForm(null));
  }

  if (reportCancelBtn) {
    reportCancelBtn.addEventListener('click', closeReportForm);
  }

  if (reportSaveBtn) {
    reportSaveBtn.addEventListener('click', function () {
      const name = (reportName.value || '').trim() || 'Report';
      const schedule = reportSchedule.value === 'custom'
        ? (reportScheduleCustom.value || '').trim() || '0 8 * * *'
        : reportSchedule.value;
      const projectIds = Array.from(reportProjectChecks.querySelectorAll('.report-project-check:checked')).map(cb => cb.getAttribute('data-id'));
      const body = {
        name,
        enabled: reportEnabled.checked,
        schedule,
        toEmail: (reportToEmail.value || '').trim(),
        projectIds,
        reportPrompt: (reportPromptInput.value || '').trim()
      };
      reportStatus.textContent = '';
      reportStatus.classList.remove('saved');
      const url = editingReportId
        ? '/api/projects/reports/' + encodeURIComponent(editingReportId)
        : '/api/projects/reports';
      const method = editingReportId ? 'PUT' : 'POST';
      fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(r => r.ok ? r.json() : Promise.reject(new Error(r.statusText)))
        .then(() => {
          reportStatus.textContent = 'Saved.';
          reportStatus.classList.add('saved');
          setTimeout(() => { closeReportForm(); loadReports(); reportStatus.textContent = ''; reportStatus.classList.remove('saved'); }, 800);
        })
        .catch(err => {
          reportStatus.textContent = 'Failed: ' + err.message;
        });
    });
  }

  function sendReportNow(reportId) {
    const card = reportsList && reportsList.querySelector('.report-card[data-id="' + reportId.replace(/"/g, '\\"') + '"]');
    const btn = card && card.querySelector('.report-send');
    if (btn) btn.disabled = true;
    fetch('/api/projects/reports/' + encodeURIComponent(reportId) + '/send', { method: 'POST' })
      .then(r => r.json().then(data => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (btn) btn.disabled = false;
        if (ok && data.ok) {
          loadReports();
        } else {
          alert(data.error || 'Send failed.');
        }
      })
      .catch(() => {
        if (btn) btn.disabled = false;
        alert('Request failed.');
      });
  }

  function deleteReport(reportId) {
    const report = Array.from(reportsList.querySelectorAll('.report-card')).find(el => el.getAttribute('data-id') === reportId);
    const name = report && report.querySelector('.report-card-name') ? report.querySelector('.report-card-name').textContent : reportId;
    if (!confirm('Delete report "' + name + '"? This cannot be undone.')) return;
    fetch('/api/projects/reports/' + encodeURIComponent(reportId), { method: 'DELETE' })
      .then(r => {
        if (r.status === 404) throw new Error('Report not found');
        return r.ok ? r.json() : r.json().then(d => { throw new Error(d.error || r.statusText); });
      })
      .then(() => {
        if (editingReportId === reportId) closeReportForm();
        loadReports();
      })
      .catch(err => alert('Failed to delete: ' + err.message));
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

  loadProjects();
})();
