(function () {
  const skillsList = document.getElementById('skillsList');
  const skillEmpty = document.getElementById('skillEmpty');
  const refreshBtn = document.getElementById('refreshBtn');
  const statusEl = document.getElementById('status');

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

  async function loadSkills() {
    try {
      const res = await fetch('/api/skills');
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      const data = await res.json();
      const skills = data.skills || [];
      render(skills);
    } catch (e) {
      skillsList.innerHTML = '<div class="skill-card"><span class="error">' + escapeHtml(e.message) + '</span></div>';
      skillEmpty.style.display = 'none';
    }
  }

  function render(skills) {
    if (skills.length === 0) {
      skillsList.innerHTML = '';
      skillEmpty.style.display = 'block';
      return;
    }
    skillEmpty.style.display = 'none';
    skillsList.innerHTML = skills.map(s => `
      <div class="skill-card ${s.enabled ? 'enabled' : ''}" data-id="${escapeHtml(s.id)}">
        <div class="skill-header">
          <div>
            <span class="skill-name">${escapeHtml(s.name)}</span>
            <span class="skill-id">${escapeHtml(s.id)}</span>
            <span class="status-badge">${s.loaded ? 'loaded' : 'disabled'}</span>
          </div>
        </div>
        <div class="skill-desc">${escapeHtml(s.description || 'No description')}</div>
        <div class="skill-actions">
          <label class="toggle-wrap">
            <input type="checkbox" class="skill-enabled" ${s.enabled ? 'checked' : ''} />
            Enable
          </label>
          <input type="text" class="run-args" placeholder='{"key":"value"}' title="JSON args for Run" />
          <button type="button" class="btn btn-small skill-run">Run</button>
          <button type="button" class="btn btn-small skill-edit">Edit</button>
          <button type="button" class="btn btn-small danger skill-delete">Delete</button>
        </div>
      </div>
    `).join('');

    skillsList.querySelectorAll('.skill-enabled').forEach(cb => {
      cb.addEventListener('change', async () => {
        const card = cb.closest('.skill-card');
        const id = card.dataset.id;
        const enabled = cb.checked;
        try {
          const res = await fetch('/api/skills/' + encodeURIComponent(id) + '/enabled', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled })
          });
          if (!res.ok) throw new Error((await res.json()).error);
          card.classList.toggle('enabled', enabled);
          card.querySelector('.status-badge').textContent = enabled ? 'loaded' : 'disabled';
        } catch (e) {
          setStatus(e.message, true);
          cb.checked = !enabled;
        }
      });
    });

    skillsList.querySelectorAll('.skill-run').forEach(btn => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('.skill-card');
        const id = card.dataset.id;
        const argsEl = card.querySelector('.run-args');
        let args = {};
        try {
          const t = argsEl.value.trim();
          if (t) args = JSON.parse(t);
        } catch (_) {}
        try {
          const res = await fetch('/api/skills/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, args })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || res.statusText);
          setStatus('Result: ' + (typeof data.result === 'object' ? JSON.stringify(data.result) : String(data.result)));
        } catch (e) {
          setStatus(e.message, true);
        }
      });
    });

    skillsList.querySelectorAll('.skill-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('.skill-card');
        const id = card.dataset.id;
        if (!confirm('Delete skill "' + id + '"?')) return;
        try {
          const res = await fetch('/api/skills/' + encodeURIComponent(id), { method: 'DELETE' });
          if (!res.ok) throw new Error((await res.json()).error);
          card.remove();
          if (skillsList.querySelectorAll('.skill-card').length === 0) skillEmpty.style.display = 'block';
        } catch (e) {
          setStatus(e.message, true);
        }
      });
    });

    skillsList.querySelectorAll('.skill-edit').forEach(btn => {
      btn.addEventListener('click', () => openEditModal(btn.closest('.skill-card').dataset.id));
    });
  }

  function openEditModal(skillId) {
    const overlay = document.getElementById('skillEditOverlay');
    const nameEl = document.getElementById('skillEditName');
    const descEl = document.getElementById('skillEditDesc');
    const codeEl = document.getElementById('skillEditCode');
    const cancelBtn = document.getElementById('skillEditCancel');
    const saveBtn = document.getElementById('skillEditSave');
    overlay.dataset.skillId = skillId;
    overlay.classList.add('open');
    setStatus('');
    fetch('/api/skills/' + encodeURIComponent(skillId))
      .then(res => res.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        nameEl.value = data.name || '';
        descEl.value = data.description || '';
        codeEl.value = data.code || '';
      })
      .catch(e => setStatus(e.message, true));
  }

  function closeEditModal() {
    document.getElementById('skillEditOverlay').classList.remove('open');
  }

  function initEditModal() {
    const overlay = document.getElementById('skillEditOverlay');
    const saveBtn = document.getElementById('skillEditSave');
    const cancelBtn = document.getElementById('skillEditCancel');
    overlay.querySelector('.skill-edit-backdrop').addEventListener('click', closeEditModal);
    cancelBtn.addEventListener('click', closeEditModal);
    saveBtn.addEventListener('click', async () => {
      const id = overlay.dataset.skillId;
      const name = document.getElementById('skillEditName').value.trim();
      const description = document.getElementById('skillEditDesc').value.trim();
      const code = document.getElementById('skillEditCode').value;
      try {
        const res = await fetch('/api/skills/' + encodeURIComponent(id), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, description, code })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
        closeEditModal();
        loadSkills();
        setStatus('Skill updated.');
      } catch (e) {
        setStatus(e.message, true);
      }
    });
  }

  refreshBtn.addEventListener('click', () => loadSkills());
  initEditModal();
  loadSkills();
})();
