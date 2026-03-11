(function () {
  const projectSelect = document.getElementById('ragProjectSelect');
  const fileInput = document.getElementById('ragFile');
  const uploadBtn = document.getElementById('ragUploadBtn');
  const clearBtn = document.getElementById('ragClearBtn');
  const indexMemoryBtn = document.getElementById('ragIndexMemoryBtn');
  const statusEl = document.getElementById('ragStatus');

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color = isError ? 'var(--red)' : 'var(--text-dim)';
  }

  function getScope() {
    const checked = document.querySelector('input[name="ragScope"]:checked');
    return checked ? checked.value : 'global';
  }

  function getProjectId() {
    if (getScope() !== 'project') return null;
    return projectSelect && projectSelect.value ? projectSelect.value : null;
  }

  function updateProjectControls() {
    const scope = getScope();
    const isProject = scope === 'project';
    if (projectSelect) projectSelect.disabled = !isProject;
    if (indexMemoryBtn) indexMemoryBtn.disabled = !isProject || !getProjectId();
  }

  document.querySelectorAll('input[name="ragScope"]').forEach(function (el) {
    el.addEventListener('change', function () {
      updateProjectControls();
    });
  });

  if (projectSelect) {
    projectSelect.addEventListener('change', function () {
      updateProjectControls();
    });
  }

  function loadProjects() {
    if (!projectSelect) return;
    fetch('/api/projects')
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (projects) {
        const list = Array.isArray(projects) ? projects : [];
        projectSelect.innerHTML = '<option value="">Select project…</option>' +
          list.map(function (p) {
            const id = p.id || '';
            const name = p.name || id || 'Untitled project';
            return '<option value="' + id.replace(/"/g, '&quot;') + '">' + name.replace(/</g, '&lt;') + '</option>';
          }).join('');
      })
      .catch(function () {
        // ignore
      });
  }

  if (uploadBtn) {
    uploadBtn.addEventListener('click', function () {
      const file = fileInput && fileInput.files && fileInput.files[0];
      if (!file) {
        setStatus('Please choose a file to upload.', true);
        return;
      }
      const scope = getScope();
      const projectId = getProjectId();
      if (scope === 'project' && !projectId) {
        setStatus('Select a project for project-scoped indexing.', true);
        return;
      }
      const form = new FormData();
      form.append('file', file);
      form.append('scope', scope);
      if (projectId) form.append('projectId', projectId);
      setStatus('Uploading and indexing…', false);
      fetch('/api/rag/upload', { method: 'POST', body: form })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (result) {
          if (result.ok && result.data && result.data.ok) {
            setStatus('Indexed ' + (result.data.chunks || 0) + ' chunk(s).', false);
            if (fileInput) fileInput.value = '';
          } else {
            setStatus((result.data && result.data.error) || 'Failed to index file.', true);
          }
        })
        .catch(function (err) {
          setStatus((err && err.message) || 'Failed to index file.', true);
        });
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      const scope = getScope();
      const projectId = getProjectId();
      if (scope === 'project' && !projectId) {
        setStatus('Select a project to clear its index.', true);
        return;
      }
      if (!confirm('Clear the RAG index for this target? This cannot be undone.')) return;
      setStatus('Clearing index…', false);
      fetch('/api/rag/collection', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: scope, projectId: projectId })
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (result) {
          if (result.ok && result.data && result.data.ok) {
            setStatus('Index cleared.', false);
          } else {
            setStatus((result.data && result.data.error) || 'Failed to clear index.', true);
          }
        })
        .catch(function (err) {
          setStatus((err && err.message) || 'Failed to clear index.', true);
        });
    });
  }

  if (indexMemoryBtn) {
    indexMemoryBtn.addEventListener('click', function () {
      const projectId = getProjectId();
      if (!projectId) {
        setStatus('Select a project to index its memory.', true);
        return;
      }
      setStatus('Indexing project memory…', false);
      fetch('/api/rag/index-project-memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: projectId })
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (result) {
          if (result.ok && result.data && result.data.ok) {
            setStatus('Indexed project memory (' + (result.data.chunks || 0) + ' chunk(s)).', false);
          } else {
            setStatus((result.data && result.data.error) || 'Failed to index project memory.', true);
          }
        })
        .catch(function (err) {
          setStatus((err && err.message) || 'Failed to index project memory.', true);
        });
    });
  }

  updateProjectControls();
  loadProjects();
})();

