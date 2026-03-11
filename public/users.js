(function () {
  const tbody = document.getElementById('usersTbody');
  const usersError = document.getElementById('usersError');
  const usernameEl = document.getElementById('userUsername');
  const passwordEl = document.getElementById('userPassword');
  const roleEl = document.getElementById('userRole');
  const saveBtn = document.getElementById('userSaveBtn');
  const statusEl = document.getElementById('userStatus');

  let accessTargetUser = null;
  let allProjects = [];

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  function setError(msg) {
    if (!usersError) return;
    usersError.textContent = msg || '';
  }

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.style.color = isError ? 'var(--red)' : 'var(--text-dim)';
  }

  function openAccessPanel(username) {
    accessTargetUser = username;
    const section = document.getElementById('projectAccessSection');
    const titleEl = document.getElementById('projectAccessUsername');
    const listEl = document.getElementById('projectAccessList');
    const accessStatusEl = document.getElementById('accessStatus');
    titleEl.textContent = username;
    accessStatusEl.textContent = '';
    listEl.innerHTML = '<div style="color:var(--text-dim);font-size:12px;">Loading…</div>';
    section.style.display = '';
    section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    fetch('/api/projects')
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('Failed')); })
      .then(function (projects) {
        allProjects = projects;
        if (!projects.length) {
          listEl.innerHTML = '<div style="color:var(--text-dim);font-size:12px;">No projects exist yet.</div>';
          return;
        }
        listEl.innerHTML = projects.map(function (p) {
          var share = Array.isArray(p.shares) ? p.shares.find(function (s) { return s.username === username; }) : null;
          var cur = share ? share.access : 'none';
          return '<div class="project-access-row" data-project-id="' + esc(p.id) + '">' +
            '<span class="project-access-name">' + esc(p.name || p.id) + '</span>' +
            '<span class="project-access-owner">(' + esc(p.owner || '—') + ')</span>' +
            '<select class="project-access-select" data-project-id="' + esc(p.id) + '">' +
              '<option value="none"' + (cur === 'none' ? ' selected' : '') + '>None</option>' +
              '<option value="view"' + (cur === 'view' ? ' selected' : '') + '>Read-only</option>' +
              '<option value="user"' + (cur === 'user' ? ' selected' : '') + '>User</option>' +
              '<option value="admin"' + (cur === 'admin' ? ' selected' : '') + '>Admin</option>' +
            '</select>' +
          '</div>';
        }).join('');
      })
      .catch(function (err) {
        listEl.innerHTML = '<div style="color:var(--red);font-size:12px;">' + esc(err.message || 'Failed to load projects.') + '</div>';
      });
  }

  var saveAccessBtn = document.getElementById('saveAccessBtn');
  if (saveAccessBtn) {
    saveAccessBtn.addEventListener('click', function () {
      if (!accessTargetUser) return;
      var accessStatusEl = document.getElementById('accessStatus');
      accessStatusEl.textContent = 'Saving…';
      accessStatusEl.style.color = '';

      var updates = [];
      document.querySelectorAll('.project-access-select').forEach(function (sel) {
        var projectId = sel.getAttribute('data-project-id');
        var newAccess = sel.value;
        var project = allProjects.find(function (p) { return p.id === projectId; });
        if (!project) return;
        var shares = Array.isArray(project.shares) ? project.shares.slice() : [];
        var idx = shares.findIndex(function (s) { return s.username === accessTargetUser; });
        var curAccess = idx >= 0 ? shares[idx].access : 'none';
        if (newAccess === curAccess) return;
        if (newAccess === 'none') {
          shares.splice(idx, 1);
        } else if (idx >= 0) {
          shares[idx] = { username: accessTargetUser, access: newAccess };
        } else {
          shares.push({ username: accessTargetUser, access: newAccess });
        }
        updates.push(
          fetch('/api/projects/' + encodeURIComponent(projectId) + '/shares', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ shares: shares })
          }).then(function (r) {
            return r.json().then(function (d) {
              if (r.ok) {
                var p = allProjects.find(function (p) { return p.id === projectId; });
                if (p) p.shares = d.shares || [];
              }
            });
          })
        );
      });

      if (!updates.length) {
        accessStatusEl.textContent = 'No changes to save.';
        return;
      }
      Promise.all(updates)
        .then(function () {
          accessStatusEl.textContent = 'Saved.';
          setTimeout(function () { accessStatusEl.textContent = ''; }, 2000);
        })
        .catch(function () {
          accessStatusEl.textContent = 'Some changes failed to save.';
          accessStatusEl.style.color = 'var(--red)';
        });
    });
  }

  var closeAccessBtn = document.getElementById('closeAccessBtn');
  if (closeAccessBtn) {
    closeAccessBtn.addEventListener('click', function () {
      var section = document.getElementById('projectAccessSection');
      if (section) section.style.display = 'none';
      accessTargetUser = null;
    });
  }

  function loadUsers() {
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="3">Loading…</td></tr>';
    fetch('/api/users')
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (result) {
        if (!result.ok || !Array.isArray(result.data && result.data.users)) {
          tbody.innerHTML = '<tr><td colspan="3">Failed to load users.</td></tr>';
          setError((result.data && result.data.error) || '');
          return;
        }
        setError('');
        const users = result.data.users;
        if (users.length === 0) {
          tbody.innerHTML = '<tr><td colspan="3">No users yet.</td></tr>';
          return;
        }
        tbody.innerHTML = users.map(function (u) {
          var escName = String(u.username || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
          var escRole = String(u.role || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
          return '<tr>' +
            '<td>' + escName + '</td>' +
            '<td>' + escRole + '</td>' +
            '<td>' +
              '<button type="button" class="btn btn-small users-edit" data-username="' + escName + '" data-role="' + escRole + '">Edit</button> ' +
              '<button type="button" class="btn btn-small users-projects" data-username="' + escName + '">Projects</button> ' +
              (escName === 'admin' ? '' : '<button type="button" class="btn btn-small danger users-delete" data-username="' + escName + '">Delete</button>') +
            '</td>' +
          '</tr>';
        }).join('');
        tbody.querySelectorAll('.users-edit').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var u = btn.getAttribute('data-username') || '';
            var r = btn.getAttribute('data-role') || 'user';
            usernameEl.value = u;
            roleEl.value = r;
            passwordEl.value = '';
            setStatus('Editing user ' + u + ' (change role or password, then Save user).');
          });
        });
        tbody.querySelectorAll('.users-projects').forEach(function (btn) {
          btn.addEventListener('click', function () {
            openAccessPanel(btn.getAttribute('data-username') || '');
          });
        });
        tbody.querySelectorAll('.users-delete').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var u = btn.getAttribute('data-username') || '';
            if (!u) return;
            if (!confirm('Delete user "' + u + '"? This cannot be undone.')) return;
            fetch('/api/users/' + encodeURIComponent(u), { method: 'DELETE' })
              .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
              .then(function (result) {
                if (!result.ok || !result.data || !result.data.ok) {
                  setError((result.data && result.data.error) || 'Failed to delete user.');
                  return;
                }
                setError('');
                setStatus('User deleted.', false);
                loadUsers();
              })
              .catch(function (err) {
                setError((err && err.message) || 'Failed to delete user.');
              });
          });
        });
      })
      .catch(function (err) {
        tbody.innerHTML = '<tr><td colspan="3">Failed to load users.</td></tr>';
        setError((err && err.message) || 'Failed to load users.');
      });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', function () {
      var username = (usernameEl.value || '').trim();
      var password = passwordEl.value;
      var role = roleEl.value || 'user';
      if (!username) {
        setStatus('Username is required.', true);
        return;
      }
      var payload = { role: role };
      var method = 'POST';
      var url = '/api/users';
      if (password) payload.password = password;
      // If user already exists, treat as update
      if (tbody && tbody.querySelector('button.users-edit[data-username="' + username.replace(/"/g, '&quot;') + '"]')) {
        method = 'PUT';
        url = '/api/users/' + encodeURIComponent(username);
      } else {
        payload.username = username;
      }
      setStatus('Saving…', false);
      fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (result) {
          if (!result.ok || !result.data || !result.data.ok) {
            setStatus((result.data && result.data.error) || 'Failed to save user.', true);
            return;
          }
          setStatus('User saved.', false);
          passwordEl.value = '';
          loadUsers();
        })
        .catch(function (err) {
          setStatus((err && err.message) || 'Failed to save user.', true);
        });
    });
  }

  loadUsers();
})();

