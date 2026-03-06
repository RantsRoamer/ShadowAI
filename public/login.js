document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('error');
  errEl.style.display = 'none';
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      window.location.href = '/app';
      return;
    }
    errEl.textContent = data.error || 'Authentication failed';
    errEl.style.display = 'block';
  } catch (e) {
    errEl.textContent = 'Network error';
    errEl.style.display = 'block';
  }
});

// Show configured app name on login page
fetch('/api/app-name')
  .then(function (r) { return r.ok ? r.json() : null; })
  .then(function (d) {
    if (!d || !d.appName) return;
    const name = String(d.appName).trim();
    if (!name) return;
    const el = document.getElementById('loginAppName');
    if (el) el.textContent = name;
    document.title = name.replace(/_/g, ' ') + ' — Login';
  })
  .catch(function () {});
