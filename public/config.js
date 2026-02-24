(function () {
  const hostEl = document.getElementById('host');
  const portEl = document.getElementById('port');
  const usernameEl = document.getElementById('username');
  const passwordEl = document.getElementById('password');
  const mainUrlEl = document.getElementById('mainUrl');
  const mainModelEl = document.getElementById('mainModel');
  const mainModelList = document.getElementById('mainModelList');
  const fetchMainModelsBtn = document.getElementById('fetchMainModels');
  const saveBtn = document.getElementById('saveBtn');
  const statusEl = document.getElementById('status');

  document.querySelectorAll('.config-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      document.querySelectorAll('.config-tab').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
      document.querySelectorAll('.config-panel').forEach(p => { p.classList.remove('active'); p.hidden = true; });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      const panel = document.getElementById('panel-' + tab);
      if (panel) { panel.classList.add('active'); panel.hidden = false; }
    });
  });

  function setStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.style.color = isError ? 'var(--red)' : 'var(--text-dim)';
  }

  async function loadConfig() {
    const res = await fetch('/api/config');
    if (!res.ok) return;
    const c = await res.json();
    hostEl.value = c.server?.host ?? '0.0.0.0';
    portEl.value = c.server?.port ?? 9090;
    usernameEl.value = c.auth?.username ?? 'admin';
    mainUrlEl.value = c.ollama?.mainUrl ?? 'http://localhost:11434';
    mainModelEl.value = c.ollama?.mainModel ?? 'llama3.2';
    document.getElementById('ollamaTemperature').value = c.ollama?.temperature ?? 0.7;
    document.getElementById('ollamaNumPredict').value = c.ollama?.num_predict ?? 2048;
    document.getElementById('searxngUrl').value = c.searxng?.url ?? '';
    document.getElementById('searxngEnabled').checked = c.searxng?.enabled === true;
    const e = c.email || {};
    document.getElementById('emailHost').value = e.host ?? '';
    document.getElementById('emailPort').value = e.port ?? 25;
    document.getElementById('emailSecure').checked = e.secure === true;
    document.getElementById('emailUseAuth').checked = !!(e.auth && e.auth.user);
    document.getElementById('emailUser').value = e.auth?.user ?? '';
    document.getElementById('emailPass').value = '';
    document.getElementById('emailFrom').value = e.from ?? '';
    document.getElementById('emailDefaultTo').value = e.defaultTo ?? '';
    document.getElementById('emailEnabled').checked = e.enabled === true;
    toggleEmailAuth();
    const ch = c.channels || {};
    document.getElementById('channelsApiKey').value = ch.apiKey ?? '';
    document.getElementById('telegramEnabled').checked = ch.telegram?.enabled === true;
    document.getElementById('telegramBotToken').value = ch.telegram?.botToken ?? '';
    document.getElementById('discordEnabled').checked = ch.discord?.enabled === true;
    document.getElementById('discordBotToken').value = ch.discord?.botToken ?? '';
    document.getElementById('discordAllowedUserIds').value = Array.isArray(ch.discord?.allowedUserIds) ? ch.discord.allowedUserIds.join(', ') : (ch.discord?.allowedUserIds ?? '');
  }
  function toggleEmailAuth() {
    const useAuth = document.getElementById('emailUseAuth').checked;
    document.getElementById('emailAuthGroup').style.display = useAuth ? 'block' : 'none';
    document.getElementById('emailPassGroup').style.display = useAuth ? 'block' : 'none';
  }

  function escapeAttr(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function getEmailFromDom() {
    const useAuth = document.getElementById('emailUseAuth').checked;
    const auth = useAuth ? {
      user: document.getElementById('emailUser').value.trim(),
      ...(document.getElementById('emailPass').value ? { pass: document.getElementById('emailPass').value } : {})
    } : undefined;
    return {
      host: document.getElementById('emailHost').value.trim(),
      port: parseInt(document.getElementById('emailPort').value, 10) || 25,
      secure: document.getElementById('emailSecure').checked,
      auth: auth,
      from: document.getElementById('emailFrom').value.trim(),
      defaultTo: document.getElementById('emailDefaultTo').value.trim(),
      enabled: document.getElementById('emailEnabled').checked
    };
  }

  function getChannelsFromDom() {
    return {
      apiKey: document.getElementById('channelsApiKey').value.trim(),
      telegram: {
        enabled: document.getElementById('telegramEnabled').checked,
        botToken: document.getElementById('telegramBotToken').value.trim()
      },
      discord: {
        enabled: document.getElementById('discordEnabled').checked,
        botToken: document.getElementById('discordBotToken').value.trim(),
        allowedUserIds: document.getElementById('discordAllowedUserIds').value.split(',').map(s => s.trim()).filter(Boolean)
      }
    };
  }

  document.getElementById('emailUseAuth').addEventListener('change', toggleEmailAuth);
  document.getElementById('testEmailBtn').addEventListener('click', async () => {
    const statusEl = document.getElementById('testEmailStatus');
    statusEl.textContent = 'Sending...';
    statusEl.style.color = '';
    try {
      await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: getEmailFromDom() })
      });
      const res = await fetch('/api/notifications/test-email', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      statusEl.textContent = 'Sent. Check your inbox.';
    } catch (e) {
      statusEl.textContent = e.message;
      statusEl.style.color = 'var(--red)';
    }
  });

  fetchMainModelsBtn.addEventListener('click', async () => {
    const url = mainUrlEl.value.trim() || 'http://localhost:11434';
    setStatus('Fetching...');
    try {
      const res = await fetch('/api/ollama/models?url=' + encodeURIComponent(url));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      mainModelList.style.display = 'block';
      mainModelList.innerHTML = '<option value="">Select or type below</option>' +
        (data.models || []).map(m => '<option value="' + escapeAttr(m) + '">' + escapeAttr(m) + '</option>').join('');
      mainModelList.addEventListener('change', () => {
        if (mainModelList.value) mainModelEl.value = mainModelList.value;
      });
      setStatus('Loaded ' + (data.models?.length || 0) + ' models');
    } catch (e) {
      setStatus(e.message, true);
    }
  });

  saveBtn.addEventListener('click', async () => {
    const password = passwordEl.value;
    const auth = {
      username: usernameEl.value.trim() || 'admin'
    };
    if (password) auth.passwordHash = password;

    const config = {
      server: {
        host: hostEl.value.trim() || '0.0.0.0',
        port: Math.max(1, Math.min(65535, parseInt(portEl.value, 10) || 9090))
      },
      auth: auth,
      ollama: {
        mainUrl: mainUrlEl.value.trim() || 'http://localhost:11434',
        mainModel: mainModelEl.value.trim() || 'llama3.2',
        temperature: parseFloat(document.getElementById('ollamaTemperature').value) || 0.7,
        num_predict: parseInt(document.getElementById('ollamaNumPredict').value, 10) || 2048
      },
      searxng: {
        url: document.getElementById('searxngUrl').value.trim() || '',
        enabled: document.getElementById('searxngEnabled').checked
      },
      email: getEmailFromDom(),
      channels: getChannelsFromDom()
    };

    setStatus('Saving...');
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      if (data.config) {
        const c = data.config;
        hostEl.value = c.server?.host ?? '0.0.0.0';
        portEl.value = c.server?.port ?? 9090;
        usernameEl.value = c.auth?.username ?? 'admin';
        mainUrlEl.value = c.ollama?.mainUrl ?? 'http://localhost:11434';
        mainModelEl.value = c.ollama?.mainModel ?? 'llama3.2';
        document.getElementById('ollamaTemperature').value = c.ollama?.temperature ?? 0.7;
        document.getElementById('ollamaNumPredict').value = c.ollama?.num_predict ?? 2048;
        document.getElementById('searxngUrl').value = c.searxng?.url ?? '';
        document.getElementById('searxngEnabled').checked = c.searxng?.enabled === true;
        const e = c.email || {};
        document.getElementById('emailHost').value = e.host ?? '';
        document.getElementById('emailPort').value = e.port ?? 25;
        document.getElementById('emailSecure').checked = e.secure === true;
        document.getElementById('emailUseAuth').checked = !!(e.auth && e.auth.user);
        document.getElementById('emailUser').value = e.auth?.user ?? '';
        document.getElementById('emailFrom').value = e.from ?? '';
        document.getElementById('emailDefaultTo').value = e.defaultTo ?? '';
        document.getElementById('emailEnabled').checked = e.enabled === true;
        toggleEmailAuth();
        const ch = c.channels || {};
        document.getElementById('channelsApiKey').value = ch.apiKey ?? '';
        document.getElementById('telegramEnabled').checked = ch.telegram?.enabled === true;
        document.getElementById('telegramBotToken').value = ch.telegram?.botToken ?? '';
        document.getElementById('discordEnabled').checked = ch.discord?.enabled === true;
        document.getElementById('discordBotToken').value = ch.discord?.botToken ?? '';
      }
      setStatus('Saved. Restart server to apply port/host changes.');
    } catch (e) {
      setStatus(e.message, true);
    }
  });

  loadConfig();
})();
