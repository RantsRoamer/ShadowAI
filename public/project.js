(function () {
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get('id');
  if (!projectId) {
    window.location.href = '/projects';
    return;
  }

  const projectHeaderName = document.getElementById('projectHeaderName');
  const projectNameInput = document.getElementById('projectNameInput');
  const saveProjectNameBtn = document.getElementById('saveProjectNameBtn');
  const projectMemory = document.getElementById('projectMemory');
  const saveMemoryBtn = document.getElementById('saveMemoryBtn');
  const memoryStatus = document.getElementById('memoryStatus');
  const importText = document.getElementById('importText');
  const importTextBtn = document.getElementById('importTextBtn');
  const importFileInput = document.getElementById('importFileInput');
  const importFileBtn = document.getElementById('importFileBtn');
  const importStatus = document.getElementById('importStatus');
  const messagesEl = document.getElementById('messages');
  const userInput = document.getElementById('userInput');
  const sendBtn = document.getElementById('sendBtn');
  const messageSearch = document.getElementById('messageSearch');
  const clearProjectChatBtn = document.getElementById('clearProjectChatBtn');

  const channelOwner = 'project_' + projectId;
  let history = [];
  let currentChatId = null;
  let projectData = null;

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function formatContent(text) {
    if (!text) return '';
    if (typeof marked !== 'undefined') {
      marked.setOptions({ gfm: true, breaks: true });
      const raw = marked.parse(text, { async: false });
      if (typeof DOMPurify !== 'undefined') {
        return DOMPurify.sanitize(raw, { ALLOWED_TAGS: ['p','br','strong','em','code','pre','ul','ol','li','table','thead','tbody','tr','th','td','h1','h2','h3','h4','h5','h6','blockquote','a','span','div'], ALLOWED_ATTR: ['href','class'] });
      }
      return raw;
    }
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  function addMessage(role, content) {
    const div = document.createElement('div');
    div.className = 'msg ' + (role === 'user' ? 'user' : 'assistant');
    const meta = role === 'user' ? 'You' : 'ShadowAI';
    div.innerHTML = '<div class="meta">' + escapeHtml(meta) + '</div><div class="msg-body">' + formatContent(content || '') + '</div>';
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function showStatus(el, text, clearAfter) {
    if (!el) return;
    el.textContent = text;
    if (clearAfter) setTimeout(() => { el.textContent = ''; }, clearAfter);
  }

  function loadProject() {
    fetch('/api/projects/' + encodeURIComponent(projectId))
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Not found')))
      .then(p => {
        projectData = p;
        projectHeaderName.textContent = p.name || 'Project';
        projectNameInput.value = p.name || '';
      })
      .catch(() => { projectHeaderName.textContent = 'Project not found'; });
  }

  function loadMemory() {
    fetch('/api/projects/' + encodeURIComponent(projectId) + '/memory')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => { projectMemory.value = data.content || ''; })
      .catch(() => {});
  }

  function loadChatHistory() {
    let url = '/api/chat/history';
    if (currentChatId) url += '?chatId=' + encodeURIComponent(currentChatId);
    url += (url.includes('?') ? '&' : '?') + 'username=' + encodeURIComponent(channelOwner);
    fetch(url)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        const list = data.messages || [];
        history = list.slice();
        messagesEl.innerHTML = '';
        list.forEach(msg => addMessage(msg.role, msg.content || ''));
      })
      .catch(() => { history = []; messagesEl.innerHTML = ''; });
  }

  function saveChatHistory() {
    fetch('/api/chat/history', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history, chatId: currentChatId, username: channelOwner })
    }).catch(() => {});
  }

  saveProjectNameBtn.addEventListener('click', () => {
    const name = (projectNameInput.value || '').trim() || 'Untitled project';
    fetch('/api/projects/' + encodeURIComponent(projectId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(p => {
        projectData = p;
        projectHeaderName.textContent = p.name || 'Project';
        showStatus(memoryStatus, 'Name saved.', 2000);
      })
      .catch(() => showStatus(memoryStatus, 'Failed to save name.', 3000));
  });

  saveMemoryBtn.addEventListener('click', () => {
    fetch('/api/projects/' + encodeURIComponent(projectId) + '/memory', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: projectMemory.value || '' })
    })
      .then(r => {
        if (r.ok) showStatus(memoryStatus, 'Memory saved.', 2000);
        else throw new Error();
      })
      .catch(() => showStatus(memoryStatus, 'Failed to save.', 3000));
  });

  importTextBtn.addEventListener('click', () => {
    const text = (importText.value || '').trim();
    if (!text) { showStatus(importStatus, 'Paste some text first.', 3000); return; }
    fetch('/api/projects/' + encodeURIComponent(projectId) + '/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text', text })
    })
      .then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(new Error(j.error))))
      .then(() => {
        showStatus(importStatus, 'Text imported. Reload memory to see it.', 3000);
        loadMemory();
        importText.value = '';
      })
      .catch(e => showStatus(importStatus, e.message || 'Import failed.', 4000));
  });

  importFileBtn.addEventListener('click', () => {
    const file = importFileInput.files && importFileInput.files[0];
    if (!file) { showStatus(importStatus, 'Choose a PDF or image file.', 3000); return; }
    const type = file.type.startsWith('image/') ? 'image' : (file.type === 'application/pdf' ? 'pdf' : null);
    if (!type) { showStatus(importStatus, 'Use a PDF or image file.', 3000); return; }
    showStatus(importStatus, 'Importing…', 0);
    const reader = new FileReader();
    reader.onload = () => {
      let content = reader.result;
      if (typeof content === 'string' && content.startsWith('data:')) {
        const base64 = content.replace(/^data:[^;]+;base64,/, '');
        content = base64;
      }
      fetch('/api/projects/' + encodeURIComponent(projectId) + '/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, content, filename: file.name || (type === 'pdf' ? 'document.pdf' : 'image') })
      })
        .then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(new Error(j.error))))
        .then(() => {
          showStatus(importStatus, type === 'pdf' ? 'PDF text imported.' : 'Image described and imported.', 3000);
          loadMemory();
          importFileInput.value = '';
        })
        .catch(e => showStatus(importStatus, e.message || 'Import failed.', 4000));
    };
    reader.readAsDataURL(file);
  });

  function setProcessing(processing) {
    sendBtn.disabled = processing;
    userInput.disabled = processing;
    userInput.placeholder = processing ? 'Waiting for response…' : 'Ask about this project…';
  }

  function addTypingIndicator() {
    const div = document.createElement('div');
    div.className = 'typing-indicator';
    div.id = 'project-typing';
    div.innerHTML = '<div class="typing-meta">ShadowAI</div><div class="typing-content"><span class="typing-spinner"></span><span class="typing-text">Thinking</span><span class="typing-dots"></span></div>';
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function updateTypingText(text) {
    const el = document.querySelector('#project-typing .typing-text');
    if (el) el.textContent = text;
  }

  sendBtn.addEventListener('click', sendMessage);
  userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  async function sendMessage() {
    const text = (userInput.value || '').trim();
    if (!text) return;
    userInput.value = '';
    history.push({ role: 'user', content: text });
    addMessage('user', text);
    setProcessing(true);
    const typingEl = addTypingIndicator();
    let full = '';
    let msgDiv = null;
    let contentEl = null;
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history,
          stream: true,
          channelChatOwner: channelOwner,
          chatId: currentChatId
        })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || res.statusText);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamDone = false;
      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.toolCall) {
              if (data.toolCall === 'append_project_memory') updateTypingText('Saving to project memory…');
              else if (data.toolCall === 'web_search') updateTypingText('Searching the web…');
              else if (data.toolCall === 'fetch_url') updateTypingText('Fetching page…');
              else updateTypingText('Working…');
            }
            if (data.content) {
              if (!msgDiv) {
                typingEl.remove();
                msgDiv = addMessage('assistant', '');
                contentEl = msgDiv.querySelector('.msg-body');
              }
              full += data.content;
              if (contentEl) contentEl.innerHTML = formatContent(full);
              messagesEl.scrollTop = messagesEl.scrollHeight;
            }
            if (data.error) {
              if (!msgDiv) { typingEl.remove(); msgDiv = addMessage('assistant', ''); contentEl = msgDiv.querySelector('.msg-body'); }
              if (contentEl) contentEl.innerHTML = (contentEl.innerHTML || '') + '<br><span class="error">' + escapeHtml(data.error) + '</span>';
            }
            if (data.done) {
              if (data.chatId) currentChatId = data.chatId;
              streamDone = true;
              break;
            }
          } catch (_) {}
        }
      }
      if (typingEl.parentNode) typingEl.remove();
      if (!msgDiv) {
        msgDiv = addMessage('assistant', full || '(No response)');
        contentEl = msgDiv.querySelector('.msg-body');
        if (full) contentEl.innerHTML = formatContent(full);
      }
      history.push({ role: 'assistant', content: full });
      saveChatHistory();
    } catch (e) {
      if (typingEl.parentNode) typingEl.remove();
      history.push({ role: 'assistant', content: 'Error: ' + e.message });
      addMessage('assistant', 'Error: ' + e.message);
      saveChatHistory();
    } finally {
      setProcessing(false);
    }
  }

  clearProjectChatBtn.addEventListener('click', () => {
    if (!confirm('Clear this project’s chat history?')) return;
    fetch('/api/chat/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: channelOwner })
    })
      .then(() => {
        history = [];
        currentChatId = null;
        messagesEl.innerHTML = '';
      })
      .catch(() => {});
  });

  messageSearch.addEventListener('input', () => {
    const q = (messageSearch.value || '').trim().toLowerCase();
    messagesEl.querySelectorAll('.msg').forEach(div => {
      const raw = (div.querySelector('.msg-body') && div.querySelector('.msg-body').innerText) || '';
      div.style.display = !q || raw.toLowerCase().includes(q) ? '' : 'none';
    });
  });

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result === 'string' && result.startsWith('data:')) {
          resolve(result.replace(/^data:[^;]+;base64,/, ''));
        } else resolve('');
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  function getImportType(file) {
    const t = (file.type || '').toLowerCase();
    const name = (file.name || '').toLowerCase();
    if (t === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
    if (t.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp)$/.test(name)) return 'image';
    if (t.startsWith('text/') || name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.json') || name.endsWith('.csv')) return 'text';
    return null;
  }

  async function handleDroppedFile(file) {
    const type = getImportType(file);
    if (!type) return { ok: false, error: 'Unsupported file type. Use PDF, image, or text.' };
    const filename = file.name || (type === 'pdf' ? 'document.pdf' : type === 'image' ? 'image' : 'document.txt');
    let body;
    if (type === 'text') {
      const text = await readFileAsText(file);
      if (!text.trim()) return { ok: false, error: 'File is empty.' };
      body = { type: 'text', text, filename, summarize: true };
    } else {
      const content = await readFileAsBase64(file);
      body = { type, content, filename, summarize: true };
    }
    const res = await fetch('/api/projects/' + encodeURIComponent(projectId) + '/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || res.statusText };
    return { ok: true, summary: data.summary, filename };
  }

  const chatDropZone = document.getElementById('chatDropZone');
  if (chatDropZone) {
    chatDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      chatDropZone.classList.add('drag-over');
    });
    chatDropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!chatDropZone.contains(e.relatedTarget)) chatDropZone.classList.remove('drag-over');
    });
    chatDropZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      chatDropZone.classList.remove('drag-over');
      const files = e.dataTransfer && e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
      if (files.length === 0) return;
      for (const file of files) {
        const type = getImportType(file);
        if (!type) {
          history.push({ role: 'assistant', content: 'Skipped **' + escapeHtml(file.name) + '**: unsupported type. Use PDF, image, or text.' });
          addMessage('assistant', 'Skipped **' + file.name + '**: unsupported type. Use PDF, image, or text.');
          continue;
        }
        try {
          const result = await handleDroppedFile(file);
          if (result.ok) {
            const summary = result.summary ? result.summary : 'Added to project memory.';
            const msg = 'Added **' + result.filename + '** to project memory.\n\n' + summary;
            history.push({ role: 'assistant', content: msg });
            addMessage('assistant', msg);
          } else {
            history.push({ role: 'assistant', content: 'Failed to add **' + file.name + '**: ' + (result.error || 'Unknown error') });
            addMessage('assistant', 'Failed to add **' + file.name + '**: ' + (result.error || 'Unknown error'));
          }
        } catch (err) {
          history.push({ role: 'assistant', content: 'Error adding **' + file.name + '**: ' + err.message });
          addMessage('assistant', 'Error adding **' + file.name + '**: ' + err.message);
        }
      }
      saveChatHistory();
    });
  }

  loadProject();
  loadMemory();
  loadChatHistory();
})();
