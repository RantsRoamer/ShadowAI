(async function () {
  // Load current user info
  try {
    const r = await fetch('/api/me');
    if (!r.ok) { window.location.href = '/login'; return; }
    const me = await r.json();
    document.getElementById('infoUsername').textContent = me.username;
    document.getElementById('infoRole').textContent = me.role;
  } catch (_) {
    window.location.href = '/login';
    return;
  }

  const statusEl = document.getElementById('pwStatus');

  function setStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.className = isError ? 'error' : 'ok';
  }

  function clearStatus() {
    statusEl.textContent = '';
    statusEl.className = '';
  }

  document.getElementById('changePasswordBtn').addEventListener('click', async () => {
    clearStatus();
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword     = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (!currentPassword || !newPassword || !confirmPassword) {
      setStatus('All fields are required.', true);
      return;
    }
    if (newPassword !== confirmPassword) {
      setStatus('New passwords do not match.', true);
      return;
    }
    if (newPassword.length < 8) {
      setStatus('New password must be at least 8 characters.', true);
      return;
    }

    try {
      const r = await fetch('/api/users/me/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await r.json();
      if (!r.ok) {
        setStatus(data.error || 'Failed to update password.', true);
        return;
      }
      setStatus('Password updated successfully.', false);
      document.getElementById('currentPassword').value = '';
      document.getElementById('newPassword').value = '';
      document.getElementById('confirmPassword').value = '';
    } catch (_) {
      setStatus('Network error. Please try again.', true);
    }
  });
})();
