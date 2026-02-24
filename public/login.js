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
