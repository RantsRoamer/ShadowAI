(function () {
  const btn = document.getElementById('logoutBtn');
  if (btn) btn.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  });

  // Apply configured app name to header logo and page title
  fetch('/api/app-name')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || !d.appName) return;
      const name = String(d.appName).trim();
      if (!name) return;
      const logo = document.querySelector('.logo');
      if (logo) logo.textContent = name;
      if (document.title && document.title.indexOf('ShadowAI') !== -1) {
        document.title = document.title.replace(/ShadowAI/g, name.replace(/_/g, ' '));
      }
    })
    .catch(function () {});
})();
