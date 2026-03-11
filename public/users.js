(function () {
  const tbody = document.getElementById('usersTbody');
  const usersError = document.getElementById('usersError');
  const usernameEl = document.getElementById('userUsername');
  const passwordEl = document.getElementById('userPassword');
  const roleEl = document.getElementById('userRole');
  const saveBtn = document.getElementById('userSaveBtn');
  const statusEl = document.getElementById('userStatus');

  function setError(msg) {
    if (!usersError) return;
    usersError.textContent = msg || '';
  }

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.style.color = isError ? 'var(--red)' : 'var(--text-dim)';
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

