(function () {
  const PATH = window.location.pathname || '/';

  function isActive(href) {
    return PATH === href || (href !== '/' && PATH.startsWith(href + '/'));
  }

  /** Small inline SVG icons (Open WebUI–style, neutral) */
  function icon(name) {
    const common = ' xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';
    const svg = (path) => `<svg class="app-nav-icon-svg" viewBox="0 0 24 24"${common}>${path}</svg>`;
    const icons = {
      home: svg('<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>'),
      layout: svg('<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>'),
      message: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
      folder: svg('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'),
      zap: svg('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),
      book: svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'),
      database: svg('<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>'),
      user: svg('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
      settings: svg('<circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>'),
      sliders: svg('<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>'),
      cpu: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="15" x2="23" y2="15"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="15" x2="4" y2="15"/>'),
      logOut: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>')
    };
    return icons[name] || icons.home;
  }

  function navItem(href, label, icn) {
    const active = isActive(href);
    const cls = 'app-nav-item' + (active ? ' active' : '');
    const Tag = active ? 'span' : 'a';
    const inner = `${icon(icn)}<span class="app-nav-label">${label}</span>`;
    if (active) return `<span class="${cls}" aria-current="page">${inner}</span>`;
    return `<a href="${href}" class="${cls}">${inner}</a>`;
  }

  function systemPathActive() {
    return ['/config', '/personality', '/heartbeat', '/agents', '/pipelines', '/autoagent', '/users', '/editor'].some(p => PATH === p || PATH.startsWith(p + '/'));
  }

  function buildSidebar(appName, isAdmin) {
    const sysOpen = systemPathActive();
    const systemBlock = isAdmin ? `
      <div class="app-nav-section">
        <div class="app-nav-section-label">Administration</div>
        <details class="app-nav-details" id="appSystemNavDetails" ${sysOpen ? 'open' : ''}>
          <summary class="app-nav-details-summary">
            ${icon('settings')}
            <span class="app-nav-label">System</span>
            <span class="app-nav-chevron" aria-hidden="true"></span>
          </summary>
          <div class="app-nav-sub">
            ${navItem('/config', 'Config', 'sliders')}
            ${navItem('/personality', 'Personality', 'user')}
            ${navItem('/heartbeat', 'Heartbeat', 'cpu')}
            ${navItem('/agents', 'Agents', 'cpu')}
            ${navItem('/pipelines', 'Pipelines', 'layout')}
            ${navItem('/autoagent', 'AutoAgent', 'zap')}
            ${navItem('/users', 'Users', 'user')}
            ${navItem('/editor', 'Editor', 'layout')}
          </div>
        </details>
      </div>` : '';

    return `
      <div class="app-sidebar-brand">
        <a href="/dashboard" class="app-sidebar-logo">${appName.replace(/_/g, ' ')}</a>
      </div>
      <div class="app-sidebar-scroll">
        <nav class="app-sidebar-nav" aria-label="Main">
          ${navItem('/dashboard', 'Dashboard', 'home')}
          ${navItem('/command-center', 'Command Center', 'layout')}
          ${navItem('/app', 'Chat', 'message')}
          ${navItem('/projects', 'Projects', 'folder')}
          ${navItem('/skills', 'Skills', 'zap')}
          ${navItem('/rag', 'Knowledge', 'book')}
          ${navItem('/my-data', 'My Data', 'database')}
        </nav>
        ${systemBlock}
      </div>
      <div class="app-sidebar-footer">
        ${navItem('/profile', 'Account', 'user')}
        <button type="button" class="app-nav-item app-nav-logout" id="logoutBtn">
          ${icon('logOut')}
          <span class="app-nav-label">Logout</span>
        </button>
      </div>
    `;
  }

  function pageTitleFromDocument() {
    const t = document.title || '';
    const m = t.match(/[—\-]\s*(.+)$/);
    return (m && m[1] ? m[1].trim() : t.replace(/^ShadowAI\s*[—\-]?\s*/i, '').trim()) || 'Shadow';
  }

  function mountOpenWebUILayout(appName, isAdmin) {
    const header = document.querySelector('.app-header');
    if (!header) return false;

    let main = document.querySelector('main');
    if (!main) {
      const toWrap = [];
      let n = header.nextElementSibling;
      while (n && n.tagName !== 'SCRIPT') {
        const next = n.nextElementSibling;
        toWrap.push(n);
        n = next;
      }
      if (!toWrap.length) return false;
      main = document.createElement('main');
      main.className = 'app-fallback-main';
      toWrap.forEach((el) => main.appendChild(el));
    }

    document.body.classList.add('has-app-shell');

    const extras = [];
    const agentSelect = document.getElementById('agentSelect');
    const clearBtn = document.getElementById('clearChatBtn');
    const exportBtn = document.getElementById('exportChatBtn');
    if (agentSelect) extras.push(agentSelect);
    if (clearBtn) extras.push(clearBtn);
    if (exportBtn) extras.push(exportBtn);

    const shell = document.createElement('div');
    shell.className = 'app-shell';

    const sidebar = document.createElement('aside');
    sidebar.className = 'app-sidebar';
    sidebar.setAttribute('aria-label', 'Application');
    sidebar.innerHTML = buildSidebar(appName, isAdmin);

    const wrap = document.createElement('div');
    wrap.className = 'app-main-wrap';

    const topbar = document.createElement('header');
    topbar.className = 'app-topbar';
    topbar.innerHTML = `
      <button type="button" class="app-sidebar-toggle" id="appSidebarToggle" aria-label="Toggle sidebar" aria-expanded="true">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
      <h1 class="app-topbar-title">${pageTitleFromDocument()}</h1>
      <div class="app-topbar-actions" id="appTopbarActions"></div>
    `;

    const actions = topbar.querySelector('#appTopbarActions');
    extras.forEach((el) => actions.appendChild(el));

    header.remove();

    shell.appendChild(sidebar);
    shell.appendChild(wrap);
    wrap.appendChild(topbar);
    wrap.appendChild(main);

    document.body.insertBefore(shell, document.body.firstChild);
    return true;
  }

  function wireSidebarToggle() {
    const toggle = document.getElementById('appSidebarToggle');
    const shell = document.querySelector('.app-shell');
    if (!toggle || !shell) return;

    const mq = window.matchMedia('(max-width: 900px)');
    function sync() {
      if (mq.matches) {
        shell.classList.remove('sidebar-collapsed');
        shell.classList.remove('sidebar-overlay-open');
        toggle.setAttribute('aria-expanded', 'false');
      } else {
        shell.classList.remove('sidebar-overlay-open');
        toggle.setAttribute('aria-expanded', 'true');
      }
    }

    toggle.addEventListener('click', () => {
      if (mq.matches) {
        shell.classList.toggle('sidebar-overlay-open');
        toggle.setAttribute('aria-expanded', String(shell.classList.contains('sidebar-overlay-open')));
      } else {
        shell.classList.toggle('sidebar-collapsed');
        const collapsed = shell.classList.contains('sidebar-collapsed');
        toggle.setAttribute('aria-expanded', String(!collapsed));
      }
    });

    document.addEventListener('click', (e) => {
      if (!mq.matches) return;
      if (!shell.classList.contains('sidebar-overlay-open')) return;
      if (e.target.closest('.app-sidebar') || e.target.closest('#appSidebarToggle')) return;
      shell.classList.remove('sidebar-overlay-open');
      toggle.setAttribute('aria-expanded', 'false');
    });

    mq.addEventListener('change', sync);
    sync();
  }

  function wireDetailsCloseOnNavigate() {
    document.querySelectorAll('.app-sidebar a.app-nav-item').forEach((a) => {
      a.addEventListener('click', () => {
        document.querySelector('.app-shell')?.classList.remove('sidebar-overlay-open');
      });
    });
  }

  /** When the sidebar is collapsed to the icon rail, position the System submenu with fixed so it is not clipped by .app-sidebar-scroll */
  function wireSystemFlyoutPosition() {
    const shell = document.querySelector('.app-shell');
    const details = document.getElementById('appSystemNavDetails');
    if (!shell || !details) return;

    const mqDesktop = window.matchMedia('(min-width: 901px)');

    function apply() {
      const sub = details.querySelector('.app-nav-sub');
      if (!sub) return;
      const useFixed = mqDesktop.matches && shell.classList.contains('sidebar-collapsed') && details.open;
      if (!useFixed) {
        sub.style.removeProperty('position');
        sub.style.removeProperty('left');
        sub.style.removeProperty('top');
        sub.style.removeProperty('z-index');
        return;
      }
      const sum = details.querySelector('.app-nav-details-summary');
      const r = sum && sum.getBoundingClientRect();
      if (!r) return;
      sub.style.position = 'fixed';
      sub.style.left = 'calc(var(--ow-sidebar-w-collapsed) + 8px)';
      sub.style.top = `${Math.round(r.top)}px`;
      sub.style.zIndex = '400';
    }

    details.addEventListener('toggle', () => requestAnimationFrame(apply));
    window.addEventListener('resize', apply);
    window.addEventListener('scroll', apply, true);
    document.getElementById('appSidebarToggle')?.addEventListener('click', () => {
      requestAnimationFrame(() => requestAnimationFrame(apply));
    });
    mqDesktop.addEventListener('change', apply);
    requestAnimationFrame(apply);
  }

  function wireLogout() {
    const btn = document.getElementById('logoutBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      await fetch('/api/logout', { method: 'POST' });
      window.location.href = '/login';
    });
  }

  Promise.all([
    fetch('/api/me').then(r => (r.ok ? r.json() : null)).catch(() => null),
    fetch('/api/app-name').then(r => (r.ok ? r.json() : null)).catch(() => null)
  ]).then(([me, app]) => {
    const appName = (app && app.appName && String(app.appName).trim()) || 'SHADOW_AI';
    const isAdmin = !!(me && me.role === 'admin');

    if (document.title && document.title.indexOf('ShadowAI') !== -1) {
      document.title = document.title.replace(/ShadowAI/g, appName.replace(/_/g, ' '));
    }

    const mounted = mountOpenWebUILayout(appName, isAdmin);
    if (!mounted) return;

    wireLogout();
    wireSidebarToggle();
    wireDetailsCloseOnNavigate();
    wireSystemFlyoutPosition();
  });
})();
