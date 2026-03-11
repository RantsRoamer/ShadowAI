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
  let allUsers = [];

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

  // ── Project access panel ──────────────────────────────────────────────────

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
          var isOwner = p.owner === username;
          var share = Array.isArray(p.shares) ? p.shares.find(function (s) { return s.username === username; }) : null;
          var cur = isOwner ? 'owner' : (share ? share.access : 'none');
          var selectDisabled = isOwner ? ' disabled title="Already owner — assign ownership via another user"' : '';
          return '<div class="project-access-row" data-project-id="' + esc(p.id) + '">' +
            '<span class="project-access-name">' + esc(p.name || p.id) + '</span>' +
            '<span class="project-access-owner">(' + esc(p.owner || '—') + ')</span>' +
            '<select class="project-access-select" data-project-id="' + esc(p.id) + '"' + selectDisabled + '>' +
              '<option value="none"' + (cur === 'none' ? ' selected' : '') + '>None</option>' +
              '<option value="view"' + (cur === 'view' ? ' selected' : '') + '>Read-only</option>' +
              '<option value="user"' + (cur === 'user' ? ' selected' : '') + '>User</option>' +
              '<option value="admin"' + (cur === 'admin' ? ' selected' : '') + '>Admin</option>' +
              '<option value="owner"' + (cur === 'owner' ? ' selected' : '') + '>Owner</option>' +
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
        var isOwner = project.owner === accessTargetUser;
        var curAccess = isOwner ? 'owner' : (function () {
          var share = Array.isArray(project.shares) ? project.shares.find(function (s) { return s.username === accessTargetUser; }) : null;
          return share ? share.access : 'none';
        }());
        if (newAccess === curAccess) return;

        if (newAccess === 'owner') {
          updates.push(
            fetch('/api/projects/' + encodeURIComponent(projectId), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ owner: accessTargetUser })
            }).then(function (r) {
              return r.json().then(function (d) {
                if (r.ok) {
                  var p = allProjects.find(function (p) { return p.id === projectId; });
                  if (p) { p.owner = d.owner || accessTargetUser; p.shares = d.shares || []; }
                }
              });
            })
          );
        } else {
          var shares = Array.isArray(project.shares) ? project.shares.slice() : [];
          var idx = shares.findIndex(function (s) { return s.username === accessTargetUser; });
          if (newAccess === 'none') {
            if (idx >= 0) shares.splice(idx, 1);
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
        }
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

  // ── Report access panel ───────────────────────────────────────────────────

  function buildReportRow(report, isOrphan) {
    var userOptions = allUsers.map(function (u) {
      return '<option value="' + esc(u.username) + '"' +
        (report.createdBy === u.username && !isOrphan ? ' selected' : '') +
        '>' + esc(u.username) + '</option>';
    }).join('');
    return '<div class="project-access-row" data-report-id="' + esc(report.id) + '">' +
      '<span class="project-access-name">' + esc(report.name) + '</span>' +
      '<select class="report-assign-select" data-report-id="' + esc(report.id) + '" style="width:120px;flex-shrink:0;">' +
        userOptions +
      '</select>' +
      '<button type="button" class="btn btn-small report-assign-btn" data-report-id="' + esc(report.id) + '" style="flex-shrink:0;">Assign</button>' +
      '<button type="button" class="btn btn-small danger report-delete-btn" data-report-id="' + esc(report.id) + '" style="flex-shrink:0;">Delete</button>' +
    '</div>';
  }

  function attachReportRowHandlers(container, statusEl) {
    container.querySelectorAll('.report-assign-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var reportId = btn.getAttribute('data-report-id');
        var row = container.querySelector('[data-report-id="' + reportId + '"]');
        var sel = row ? row.querySelector('.report-assign-select') : null;
        if (!sel) return;
        var newOwner = sel.value;
        statusEl.textContent = 'Saving…';
        statusEl.style.color = '';
        fetch('/api/projects/reports/' + encodeURIComponent(reportId), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ createdBy: newOwner })
        })
          .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
          .then(function (result) {
            if (!result.ok) {
              statusEl.textContent = (result.data && result.data.error) || 'Failed to assign.';
              statusEl.style.color = 'var(--red)';
              return;
            }
            statusEl.textContent = 'Assigned.';
            setTimeout(function () { statusEl.textContent = ''; }, 2000);
            loadOrphanedReports();
          })
          .catch(function () {
            statusEl.textContent = 'Failed to assign.';
            statusEl.style.color = 'var(--red)';
          });
      });
    });

    container.querySelectorAll('.report-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var reportId = btn.getAttribute('data-report-id');
        if (!confirm('Delete this report? This cannot be undone.')) return;
        statusEl.textContent = 'Deleting…';
        statusEl.style.color = '';
        fetch('/api/projects/reports/' + encodeURIComponent(reportId), { method: 'DELETE' })
          .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
          .then(function (result) {
            if (!result.ok) {
              statusEl.textContent = (result.data && result.data.error) || 'Failed to delete.';
              statusEl.style.color = 'var(--red)';
              return;
            }
            statusEl.textContent = 'Deleted.';
            setTimeout(function () { statusEl.textContent = ''; }, 2000);
            openReportPanel(btn.closest('[data-report-owner]') ?
              btn.closest('[data-report-owner]').getAttribute('data-report-owner') : null);
            loadOrphanedReports();
          })
          .catch(function () {
            statusEl.textContent = 'Failed.';
            statusEl.style.color = 'var(--red)';
          });
      });
    });
  }

  function openReportPanel(username) {
    var section = document.getElementById('reportAccessSection');
    var titleEl = document.getElementById('reportAccessUsername');
    var listEl = document.getElementById('reportAccessList');
    var statusEl = document.getElementById('reportAccessStatus');
    if (!section) return;
    titleEl.textContent = username;
    statusEl.textContent = '';
    listEl.innerHTML = '<div style="color:var(--text-dim);font-size:12px;">Loading…</div>';
    section.style.display = '';
    section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    fetch('/api/projects/reports')
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('Failed')); })
      .then(function (reports) {
        var userReports = reports.filter(function (r) { return r.createdBy === username; });
        if (!userReports.length) {
          listEl.innerHTML = '<div style="color:var(--text-dim);font-size:12px;">No reports owned by this user.</div>';
          return;
        }
        listEl.setAttribute('data-report-owner', username);
        listEl.innerHTML = userReports.map(function (r) { return buildReportRow(r, false); }).join('');
        attachReportRowHandlers(listEl, statusEl);
      })
      .catch(function (err) {
        listEl.innerHTML = '<div style="color:var(--red);font-size:12px;">' + esc(err.message || 'Failed to load reports.') + '</div>';
      });
  }

  var closeReportAccessBtn = document.getElementById('closeReportAccessBtn');
  if (closeReportAccessBtn) {
    closeReportAccessBtn.addEventListener('click', function () {
      var section = document.getElementById('reportAccessSection');
      if (section) section.style.display = 'none';
    });
  }

  function loadOrphanedReports() {
    var section = document.getElementById('orphanedReportsSection');
    var listEl = document.getElementById('orphanedReportsList');
    var statusEl = document.getElementById('orphanedReportsStatus');
    if (!section || !listEl) return;

    fetch('/api/projects/reports')
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('Failed')); })
      .then(function (reports) {
        var knownUsernames = allUsers.map(function (u) { return u.username; });
        var orphans = reports.filter(function (r) {
          return !r.createdBy || knownUsernames.indexOf(r.createdBy) === -1;
        });
        if (!orphans.length) {
          section.style.display = 'none';
          return;
        }
        section.style.display = '';
        listEl.innerHTML = orphans.map(function (r) { return buildReportRow(r, true); }).join('');
        attachReportRowHandlers(listEl, statusEl);
      })
      .catch(function () {
        section.style.display = 'none';
      });
  }

  // ── User list ─────────────────────────────────────────────────────────────

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
        allUsers = users;
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
              '<button type="button" class="btn btn-small users-reports" data-username="' + escName + '">Reports</button> ' +
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
        tbody.querySelectorAll('.users-reports').forEach(function (btn) {
          btn.addEventListener('click', function () {
            openReportPanel(btn.getAttribute('data-username') || '');
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

        // After loading users, check for orphaned reports
        loadOrphanedReports();
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
