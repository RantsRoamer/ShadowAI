(function () {
  const projectList = document.getElementById('projectList');
  const newProjectBtn = document.getElementById('newProjectBtn');

  function loadProjects() {
    projectList.innerHTML = '<li class="project-list-loading">Loading…</li>';
    fetch('/api/projects')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(r.statusText)))
      .then(projects => {
        if (!projects || projects.length === 0) {
          projectList.innerHTML = '<li class="project-list-empty">No projects yet. Create one to get started.</li>';
          return;
        }
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
      })
      .catch(() => {
        projectList.innerHTML = '<li class="project-list-empty">Failed to load projects.</li>';
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
