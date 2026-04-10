(function () {
  'use strict';

  const cm = CodeMirror.fromTextArea(document.getElementById('codeEditor'), {
    lineNumbers: true, matchBrackets: true, styleActiveLine: true, indentUnit: 2, tabSize: 2, indentWithTabs: false, lineWrapping: false
  });

  const fileTreeEl = document.getElementById('fileTree');
  const editorTabs = document.getElementById('editorTabs');
  const editorPath = document.getElementById('editorPath');
  const saveBtn = document.getElementById('saveBtn');
  const sendToChatBtn = document.getElementById('sendToChatBtn');
  const downloadCurrentBtn = document.getElementById('downloadCurrentBtn');
  const zipSelectedBtn = document.getElementById('zipSelectedBtn');
  const saveStatus = document.getElementById('saveStatus');
  const agentSelect = document.getElementById('agentSelect');
  const aiInstruction = document.getElementById('aiInstruction');
  const aiAskBtn = document.getElementById('aiAskBtn');
  const aiResponse = document.getElementById('aiResponse');
  const aiActions = document.getElementById('aiActions');
  const applyBtn = document.getElementById('applyBtn');

  let currentPath = null;
  let savedContent = '';
  let aiLastCode = null;
  let openFiles = [];

  function setStatus(cls, text) {
    saveStatus.className = 'save-status' + (cls ? ' ' + cls : '');
    saveStatus.textContent = text;
  }
  function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function modeForPath(p) {
    const ext = (p || '').split('.').pop().toLowerCase();
    const map = { js:'javascript',mjs:'javascript',cjs:'javascript',ts:'javascript',py:'python',css:'css',html:'htmlmixed',htm:'htmlmixed',md:'markdown',json:{name:'javascript',json:true} };
    return map[ext] || null;
  }

  function selectedPaths() {
    return Array.from(fileTreeEl.querySelectorAll('input[data-path]:checked')).map(i => i.getAttribute('data-path'));
  }

  async function loadAgents() {
    try {
      const r = await fetch('/api/config');
      if (!r.ok) return;
      const { ollama } = await r.json();
      (ollama?.agents || []).filter(a => a.enabled).forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.id; opt.textContent = a.name || a.id; agentSelect.appendChild(opt);
      });
    } catch (_) {}
  }

  async function loadTree(dirPath, container) {
    try {
      const r = await fetch('/api/my-data/files?path=' + encodeURIComponent(dirPath));
      const data = await r.json();
      if (data.error) { container.innerHTML = '<span class="tree-error">' + escHtml(data.error) + '</span>'; return; }
      const files = data.files || [];
      if (files.length === 0) { container.innerHTML = '<span class="tree-empty">(empty)</span>'; return; }

      const ul = document.createElement('ul'); ul.className = 'tree-list';
      const sorted = [...files].sort((a,b)=>a.isDir===b.isDir?String(a.name).localeCompare(String(b.name)):a.isDir?-1:1);
      sorted.forEach(item => {
        const li = document.createElement('li');
        const childPath = (dirPath === '.' || dirPath === '') ? item.name : dirPath + '/' + item.name;
        const row = document.createElement('div');
        row.className = 'tree-row';
        const arrow = item.isDir ? '▶' : '';
        const icon = item.isDir ? '▸' : '·';
        row.innerHTML = '<input type="checkbox" data-path="' + escHtml(childPath) + '" title="Select for ZIP" />' +
          '<span class="tree-arrow">' + arrow + '</span><span class="tree-icon">' + icon + '</span><span class="tree-label">' + escHtml(item.name) + '</span>';
        li.appendChild(row);
        if (item.isDir) {
          li.className = 'tree-dir';
          const children = document.createElement('ul');
          children.className = 'tree-list tree-children hidden';
          li.appendChild(children);
          let loaded = false;
          row.addEventListener('click', async (e) => {
            if (e.target.tagName === 'INPUT') return;
            const a = row.querySelector('.tree-arrow');
            if (children.classList.contains('hidden')) {
              children.classList.remove('hidden'); a.textContent = '▼';
              if (!loaded) { loaded = true; children.innerHTML = '<span class="tree-loading">Loading…</span>'; await loadTree(childPath, children); }
            } else { children.classList.add('hidden'); a.textContent = '▶'; }
          });
        } else {
          li.className = 'tree-file';
          row.addEventListener('click', (e) => { if (e.target.tagName === 'INPUT') return; openFile(childPath, li); });
        }
        ul.appendChild(li);
      });
      container.innerHTML = ''; container.appendChild(ul);
    } catch (e) {
      container.innerHTML = '<span class="tree-error">Error: ' + escHtml(e.message) + '</span>';
    }
  }

  function renderTabs() {
    editorTabs.innerHTML = '';
    openFiles.forEach(f => {
      const tab = document.createElement('div');
      tab.className = 'editor-tab' + (f.path === currentPath ? ' active' : '');
      const name = f.path.split('/').pop();
      tab.innerHTML = '<span class="tab-name" title="' + escHtml(f.path) + '">' + escHtml(name) + '</span><span class="tab-dirty"' + (f.dirty ? '' : ' hidden') + '>●</span><button type="button" class="tab-close">×</button>';
      tab.querySelector('.tab-name').addEventListener('click', () => switchToTab(f.path));
      tab.querySelector('.tab-close').addEventListener('click', (e) => { e.stopPropagation(); closeTab(f.path); });
      editorTabs.appendChild(tab);
    });
  }
  function switchToTab(filePath) {
    const f = openFiles.find(x => x.path === filePath); if (!f) return;
    const prev = openFiles.find(x => x.path === currentPath);
    if (prev) { const val = cm.getValue(); prev.content = val; prev.dirty = val !== prev.savedContent; }
    currentPath = filePath; savedContent = f.savedContent; cm.setValue(f.content); cm.setOption('mode', modeForPath(filePath)); cm.clearHistory();
    editorPath.textContent = filePath; saveBtn.disabled = false; downloadCurrentBtn.disabled = false;
    setStatus(f.dirty ? 'warning' : '', f.dirty ? 'Unsaved changes' : '');
    renderTabs();
  }
  function closeTab(filePath) {
    const f = openFiles.find(x => x.path === filePath);
    if (f && f.dirty && !confirm('Close "' + filePath + '" with unsaved changes?')) return;
    openFiles = openFiles.filter(x => x.path !== filePath);
    if (currentPath === filePath) {
      if (openFiles.length) switchToTab(openFiles[openFiles.length - 1].path);
      else { currentPath = null; savedContent = ''; cm.setValue(''); editorPath.textContent = '(no file open — click a file in the tree)'; saveBtn.disabled = true; downloadCurrentBtn.disabled = true; setStatus('', ''); }
    }
    renderTabs();
  }

  async function openFile(filePath, liEl) {
    const existing = openFiles.find(x => x.path === filePath);
    if (existing) { switchToTab(filePath); return; }
    try {
      const r = await fetch('/api/my-data/file?path=' + encodeURIComponent(filePath));
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.statusText);
      const prev = openFiles.find(x => x.path === currentPath);
      if (prev) { const val = cm.getValue(); prev.content = val; prev.dirty = val !== prev.savedContent; }
      openFiles.push({ path: filePath, content: data.content || '', savedContent: data.content || '', dirty: false });
      switchToTab(filePath);
      document.querySelectorAll('.tree-file.active').forEach(el => el.classList.remove('active'));
      if (liEl) liEl.classList.add('active');
    } catch (e) { setStatus('error', 'Load error: ' + e.message); }
  }

  async function saveFile() {
    if (!currentPath) return;
    const content = cm.getValue(); saveBtn.disabled = true; setStatus('warning', 'Saving…');
    try {
      const r = await fetch('/api/my-data/file', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ path: currentPath, content }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || r.statusText);
      savedContent = content;
      const f = openFiles.find(x => x.path === currentPath);
      if (f) { f.savedContent = content; f.content = content; f.dirty = false; }
      renderTabs(); setStatus('ok', 'Saved');
      setTimeout(() => { if (saveStatus.textContent === 'Saved') setStatus('', ''); }, 2000);
    } catch (e) { setStatus('error', e.message); }
    finally { saveBtn.disabled = false; }
  }

  async function requestZip(paths) {
    if (!paths || paths.length === 0) { alert('Select files/folders first.'); return; }
    try {
      const r = await fetch('/api/my-data/download', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ paths }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || r.statusText);
      window.location.href = d.url;
      setStatus('ok', 'ZIP download prepared');
    } catch (e) { setStatus('error', e.message); }
  }

  function externalLinksOpenInNewWindow(html) {
    if (!html) return html;
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    wrap.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href) || /^\/\//.test(href)) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); }
    });
    return wrap.innerHTML;
  }

  async function askAI() {
    const instruction = aiInstruction.value.trim(); if (!instruction) return;
    aiAskBtn.disabled = true; aiActions.hidden = true; aiLastCode = null; aiResponse.hidden = false; aiResponse.innerHTML = '<span class="ai-thinking">Thinking…</span>';
    const content = cm.getValue(); const agentId = agentSelect.value || undefined;
    try {
      const r = await fetch('/api/editor/assist', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ path: currentPath, content, instruction, agentId }) });
      if (!r.ok) { const { error } = await r.json().catch(() => ({})); aiResponse.innerHTML = '<span class="ai-error">' + escHtml(error || r.statusText) + '</span>'; return; }
      const reader = r.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let fullText = '';
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let data; try { data = JSON.parse(line.slice(6)); } catch (_) { continue; }
          if (data.error) { aiResponse.innerHTML = '<span class="ai-error">' + escHtml(data.error) + '</span>'; return; }
          if (data.content) { fullText += data.content; aiResponse.innerHTML = externalLinksOpenInNewWindow(DOMPurify.sanitize(marked.parse(fullText))); }
          if (data.done) break;
        }
      }
      const codeMatch = fullText.match(/```[\w]*\n([\s\S]*?)```/);
      if (codeMatch) { aiLastCode = codeMatch[1]; aiActions.hidden = false; }
    } catch (e) { aiResponse.innerHTML = '<span class="ai-error">' + escHtml(e.message) + '</span>'; }
    finally { aiAskBtn.disabled = false; }
  }

  saveBtn.addEventListener('click', saveFile);
  aiAskBtn.addEventListener('click', askAI);
  applyBtn.addEventListener('click', () => {
    if (aiLastCode == null) return;
    cm.setValue(aiLastCode); aiActions.hidden = true; setStatus('warning', 'Unsaved changes');
    const f = openFiles.find(x => x.path === currentPath); if (f) { f.content = aiLastCode; f.dirty = true; renderTabs(); }
  });
  aiInstruction.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askAI(); } });
  cm.on('change', () => {
    if (!currentPath) return;
    const val = cm.getValue(); const isDirty = val !== savedContent; const f = openFiles.find(x => x.path === currentPath);
    if (f && f.dirty !== isDirty) { f.dirty = isDirty; f.content = val; renderTabs(); }
    setStatus(isDirty ? 'warning' : '', isDirty ? 'Unsaved changes' : '');
  });

  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (!saveBtn.disabled) saveFile(); } });
  sendToChatBtn.addEventListener('click', () => {
    const selected = cm.getSelection(); const code = selected || cm.getValue(); const file = currentPath || 'untitled';
    sessionStorage.setItem('shadowai_editor_to_chat', JSON.stringify({ prompt: '```\n' + code + '\n```\n\nReview this code.', file }));
    window.location.href = '/app';
  });
  downloadCurrentBtn.addEventListener('click', () => { if (currentPath) requestZip([currentPath]); });
  zipSelectedBtn.addEventListener('click', () => requestZip(selectedPaths()));

  loadAgents();
  loadTree('.', fileTreeEl);
})();

