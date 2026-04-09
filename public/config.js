(function () {
  const hostEl = document.getElementById('host');
  const portEl = document.getElementById('port');
  const timezoneEl = document.getElementById('timezone');
  const usernameEl = document.getElementById('username');
  const passwordEl = document.getElementById('password');
  const mainUrlEl = document.getElementById('mainUrl');
  const mainModelEl = document.getElementById('mainModel');
  const mainModelList = document.getElementById('mainModelList');
  const fetchMainModelsBtn = document.getElementById('fetchMainModels');
  const saveBtn = document.getElementById('configSaveBtn');
  const statusEl = document.getElementById('status');
  const avatarImg = document.getElementById('aiAvatarPreview');
  const avatarFileInput = document.getElementById('aiAvatarFile');
  const avatarRemoveBtn = document.getElementById('aiAvatarRemove');
  const avatarStatusEl = document.getElementById('avatarStatus');
  const ragEmbeddingModelEl = document.getElementById('ragEmbeddingModel');
  const ragChunkSizeEl = document.getElementById('ragChunkSize');
  const ragChunkOverlapEl = document.getElementById('ragChunkOverlap');
  const ragCollectionNameEl = document.getElementById('ragCollectionName');
  const ragTopKEl = document.getElementById('ragTopK');
  const repairProjectMemoryBtn = document.getElementById('repairProjectMemoryBtn');
  const repairProjectMemoryStatusEl = document.getElementById('repairProjectMemoryStatus');
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

  function refreshAvatarPreview() {
    if (!avatarImg) return;
    const url = '/static/ai-avatar?ts=' + Date.now();
    avatarImg.onload = function () {
      avatarImg.style.display = 'block';
    };
    avatarImg.onerror = function () {
      avatarImg.style.display = 'none';
    };
    avatarImg.src = url;
  }

  async function loadConfig() {
    const res = await fetch('/api/config');
    if (!res.ok) return;
    const c = await res.json();
    hostEl.value = c.server?.host ?? '0.0.0.0';
    portEl.value = c.server?.port ?? 9090;
    timezoneEl.value = c.timezone ?? '';
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
    const ui = c.ui || {};
    document.getElementById('appName').value = ui.appName ?? 'SHADOW_AI';
    document.getElementById('showToolCalls').checked = ui.showToolCalls !== false;
    document.getElementById('promptLibrary').checked = ui.promptLibrary !== false;
    const rag = c.rag || {};
    if (ragEmbeddingModelEl) ragEmbeddingModelEl.value = rag.embeddingModel ?? 'nomic-embed-text';
    if (ragChunkSizeEl) ragChunkSizeEl.value = rag.chunkSize ?? 800;
    if (ragChunkOverlapEl) ragChunkOverlapEl.value = rag.chunkOverlap ?? 200;
    if (ragCollectionNameEl) ragCollectionNameEl.value = rag.collectionName ?? 'shadowai';
    if (ragTopKEl) ragTopKEl.value = rag.topK ?? 8;
    refreshAvatarPreview();

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

  function setInlineStatus(el, msg, isError) {
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? 'var(--red)' : 'var(--text-dim)';
  }

  if (repairProjectMemoryBtn) {
    repairProjectMemoryBtn.addEventListener('click', async () => {
      repairProjectMemoryBtn.disabled = true;
      setInlineStatus(repairProjectMemoryStatusEl, 'Repairing project memories...', false);
      try {
        const res = await fetch('/api/system/project-memory/repair', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
        const scanned = Number.isFinite(data.scanned) ? data.scanned : 0;
        const changed = Number.isFinite(data.changed) ? data.changed : 0;
        const skipped = Number.isFinite(data.skipped) ? data.skipped : 0;
        setInlineStatus(
          repairProjectMemoryStatusEl,
          `Done. Scanned ${scanned}, repaired ${changed}, skipped ${skipped}.`,
          false
        );
      } catch (e) {
        setInlineStatus(repairProjectMemoryStatusEl, e.message || 'Repair failed.', true);
      } finally {
        repairProjectMemoryBtn.disabled = false;
      }
    });
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

  function getRagFromDom() {
    return {
      embeddingModel: ragEmbeddingModelEl ? (ragEmbeddingModelEl.value || '').trim() || 'nomic-embed-text' : 'nomic-embed-text',
      chunkSize: ragChunkSizeEl ? (parseInt(ragChunkSizeEl.value, 10) || 800) : 800,
      chunkOverlap: ragChunkOverlapEl ? (parseInt(ragChunkOverlapEl.value, 10) || 200) : 200,
      collectionName: ragCollectionNameEl ? (ragCollectionNameEl.value || '').trim() || 'shadowai' : 'shadowai',
      topK: ragTopKEl ? (parseInt(ragTopKEl.value, 10) || 8) : 8
    };
  }

  if (avatarFileInput) {
    avatarFileInput.addEventListener('change', function () {
      const file = avatarFileInput.files && avatarFileInput.files[0];
      if (!file) return;
      if (!file.type || file.type.indexOf('image/') !== 0) {
        if (avatarStatusEl) {
          avatarStatusEl.textContent = 'Please select an image file.';
          avatarStatusEl.style.color = 'var(--red)';
        }
        return;
      }
      const reader = new FileReader();
      reader.onload = function (e) {
        const dataUrl = e.target.result;
        if (!dataUrl || typeof dataUrl !== 'string') return;
        if (avatarStatusEl) {
          avatarStatusEl.textContent = 'Uploading...';
          avatarStatusEl.style.color = '';
        }
        fetch('/api/ui/avatar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl: dataUrl })
        })
          .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); })
          .then(function (result) {
            if (!avatarStatusEl) return;
            if (result.ok && result.data && result.data.ok) {
              avatarStatusEl.textContent = 'Avatar saved.';
              avatarStatusEl.style.color = '';
              refreshAvatarPreview();
            } else {
              avatarStatusEl.textContent = (result.data && result.data.error) || 'Failed to save avatar.';
              avatarStatusEl.style.color = 'var(--red)';
            }
          })
          .catch(function (err) {
            if (!avatarStatusEl) return;
            avatarStatusEl.textContent = (err && err.message) || 'Failed to save avatar.';
            avatarStatusEl.style.color = 'var(--red)';
          });
      };
      reader.readAsDataURL(file);
    });
  }

  if (avatarRemoveBtn) {
    avatarRemoveBtn.addEventListener('click', function () {
      if (avatarStatusEl) {
        avatarStatusEl.textContent = 'Removing...';
        avatarStatusEl.style.color = '';
      }
      fetch('/api/ui/avatar', { method: 'DELETE' })
        .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); })
        .then(function (result) {
          if (!avatarStatusEl) return;
          if (result.ok && result.data && result.data.ok) {
            avatarStatusEl.textContent = 'Avatar removed.';
            avatarStatusEl.style.color = '';
            if (avatarImg) {
              avatarImg.src = '';
              avatarImg.style.display = 'none';
            }
            if (avatarFileInput) avatarFileInput.value = '';
          } else {
            avatarStatusEl.textContent = (result.data && result.data.error) || 'Failed to remove avatar.';
            avatarStatusEl.style.color = 'var(--red)';
          }
        })
        .catch(function (err) {
          if (!avatarStatusEl) return;
          avatarStatusEl.textContent = (err && err.message) || 'Failed to remove avatar.';
          avatarStatusEl.style.color = 'var(--red)';
        });
    });
  }

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
      timezone: timezoneEl.value.trim() || '',
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
      channels: getChannelsFromDom(),
      ui: {
        appName: (document.getElementById('appName').value || '').trim() || 'SHADOW_AI',
        showToolCalls: document.getElementById('showToolCalls').checked,
        promptLibrary: document.getElementById('promptLibrary').checked
      },
      rag: getRagFromDom()
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
        timezoneEl.value = c.timezone ?? '';
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
        const ui = c.ui || {};
        document.getElementById('appName').value = ui.appName ?? 'SHADOW_AI';
        document.getElementById('showToolCalls').checked = ui.showToolCalls !== false;
        document.getElementById('promptLibrary').checked = ui.promptLibrary !== false;
      }
      setStatus('Saved. Restart server to apply port/host changes.');
    } catch (e) {
      setStatus(e.message, true);
    }
  });

  loadConfig();
})();
