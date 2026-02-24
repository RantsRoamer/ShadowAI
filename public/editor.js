/* -------------------------------------------------------------------------
   editor.js — AI-powered code editor
   ------------------------------------------------------------------------- */
(function () {
  'use strict';

  // ---------- CodeMirror init ----------
  const cm = CodeMirror.fromTextArea(document.getElementById('codeEditor'), {
    lineNumbers: true,
    matchBrackets: true,
    styleActiveLine: true,
    indentUnit: 2,
    tabSize: 2,
    indentWithTabs: false,
    lineWrapping: false
  });

  // ---------- State ----------
  let currentPath = null;   // active tab path
  let savedContent = '';    // saved content for active tab
  let aiLastCode = null;
  let openFiles = [];       // [{path, content, savedContent, dirty}]

  // ---------- DOM refs ----------
  const editorPath    = document.getElementById('editorPath');
  const editorTabs    = document.getElementById('editorTabs');
  const saveBtn       = document.getElementById('saveBtn');
  const sendToChatBtn = document.getElementById('sendToChatBtn');
  const saveStatus    = document.getElementById('saveStatus');
  const fileTreeEl    = document.getElementById('fileTree');
  const agentSelect   = document.getElementById('agentSelect');
  const aiInstruction = document.getElementById('aiInstruction');
  const aiAskBtn      = document.getElementById('aiAskBtn');
  const aiResponse    = document.getElementById('aiResponse');
  const aiActions     = document.getElementById('aiActions');
  const applyBtn      = document.getElementById('applyBtn');

  // ---------- Agents ----------
  async function loadAgents() {
    try {
      const r = await fetch('/api/config');
      if (!r.ok) return;
      const { ollama } = await r.json();
      const agents = (ollama && ollama.agents) ? ollama.agents.filter(a => a.enabled) : [];
      agents.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = a.name || a.id;
        agentSelect.appendChild(opt);
      });
    } catch (_) { /* ignore */ }
  }

  // ---------- File tree ----------
  async function loadTree(dirPath, container) {
    try {
      const r = await fetch('/api/files?path=' + encodeURIComponent(dirPath));
      const data = await r.json();
      if (data.error) {
        container.innerHTML = `<span class="tree-error">${escHtml(data.error)}</span>`;
        return;
      }
      const files = data.files || [];
      if (files.length === 0) {
        container.innerHTML = '<span class="tree-empty">(empty)</span>';
        return;
      }

      const ul = document.createElement('ul');
      ul.className = 'tree-list';

      // Sort: dirs first, then alphabetical
      const sorted = [...files].sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      sorted.forEach(item => {
        const li = document.createElement('li');
        const childPath = (dirPath === '.' || dirPath === '') ? item.name : dirPath + '/' + item.name;

        if (item.isDir) {
          li.className = 'tree-dir';
          const row = document.createElement('div');
          row.className = 'tree-row';
          row.innerHTML =
            `<span class="tree-arrow">▶</span>` +
            `<span class="tree-icon">▸</span>` +
            `<span class="tree-label">${escHtml(item.name)}</span>`;
          li.appendChild(row);

          const children = document.createElement('ul');
          children.className = 'tree-list tree-children hidden';
          li.appendChild(children);

          let loaded = false;
          row.addEventListener('click', async () => {
            const arrow = row.querySelector('.tree-arrow');
            if (children.classList.contains('hidden')) {
              children.classList.remove('hidden');
              arrow.textContent = '▼';
              if (!loaded) {
                loaded = true;
                children.innerHTML = '<span class="tree-loading">Loading…</span>';
                await loadTree(childPath, children);
              }
            } else {
              children.classList.add('hidden');
              arrow.textContent = '▶';
            }
          });

        } else {
          li.className = 'tree-file';
          const row = document.createElement('div');
          row.className = 'tree-row';
          row.innerHTML =
            `<span class="tree-arrow"></span>` +
            `<span class="tree-icon">·</span>` +
            `<span class="tree-label">${escHtml(item.name)}</span>`;
          li.appendChild(row);
          row.addEventListener('click', () => openFile(childPath, li));
        }

        ul.appendChild(li);
      });

      container.innerHTML = '';
      container.appendChild(ul);
    } catch (e) {
      container.innerHTML = `<span class="tree-error">Error: ${escHtml(e.message)}</span>`;
    }
  }

  // ---------- Tab management ----------
  function renderTabs() {
    editorTabs.innerHTML = '';
    openFiles.forEach(f => {
      const tab = document.createElement('div');
      tab.className = 'editor-tab' + (f.path === currentPath ? ' active' : '');
      tab.dataset.path = f.path;
      const name = f.path.split('/').pop();
      tab.innerHTML =
        '<span class="tab-name" title="' + escHtml(f.path) + '">' + escHtml(name) + '</span>' +
        '<span class="tab-dirty"' + (f.dirty ? '' : ' hidden') + '>●</span>' +
        '<button type="button" class="tab-close" title="Close">×</button>';
      tab.querySelector('.tab-name').addEventListener('click', () => switchToTab(f.path));
      tab.querySelector('.tab-close').addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(f.path);
      });
      editorTabs.appendChild(tab);
    });
  }

  function switchToTab(filePath) {
    const f = openFiles.find(x => x.path === filePath);
    if (!f) return;
    // Save current CM value back to old tab
    const prev = openFiles.find(x => x.path === currentPath);
    if (prev) {
      const val = cm.getValue();
      prev.content = val;
      prev.dirty = val !== prev.savedContent;
    }
    currentPath = filePath;
    savedContent = f.savedContent;
    cm.setValue(f.content);
    cm.setOption('mode', modeForPath(filePath));
    cm.clearHistory();
    editorPath.textContent = filePath;
    saveBtn.disabled = false;
    setStatus(f.dirty ? 'warning' : '', f.dirty ? 'Unsaved changes' : '');
    document.querySelectorAll('.tree-file.active').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tree-file').forEach(li => {
      const label = li.querySelector('.tree-label');
      if (label && li.dataset && filePath.endsWith(label.textContent)) li.classList.add('active');
    });
    renderTabs();
  }

  function closeTab(filePath) {
    const f = openFiles.find(x => x.path === filePath);
    if (f && f.dirty) {
      if (!confirm('Close "' + filePath + '" with unsaved changes?')) return;
    }
    openFiles = openFiles.filter(x => x.path !== filePath);
    if (currentPath === filePath) {
      if (openFiles.length > 0) {
        switchToTab(openFiles[openFiles.length - 1].path);
      } else {
        currentPath = null;
        savedContent = '';
        cm.setValue('');
        editorPath.textContent = '(no file open — click a file in the tree)';
        saveBtn.disabled = true;
        setStatus('', '');
      }
    }
    renderTabs();
  }

  // ---------- Open file ----------
  async function openFile(filePath, liEl) {
    // If already open, just switch to it
    const existing = openFiles.find(x => x.path === filePath);
    if (existing) {
      switchToTab(filePath);
      if (liEl) {
        document.querySelectorAll('.tree-file.active').forEach(el => el.classList.remove('active'));
        liEl.classList.add('active');
      }
      return;
    }

    try {
      const r = await fetch('/api/file?path=' + encodeURIComponent(filePath));
      if (!r.ok) {
        const { error } = await r.json().catch(() => ({}));
        setStatus('error', 'Load error: ' + (error || r.statusText));
        return;
      }
      const { content } = await r.json();

      // Save current CM value back to current tab before opening new one
      const prev = openFiles.find(x => x.path === currentPath);
      if (prev) {
        const val = cm.getValue();
        prev.content = val;
        prev.dirty = val !== prev.savedContent;
      }

      openFiles.push({ path: filePath, content, savedContent: content, dirty: false });
      currentPath  = filePath;
      savedContent = content;
      cm.setValue(content);
      cm.setOption('mode', modeForPath(filePath));
      cm.clearHistory();
      editorPath.textContent = filePath;
      saveBtn.disabled = false;
      setStatus('', '');
      renderTabs();

      document.querySelectorAll('.tree-file.active').forEach(el => el.classList.remove('active'));
      if (liEl) liEl.classList.add('active');
    } catch (e) {
      setStatus('error', 'Load error: ' + e.message);
    }
  }

  // ---------- Save ----------
  saveBtn.addEventListener('click', saveFile);

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (!saveBtn.disabled) saveFile();
    }
  });

  async function saveFile() {
    if (!currentPath) return;
    const content = cm.getValue();
    saveBtn.disabled = true;
    setStatus('warning', 'Saving…');
    try {
      const r = await fetch('/api/file', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: currentPath, content })
      });
      if (!r.ok) {
        const { error } = await r.json().catch(() => ({}));
        setStatus('error', 'Save failed: ' + (error || r.statusText));
      } else {
        savedContent = content;
        const f = openFiles.find(x => x.path === currentPath);
        if (f) { f.savedContent = content; f.content = content; f.dirty = false; }
        renderTabs();
        setStatus('ok', 'Saved');
        setTimeout(() => { if (saveStatus.textContent === 'Saved') setStatus('', ''); }, 2500);
      }
    } catch (e) {
      setStatus('error', e.message);
    } finally {
      saveBtn.disabled = false;
    }
  }

  // Track unsaved changes
  cm.on('change', () => {
    if (!currentPath) return;
    const val = cm.getValue();
    const isDirty = val !== savedContent;
    const f = openFiles.find(x => x.path === currentPath);
    if (f && f.dirty !== isDirty) {
      f.dirty = isDirty;
      f.content = val;
      renderTabs();
    }
    if (isDirty) {
      setStatus('warning', 'Unsaved changes');
    } else {
      setStatus('', '');
    }
  });

  // ---------- AI assist ----------
  aiAskBtn.addEventListener('click', askAI);

  aiInstruction.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      askAI();
    }
  });

  async function askAI() {
    const instruction = aiInstruction.value.trim();
    if (!instruction) return;

    aiAskBtn.disabled = true;
    aiActions.hidden = true;
    aiLastCode = null;
    aiResponse.hidden = false;
    aiResponse.innerHTML = '<span class="ai-thinking">Thinking…</span>';

    const content  = cm.getValue();
    const agentId  = agentSelect.value || undefined;

    try {
      const r = await fetch('/api/editor/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: currentPath, content, instruction, agentId })
      });

      if (!r.ok) {
        const { error } = await r.json().catch(() => ({}));
        aiResponse.innerHTML = `<span class="ai-error">${escHtml(error || r.statusText)}</span>`;
        return;
      }

      // Stream SSE
      const reader  = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer   = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let data;
          try { data = JSON.parse(line.slice(6)); } catch (_) { continue; }
          if (data.error) {
            aiResponse.innerHTML = `<span class="ai-error">${escHtml(data.error)}</span>`;
            return;
          }
          if (data.content) {
            fullText += data.content;
            aiResponse.innerHTML = DOMPurify.sanitize(marked.parse(fullText));
          }
          if (data.done) break;
        }
      }

      // Offer "Apply Code" if response contains a fenced code block
      const codeMatch = fullText.match(/```[\w]*\n([\s\S]*?)```/);
      if (codeMatch) {
        aiLastCode = codeMatch[1];
        aiActions.hidden = false;
      }

    } catch (e) {
      aiResponse.innerHTML = `<span class="ai-error">${escHtml(e.message)}</span>`;
    } finally {
      aiAskBtn.disabled = false;
    }
  }

  // ---------- Apply Code ----------
  applyBtn.addEventListener('click', () => {
    if (aiLastCode !== null) {
      cm.setValue(aiLastCode);
      aiActions.hidden = true;
      setStatus('warning', 'Unsaved changes');
      const f = openFiles.find(x => x.path === currentPath);
      if (f) { f.content = aiLastCode; f.dirty = true; renderTabs(); }
    }
  });

  // ---------- Helpers ----------
  function setStatus(cls, text) {
    saveStatus.className = 'save-status' + (cls ? ' ' + cls : '');
    saveStatus.textContent = text;
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function modeForPath(p) {
    const ext = (p || '').split('.').pop().toLowerCase();
    const map = {
      js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'javascript',
      py: 'python',
      css: 'css',
      html: 'htmlmixed', htm: 'htmlmixed',
      md: 'markdown',
      json: { name: 'javascript', json: true }
    };
    return map[ext] || null;
  }

  // ---------- Send to Chat ----------
  sendToChatBtn.addEventListener('click', () => {
    const selected = cm.getSelection();
    const code = selected || cm.getValue();
    const file = currentPath || 'untitled';
    const prompt = '```\n' + code + '\n```\n\nReview this code.';
    sessionStorage.setItem('shadowai_editor_to_chat', JSON.stringify({ prompt, file }));
    window.location.href = '/app';
  });

  // ---------- Init ----------
  loadAgents();
  loadTree('.', fileTreeEl);
})();
