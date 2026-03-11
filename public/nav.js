(function () {
  const btn = document.getElementById('logoutBtn');
  if (btn) btn.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  });

  // Dropdown toggle (click for mobile / keyboard)
  document.querySelectorAll('.nav-dropdown-toggle').forEach(function (toggle) {
    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      toggle.closest('.nav-dropdown').classList.toggle('open');
    });
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.nav-dropdown')) {
      document.querySelectorAll('.nav-dropdown.open').forEach(function (d) {
        d.classList.remove('open');
      });
    }
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
