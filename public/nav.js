(function () {
  const PATH = window.location.pathname || '/';

  function isActive(href) {
    return PATH === href;
  }

  function navLink(href, label) {
    const cls = 'nav-link' + (isActive(href) ? ' active' : '');
    return `<a href="${href}" class="${cls}">${label}</a>`;
  }

  function buildHeader(appName, isAdmin) {
    const systemMenu = isAdmin ? `
      <div class="nav-dropdown">
        <span class="nav-link nav-dropdown-toggle${PATH.startsWith('/config') || PATH.startsWith('/personality') || PATH.startsWith('/heartbeat') || PATH.startsWith('/agents') || PATH.startsWith('/pipelines') || PATH.startsWith('/autoagent') || PATH.startsWith('/users') ? ' has-active' : ''}">SYSTEM</span>
        <div class="nav-dropdown-menu">
          ${navLink('/config', 'CONFIG')}
          ${navLink('/personality', 'PERSONALITY')}
          ${navLink('/heartbeat', 'HEARTBEAT')}
          ${navLink('/agents', 'AGENTS')}
          ${navLink('/pipelines', 'PIPELINES')}
          ${navLink('/autoagent', 'AUTOAGENT')}
          ${navLink('/users', 'USERS')}
        </div>
      </div>` : '';
    const editorLink = isAdmin ? navLink('/editor', 'EDITOR') : '';

    return `
      <header class="app-header">
        <div class="header-left">
          <a href="/dashboard" class="logo">${appName}</a>
        </div>
        <nav class="header-nav">
          ${navLink('/dashboard', 'DASHBOARD')}
          ${navLink('/app', 'CHAT')}
          ${navLink('/projects', 'PROJECTS')}
          ${navLink('/skills', 'SKILLS')}
          ${navLink('/rag', 'KNOWLEDGE')}
          ${systemMenu}
          ${editorLink}
          ${navLink('/my-data', 'MY DATA')}
          ${navLink('/profile', 'ACCOUNT')}
          <button type="button" id="logoutBtn" class="btn btn-small">LOGOUT</button>
        </nav>
      </header>
    `;
  }

  function wireInteractions() {
    const btn = document.getElementById('logoutBtn');
    if (btn) btn.addEventListener('click', async () => {
      await fetch('/api/logout', { method: 'POST' });
      window.location.href = '/login';
    });

    const appHeader = document.querySelector('.app-header');
    const headerNav = document.querySelector('.header-nav');
    if (!appHeader || !headerNav) return;

    const hamburger = document.createElement('button');
    hamburger.className = 'nav-hamburger';
    hamburger.setAttribute('aria-label', 'Toggle navigation');
    hamburger.setAttribute('aria-expanded', 'false');
    hamburger.textContent = '\u2630';
    appHeader.insertBefore(hamburger, headerNav);

    function closeHamburgerNav() {
      headerNav.classList.remove('nav-open');
      hamburger.setAttribute('aria-expanded', 'false');
      hamburger.textContent = '\u2630';
    }

    hamburger.addEventListener('click', function (e) {
      e.stopPropagation();
      const isOpen = headerNav.classList.toggle('nav-open');
      hamburger.setAttribute('aria-expanded', String(isOpen));
      hamburger.textContent = isOpen ? '\u2715' : '\u2630';
    });

    headerNav.addEventListener('click', function (e) {
      if (e.target.closest('a.nav-link')) closeHamburgerNav();
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest('.app-header')) closeHamburgerNav();
    });

    document.querySelectorAll('.nav-dropdown-toggle').forEach(function (toggle) {
      toggle.addEventListener('click', function (e) {
        e.stopPropagation();
        toggle.closest('.nav-dropdown').classList.toggle('open');
      });
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.nav-dropdown')) {
        document.querySelectorAll('.nav-dropdown.open').forEach(function (d) { d.classList.remove('open'); });
      }
    });
  }

  Promise.all([
    fetch('/api/me').then(r => (r.ok ? r.json() : null)).catch(() => null),
    fetch('/api/app-name').then(r => (r.ok ? r.json() : null)).catch(() => null)
  ]).then(([me, app]) => {
    const appName = (app && app.appName && String(app.appName).trim()) || 'SHADOW_AI';
    const isAdmin = !!(me && me.role === 'admin');
    const existing = document.querySelector('.app-header');
    if (existing) existing.outerHTML = buildHeader(appName, isAdmin);
    else document.body.insertAdjacentHTML('afterbegin', buildHeader(appName, isAdmin));

    if (document.title && document.title.indexOf('ShadowAI') !== -1) {
      document.title = document.title.replace(/ShadowAI/g, appName.replace(/_/g, ' '));
    }
    wireInteractions();
  });
})();
