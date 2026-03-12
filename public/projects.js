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
  const reportProjectChecks = document.getElementById('reportProjectChecks');
  const reportPromptInput = document.getElementById('reportPromptInput');
  const reportSaveBtn = document.getElementById('reportSaveBtn');
  const reportCancelBtn = document.getElementById('reportCancelBtn');
  const reportStatus = document.getElementById('reportStatus');

  let projects = [];
  let editingReportId = null;

  // ── Schedule builder helpers ──────────────────────────────────────────────

  function initScheduleSelects() {
    const hourSel = document.getElementById('schedHour');
    if (hourSel && !hourSel.options.length) {
      for (let h = 0; h < 24; h++) {
        const o = document.createElement('option');
        o.value = h; o.textContent = String(h).padStart(2, '0') + ':00';
        hourSel.appendChild(o);
      }
    }
    const domSel = document.getElementById('schedDom');
    if (domSel && !domSel.options.length) {
      for (let d = 1; d <= 28; d++) {
        const o = document.createElement('option');
        o.value = d; o.textContent = d;
        domSel.appendChild(o);
      }
    }
    const hMinSel = document.getElementById('schedHourlyMin');
    if (hMinSel && !hMinSel.options.length) {
      for (let m = 0; m < 60; m += 5) {
        const o = document.createElement('option');
        o.value = m; o.textContent = String(m).padStart(2, '0');
        hMinSel.appendChild(o);
      }
    }
  }

  function setSelectNearest(id, numStr, validValues) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const n = parseInt(numStr, 10);
    if (isNaN(n)) { sel.value = String(validValues[0]); return; }
    let best = validValues[0], bestDist = Math.abs(n - validValues[0]);
    for (const v of validValues) { const d = Math.abs(n - v); if (d < bestDist) { bestDist = d; best = v; } }
    sel.value = String(best);
  }

  function updateScheduleVisibility() {
    const freq = (document.getElementById('schedFreq') || {}).value || 'daily';
    const show = (id, vis) => { const el = document.getElementById(id); if (el) el.style.display = vis ? '' : 'none'; };
    show('schedTimeWrap', freq === 'daily' || freq === 'weekly' || freq === 'monthly');
    show('schedDayWrap', freq === 'weekly');
    show('schedDomWrap', freq === 'monthly');
    show('schedHourlyWrap', freq === 'hourly');
    show('schedCustomInput', freq === 'custom');
    updateSchedulePreview();
  }

  function getScheduleCron() {
    const freq = (document.getElementById('schedFreq') || {}).value || 'daily';
    if (freq === 'custom') return ((document.getElementById('schedCustomInput') || {}).value || '').trim() || '0 8 * * *';
    if (freq === 'hourly') return ((document.getElementById('schedHourlyMin') || {}).value || '0') + ' * * * *';
    const hour = (document.getElementById('schedHour') || {}).value || '8';
    const min  = (document.getElementById('schedMin')  || {}).value || '0';
    if (freq === 'daily')   return min + ' ' + hour + ' * * *';
    if (freq === 'weekly')  return min + ' ' + hour + ' * * ' + ((document.getElementById('schedDay') || {}).value || '1');
    if (freq === 'monthly') return min + ' ' + hour + ' ' + ((document.getElementById('schedDom') || {}).value || '1') + ' * *';
    return '0 8 * * *';
  }

  function setScheduleFromCron(cron) {
    initScheduleSelects();
    if (!cron) cron = '0 8 * * *';
    const parts = cron.trim().split(/\s+/);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    if (parts.length === 5) {
      const [min, hour, dom, month, dow] = parts;
      const hourOk = /^\d+$/.test(hour);
      if (hour === '*' && dom === '*' && month === '*' && dow === '*') {
        set('schedFreq', 'hourly');
        setSelectNearest('schedHourlyMin', min, [0,5,10,15,20,25,30,35,40,45,50,55]);
        updateScheduleVisibility(); return;
      }
      if (/^\d+$/.test(dom) && month === '*' && dow === '*' && hourOk) {
        set('schedFreq', 'monthly'); set('schedDom', dom); set('schedHour', hour);
        setSelectNearest('schedMin', min, [0,15,30,45]);
        updateScheduleVisibility(); return;
      }
      if (dom === '*' && month === '*' && /^\d+$/.test(dow) && hourOk) {
        set('schedFreq', 'weekly'); set('schedDay', dow); set('schedHour', hour);
        setSelectNearest('schedMin', min, [0,15,30,45]);
        updateScheduleVisibility(); return;
      }
      if (dom === '*' && month === '*' && dow === '*' && hourOk) {
        set('schedFreq', 'daily'); set('schedHour', hour);
        setSelectNearest('schedMin', min, [0,15,30,45]);
        updateScheduleVisibility(); return;
      }
    }
    set('schedFreq', 'custom');
    set('schedCustomInput', cron);
    updateScheduleVisibility();
  }

  function updateSchedulePreview() {
    const el = document.getElementById('schedPreview');
    if (el) el.textContent = getScheduleCron();
  }

  function describeCron(cron) {
    if (!cron) return '—';
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return cron;
    const [min, hour, dom, month, dow] = parts;
    const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const pad = n => String(n).padStart(2, '0');
    if (hour === '*' && dom === '*' && month === '*' && dow === '*') return 'Hourly :' + pad(min);
    if (dom === '*' && month === '*' && dow === '*' && /^\d+$/.test(hour)) return 'Daily ' + pad(hour) + ':' + pad(min);
    if (dom === '*' && month === '*' && /^\d+$/.test(dow) && /^\d+$/.test(hour)) return (DAYS[+dow] || 'day ' + dow) + ' ' + pad(hour) + ':' + pad(min);
    if (/^\d+$/.test(dom) && month === '*' && dow === '*' && /^\d+$/.test(hour)) return 'Monthly day ' + dom + ' ' + pad(hour) + ':' + pad(min);
    return cron;
  }

  // ─────────────────────────────────────────────────────────────────────────

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
          const scheduleLabel = describeCron(r.schedule);
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
          setScheduleFromCron(report.schedule || '0 8 * * *');
          reportPromptInput.value = report.reportPrompt || '';
          renderProjectChecks(report.projectIds || []);
          reportFormWrap.style.display = 'block';
        });
    } else {
      reportName.value = '';
      reportEnabled.checked = true;
      reportToEmail.value = '';
      setScheduleFromCron('0 8 * * *');
      reportPromptInput.value = '';
      renderProjectChecks([]);
      reportFormWrap.style.display = 'block';
    }
  }

  function closeReportForm() {
    editingReportId = null;
    reportFormWrap.style.display = 'none';
  }

  const schedFreqEl = document.getElementById('schedFreq');
  if (schedFreqEl) schedFreqEl.addEventListener('change', updateScheduleVisibility);
  ['schedDay', 'schedDom', 'schedHour', 'schedMin', 'schedHourlyMin'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', updateSchedulePreview);
  });
  const schedCustomInputEl = document.getElementById('schedCustomInput');
  if (schedCustomInputEl) schedCustomInputEl.addEventListener('input', updateSchedulePreview);

  if (addReportBtn) {
    addReportBtn.addEventListener('click', () => openReportForm(null));
  }

  if (reportCancelBtn) {
    reportCancelBtn.addEventListener('click', closeReportForm);
  }

  if (reportSaveBtn) {
    reportSaveBtn.addEventListener('click', function () {
      const name = (reportName.value || '').trim() || 'Report';
      const schedule = getScheduleCron();
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
      .then(function (r) {
        const status = r.status;
        const contentType = (r.headers.get('content-type') || '').toLowerCase();
        if (contentType.indexOf('application/json') !== -1) {
          return r.text().then(function (body) {
            var data;
            try {
              data = body ? JSON.parse(body) : {};
            } catch (e) {
              return { ok: false, status: status, data: { error: 'Invalid JSON from server (HTTP ' + status + '): ' + (e && e.message ? e.message : String(e)), code: 'PARSE_ERROR' } };
            }
            return { ok: r.ok, status: status, data: data };
          });
        }
        return r.text().then(function (text) {
          return { ok: false, status: status, data: { error: (text && text.trim()) ? text : 'Server returned non-JSON (HTTP ' + status + ')' } };
        });
      })
      .then(function (result) {
        if (btn) btn.disabled = false;
        // 200 = sent (legacy), 202 = accepted / send started in background (avoids timeout)
        var ok = result && result.data && result.data.ok && (result.status === 200 || result.status === 202);
        if (ok) {
          if (result.data && result.data.message) alert(result.data.message);
          loadReports();
        } else {
          var status = (result && result.status) ? result.status : '?';
          var err = (result && result.data && result.data.error && String(result.data.error).trim()) ? result.data.error : 'No error message from server.';
          var line = 'HTTP ' + status + ': ' + err;
          if (result && result.data && result.data.code) line += ' [Code: ' + result.data.code + ']';
          console.error('[Projects] Send report failed:', line, result);
          alert(line);
        }
      })
      .catch(function (err) {
        if (btn) btn.disabled = false;
        var msg = (err && (err.message || err.name || String(err))) || 'Unknown error';
        if (err && err.message === '' && err.name) msg = err.name + ' (no message)';
        console.error('[Projects] Send report request error:', err);
        alert('Send report failed (network or client error): ' + msg + '\n\nIf the report takes a long time to generate, it may still have been sent—check your inbox.');
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
