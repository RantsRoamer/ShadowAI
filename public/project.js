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
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history,
          stream: false,
          channelChatOwner: channelOwner,
          chatId: currentChatId
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      const content = (data.message && data.message.content) ? data.message.content : (data.content || '(No response)');
      history.push({ role: 'assistant', content });
      addMessage('assistant', content);
      if (data.chatId) currentChatId = data.chatId;
      saveChatHistory();
    } catch (e) {
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

  loadProject();
  loadMemory();
  loadChatHistory();
})();
