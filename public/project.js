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
  const projectNameStatus = document.getElementById('projectNameStatus');
  const chatTab = document.getElementById('chatTab');
  const memoryTab = document.getElementById('memoryTab');
  const chatPanel = document.getElementById('chatPanel');
  const memoryPanel = document.getElementById('memoryPanel');
  const projectMemory = document.getElementById('projectMemory');
  const saveMemoryBtn = document.getElementById('saveMemoryBtn');
  const memoryStatus = document.getElementById('memoryStatus');
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
        showStatus(projectNameStatus, 'Name saved.', 2000);
      })
      .catch(() => showStatus(projectNameStatus, 'Failed to save name.', 3000));
  });

  chatTab.addEventListener('click', () => {
    chatTab.classList.add('active');
    chatTab.setAttribute('aria-selected', 'true');
    memoryTab.classList.remove('active');
    memoryTab.setAttribute('aria-selected', 'false');
    chatPanel.classList.remove('hidden');
    memoryPanel.classList.add('hidden');
  });

  memoryTab.addEventListener('click', () => {
    memoryTab.classList.add('active');
    memoryTab.setAttribute('aria-selected', 'true');
    chatTab.classList.remove('active');
    chatTab.setAttribute('aria-selected', 'false');
    memoryPanel.classList.remove('hidden');
    chatPanel.classList.add('hidden');
    loadMemory();
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

  function addImportProcessingIndicator(label) {
    removeImportProcessingIndicator();
    const div = document.createElement('div');
    div.className = 'typing-indicator';
    div.id = 'project-import-typing';
    div.innerHTML = '<div class="typing-meta">Import</div><div class="typing-content"><span class="typing-spinner"></span><span class="typing-text">' + escapeHtml(label || 'Adding to memory…') + '</span><span class="typing-dots"></span></div>';
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function updateImportProcessingText(text) {
    const el = document.querySelector('#project-import-typing .typing-text');
    if (el) el.textContent = text || 'Adding to memory…';
  }

  function removeImportProcessingIndicator() {
    const el = document.getElementById('project-import-typing');
    if (el) el.remove();
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
          projectId: projectId,
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
    if (!confirm('Clear this project’s chat history? Current project memory will be saved first, then only the conversation is cleared.')) return;
    fetch('/api/projects/' + encodeURIComponent(projectId) + '/memory')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Could not load memory')))
      .then(data =>
        fetch('/api/projects/' + encodeURIComponent(projectId) + '/memory', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: data.content || '' })
        })
      )
      .then(r => {
        if (!r.ok) throw new Error('Save memory failed');
        return fetch('/api/chat/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: channelOwner })
        });
      })
      .then(r => {
        if (!r.ok) throw new Error('Clear chat failed');
        history = [];
        currentChatId = null;
        messagesEl.innerHTML = '';
        loadMemory();
      })
      .catch(e => alert(e.message || 'Something went wrong.'));
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
      const toProcess = files.filter(f => getImportType(f));
      const skipped = files.filter(f => !getImportType(f));
      skipped.forEach(file => {
        history.push({ role: 'assistant', content: 'Skipped **' + escapeHtml(file.name) + '**: unsupported type. Use PDF, image, or text.' });
        addMessage('assistant', 'Skipped **' + file.name + '**: unsupported type. Use PDF, image, or text.');
      });
      if (toProcess.length === 0) {
        saveChatHistory();
        return;
      }
      for (let i = 0; i < toProcess.length; i++) {
        const file = toProcess[i];
        const label = toProcess.length > 1
          ? 'Adding to memory (' + (i + 1) + ' of ' + toProcess.length + '): ' + (file.name || 'file')
          : 'Processing ' + (file.name || 'file') + '…';
        addImportProcessingIndicator(label);
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
      removeImportProcessingIndicator();
      loadMemory();
      saveChatHistory();
    });
  }

  loadProject();
  loadMemory();
  loadChatHistory();
})();
