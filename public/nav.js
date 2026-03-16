(function () {
  const btn = document.getElementById('logoutBtn');
  if (btn) btn.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  });

  // Inject hamburger button for mobile nav
  var appHeader = document.querySelector('.app-header');
  var headerNav = document.querySelector('.header-nav');
  var headerLeft = document.querySelector('.header-left');
  if (appHeader && headerNav && headerLeft) {
    var hamburger = document.createElement('button');
    hamburger.className = 'nav-hamburger';
    hamburger.setAttribute('aria-label', 'Toggle navigation');
    hamburger.setAttribute('aria-expanded', 'false');
    hamburger.textContent = '\u2630'; // ☰
    appHeader.insertBefore(hamburger, headerNav);

    function closeHamburgerNav() {
      headerNav.classList.remove('nav-open');
      hamburger.setAttribute('aria-expanded', 'false');
      hamburger.textContent = '\u2630';
    }

    hamburger.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = headerNav.classList.toggle('nav-open');
      hamburger.setAttribute('aria-expanded', String(isOpen));
      hamburger.textContent = isOpen ? '\u2715' : '\u2630'; // ✕ or ☰
    });

    // Close when a nav anchor link is clicked
    headerNav.addEventListener('click', function (e) {
      if (e.target.closest('a.nav-link')) {
        closeHamburgerNav();
      }
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest('.app-header')) {
        closeHamburgerNav();
      }
    });
  }

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

  // Hide admin-only nav items for non-admin users
  fetch('/api/me')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (d && d.role === 'admin') return; // admins see everything
      // Hide SYSTEM dropdown and EDITOR link
      document.querySelectorAll('.header-nav .nav-dropdown').forEach(function (el) {
        el.style.display = 'none';
      });
      document.querySelectorAll('.header-nav a.nav-link[href="/editor"]').forEach(function (el) {
        el.style.display = 'none';
      });
    })
    .catch(function () {});
})();
