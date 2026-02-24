(function () {
  const messagesEl = document.getElementById('messages');
  const userInput = document.getElementById('userInput');
  const sendBtn = document.getElementById('sendBtn');
  const stopBtn = document.getElementById('stopBtn');
  const agentSelect = document.getElementById('agentSelect');
  const logoutBtn = document.getElementById('logoutBtn');
  const chatListEl = document.getElementById('chatList');
  const newChatBtn = document.getElementById('newChatBtn');
  const sidebarSearchEl = document.getElementById('sidebarSearch');
  const messageSearchEl = document.getElementById('messageSearch');
  const customInstructionsEl = document.getElementById('customInstructions');
  const customInstructionsToggle = document.getElementById('customInstructionsToggle');
  const customInstructionsPanel = document.getElementById('customInstructionsPanel');
  const customInstructionsEnabled = document.getElementById('customInstructionsEnabled');

  let history = [];
  let currentChatId = null;
  let chatListData = [];
  let abortController = null;
  let customInstructionsSaveTimeout = null;

  async function loadChats() {
    try {
      const res = await fetch('/api/chats');
      if (!res.ok) return;
      const data = await res.json();
      const chats = data.chats || [];
      chatListData = chats;
      currentChatId = data.currentChatId || (chats[0] && chats[0].id) || null;
      renderChatList(chats);
      return currentChatId;
    } catch (_) {
      return null;
    }
  }

  function filterChatListBySearch() {
    const q = (sidebarSearchEl.value || '').trim().toLowerCase();
    chatListEl.querySelectorAll('li').forEach(li => {
      const title = (li.dataset.title || '').toLowerCase();
      li.style.display = !q || title.includes(q) ? '' : 'none';
    });
  }

  function renderChatList(chats) {
    chatListEl.innerHTML = '';
    chats.forEach(c => {
      const li = document.createElement('li');
      li.dataset.chatId = c.id;
      li.dataset.title = c.title || 'New chat';
      li.classList.toggle('active', c.id === currentChatId);
      const title = (c.title || 'New chat').trim() || 'New chat';
      li.innerHTML = '<span class="chat-title">' + escapeHtml(title) + '</span><button type="button" class="chat-edit" title="Rename">✎</button><button type="button" class="chat-delete" title="Delete chat">×</button>';
      li.querySelector('.chat-title').addEventListener('click', () => switchChat(c.id));
      li.querySelector('.chat-edit').addEventListener('click', (e) => { e.stopPropagation(); startRenameChat(li, c.id, title); });
      li.querySelector('.chat-delete').addEventListener('click', (e) => { e.stopPropagation(); deleteChat(c.id); });
      chatListEl.appendChild(li);
    });
    filterChatListBySearch();
  }

  function startRenameChat(li, chatId, currentTitle) {
    const span = li.querySelector('.chat-title');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'chat-title-edit';
    input.value = currentTitle;
    input.setAttribute('aria-label', 'Chat title');
    span.replaceWith(input);
    input.focus();
    input.select();
    function save() {
      const newTitle = input.value.trim().slice(0, 120) || 'New chat';
      const span = document.createElement('span');
      span.className = 'chat-title';
      span.textContent = newTitle;
      span.addEventListener('click', () => switchChat(chatId));
      input.replaceWith(span);
      li.dataset.title = newTitle;
      fetch('/api/chats/' + encodeURIComponent(chatId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle })
      }).then(() => loadChats()).catch(() => {});
    }
    input.addEventListener('blur', save);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
  }

  function switchChat(chatId) {
    currentChatId = chatId;
    document.querySelectorAll('.chat-list li').forEach(li => li.classList.toggle('active', li.dataset.chatId === chatId));
    loadChatHistory(chatId);
  }

  function saveCustomInstructionsDebounced() {
    if (customInstructionsSaveTimeout) clearTimeout(customInstructionsSaveTimeout);
    customInstructionsSaveTimeout = setTimeout(() => {
      customInstructionsSaveTimeout = null;
      saveCustomInstructionsImmediate();
    }, 500);
  }

  function saveCustomInstructionsImmediate() {
    if (!currentChatId) return;
    const value = (customInstructionsEl.value || '').trim();
    fetch('/api/chats/' + encodeURIComponent(currentChatId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customInstructions: value })
    }).catch(() => {});
  }

  async function deleteChat(chatId) {
    try {
      const res = await fetch('/api/chats/' + encodeURIComponent(chatId), { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      currentChatId = data.currentChatId || null;
      await loadChats();
      if (currentChatId) loadChatHistory(currentChatId);
      else { history = []; messagesEl.innerHTML = ''; }
    } catch (_) {}
  }

  async function createNewChat() {
    try {
      const res = await fetch('/api/chats', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Create failed');
      currentChatId = data.id;
      customInstructionsEl.value = '';
      await loadChats();
      document.querySelectorAll('.chat-list li').forEach(li => li.classList.toggle('active', li.dataset.chatId === data.id));
      history = [];
      messagesEl.innerHTML = '';
    } catch (_) {}
  }

  async function loadChatHistory(chatId) {
    try {
      const url = chatId ? '/api/chat/history?chatId=' + encodeURIComponent(chatId) : '/api/chat/history';
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      const list = data.messages || [];
      history = list.slice();
      customInstructionsEl.value = data.customInstructions || '';
      if ((data.customInstructions || '').trim()) {
        customInstructionsPanel.hidden = false;
        customInstructionsToggle.setAttribute('aria-expanded', 'true');
        customInstructionsToggle.closest('.custom-instructions-wrap')?.setAttribute('data-expanded', 'true');
      } else {
        customInstructionsPanel.hidden = true;
        customInstructionsToggle.setAttribute('aria-expanded', 'false');
        customInstructionsToggle.closest('.custom-instructions-wrap')?.setAttribute('data-expanded', 'false');
      }
      messagesEl.innerHTML = '';
      list.forEach(msg => {
        const isError = msg.role === 'assistant' && msg.content && msg.content.startsWith('Error');
        const div = addMessage(msg.role, msg.content || '', isError);
        if (msg.role === 'assistant' && msg.content) addCreateSkillButton(div, msg.content);
      });
      ensureRegenerateButton();
      applyMessageSearch();
    } catch (_) {}
  }

  function saveChatHistory() {
    fetch('/api/chat/history', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history, chatId: currentChatId })
    }).catch(() => {});
  }

  async function clearChat() {
    try {
      await fetch('/api/chat/reset', { method: 'POST' });
    } catch (_) {}
    history = [];
    messagesEl.innerHTML = '';
  }

  async function loadConfig() {
    const res = await fetch('/api/config');
    if (!res.ok) return;
    const cfg = await res.json();
    agentSelect.innerHTML = '<option value="">Main Brain</option>';
    (cfg.ollama?.agents || []).filter(a => a.enabled).forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.name || a.id;
      agentSelect.appendChild(opt);
    });
  }

  function addMessage(role, content, isError = false) {
    const div = document.createElement('div');
    div.className = 'msg ' + (role === 'user' ? 'user' : isError ? 'error' : 'assistant');
    div.dataset.raw = content;
    const meta = role === 'user' ? 'You' : (isError ? 'Error' : 'ShadowAI');
    const actions = '<div class="msg-actions"><button type="button" class="msg-copy" title="Copy">Copy</button></div>';
    div.innerHTML = '<div class="meta">' + escapeHtml(meta) + '</div><div class="msg-body">' + formatContent(content) + '</div>' + actions;
    const copyBtn = div.querySelector('.msg-copy');
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(content || '').then(() => { copyBtn.textContent = 'Copied!'; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500); }).catch(() => {});
    });
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function ensureRegenerateButton() {
    messagesEl.querySelectorAll('.msg-regenerate').forEach(b => b.remove());
    const last = messagesEl.querySelector('.msg.assistant:not(.error):last-of-type');
    if (!last) return;
    const actions = last.querySelector('.msg-actions');
    if (!actions) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'msg-regenerate';
    btn.title = 'Try again';
    btn.textContent = 'Regenerate';
    btn.addEventListener('click', regenerateLast);
    actions.appendChild(btn);
  }

  function regenerateLast() {
    if (history.length === 0) return;
    const last = history[history.length - 1];
    if (last.role !== 'assistant') return;
    history = history.slice(0, -1);
    const lastMsgEl = messagesEl.querySelector('.msg.assistant:last-of-type');
    if (lastMsgEl) lastMsgEl.remove();
    ensureRegenerateButton();
    sendMessageOnly();
  }

  function applyMessageSearch() {
    const q = (messageSearchEl.value || '').trim();
    const re = q ? new RegExp(escapeRegex(q), 'gi') : null;
    messagesEl.querySelectorAll('.msg').forEach(div => {
      const raw = div.dataset.raw || '';
      const body = div.querySelector('.msg-body');
      if (!body) return;
      if (!q) {
        div.classList.remove('search-hidden', 'highlight-search');
        body.innerHTML = formatContent(raw);
        return;
      }
      const match = raw.toLowerCase().includes(q.toLowerCase());
      div.classList.toggle('search-hidden', !match);
      div.classList.toggle('highlight-search', match);
      if (match) {
        const escaped = escapeHtml(raw);
        const highlighted = escaped.replace(re, '<mark>$&</mark>');
        body.innerHTML = highlighted.replace(/\n/g, '<br>');
      }
    });
  }

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function escapeHtml(s) {
    const el = document.createElement('div');
    el.textContent = s;
    return el.innerHTML;
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
    return escapeHtml(text)
      .replace(/\n/g, '<br>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/```([\s\S]*?)```/g, '<pre>$1</pre>');
  }

  const TOOL_LABELS = {
    web_search:     'Searching the web',
    fetch_url:      'Fetching page',
    append_memory:  'Saving to memory',
    send_email:     'Sending email'
  };

  function updateTypingStatus(toolName) {
    const el = document.querySelector('#typing .typing-text');
    if (!el) return;
    el.textContent = TOOL_LABELS[toolName] || `Running ${toolName}`;
  }

  function addTyping() {
    const div = document.createElement('div');
    div.className = 'typing-indicator';
    div.id = 'typing';
    div.innerHTML = '<div class="typing-meta">ShadowAI</div><div class="typing-content"><span class="typing-spinner"></span><span class="typing-text">Thinking</span><span class="typing-dots"></span></div>';
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function setProcessing(processing) {
    sendBtn.disabled = processing;
    sendBtn.style.display = processing ? 'none' : '';
    stopBtn.style.display = processing ? '' : 'none';
    userInput.disabled = processing;
    userInput.placeholder = processing ? 'Waiting for response…' : 'Tell me something ....';
  }

  async function sendMessageOnly() {
    const agentId = agentSelect.value || undefined;
    const customInstructions = customInstructionsEnabled.checked ? (customInstructionsEl.value || '').trim() : '';
    setProcessing(true);
    const typingEl = addTyping();
    abortController = new AbortController();
    let full = '';

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, agentId, stream: true, chatId: currentChatId, customInstructions }),
        signal: abortController.signal
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        typingEl.remove();
        setProcessing(false);
        abortController = null;
        throw new Error(err.error || res.statusText);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let msgDiv = null;
      let contentEl = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.toolCall) {
                updateTypingStatus(data.toolCall);
              }
              if (data.content) {
                if (!msgDiv) {
                  typingEl.remove();
                  msgDiv = addMessage('assistant', '');
                  msgDiv.dataset.raw = '';
                  contentEl = msgDiv.querySelector('.msg-body');
                }
                full += data.content;
                msgDiv.dataset.raw = full;
                contentEl.innerHTML = formatContent(full);
                messagesEl.scrollTop = messagesEl.scrollHeight;
              }
              if (data.error) {
                if (!msgDiv) { typingEl.remove(); msgDiv = addMessage('assistant', '', true); contentEl = msgDiv.querySelector('.msg-body'); }
                contentEl.innerHTML = (contentEl.innerHTML || '') + '<br><span class="error">' + escapeHtml(data.error) + '</span>';
              }
              if (data.done) {
                if (data.chatId) currentChatId = data.chatId;
                break;
              }
            } catch (_) {}
          }
        }
      }
      if (typingEl.parentNode) typingEl.remove();
      if (!msgDiv) {
        msgDiv = addMessage('assistant', full || '(No response)');
        contentEl = msgDiv.querySelector('.msg-body');
        if (full) contentEl.innerHTML = formatContent(full);
        msgDiv.dataset.raw = full || '';
      }
      history.push({ role: 'assistant', content: full });
      addCreateSkillButton(msgDiv, full);
      ensureRegenerateButton();
      applyMessageSearch();
      if (currentChatId) {
        saveChatHistory();
        loadChats();
      }
      setProcessing(false);
      abortController = null;
    } catch (e) {
      if (e.name === 'AbortError') {
        if (typingEl.parentNode) typingEl.remove();
        setProcessing(false);
        abortController = null;
        return;
      }
      removeTyping();
      setProcessing(false);
      addMessage('assistant', e.message || 'Request failed', true);
      abortController = null;
    }
  }

  function exportChat() {
    const lines = [];
    history.forEach(m => {
      const head = m.role === 'user' ? '## You' : '## ShadowAI';
      lines.push(head);
      lines.push((m.content || '').trim());
      lines.push('');
    });
    const md = lines.join('\n').trim();
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (currentChatId ? 'chat-' + currentChatId.slice(0, 8) : 'chat') + '.md';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function removeTyping() {
    const el = document.getElementById('typing');
    if (el) el.remove();
    setProcessing(false);
  }

  async function runCommand(line) {
    const trim = line.trim();
    if (trim.startsWith('/run ')) {
      const rest = trim.slice(5).trim();
      const space = rest.indexOf(' ');
      const lang = space > 0 ? rest.slice(0, space) : 'js';
      const code = space > 0 ? rest.slice(space + 1) : '';
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: lang, code })
      });
      const out = await res.json();
      const text = 'stdout:\n' + (out.stdout || '') + (out.stderr ? '\nstderr:\n' + out.stderr : '') + '\nexit: ' + out.exitCode;
      addMessage('assistant', text, !!out.stderr);
      history.push({ role: 'assistant', content: text });
      saveChatHistory();
      onRunCommandDone();
      return true;
    }
    if (trim.startsWith('/read ')) {
      const path = trim.slice(6).trim();
      const res = await fetch('/api/file?path=' + encodeURIComponent(path));
      const data = await res.json();
      if (!res.ok) { addMessage('assistant', data.error || 'Error', true); onRunCommandDone(); return true; }
      addMessage('assistant', data.content || '(empty)');
      history.push({ role: 'assistant', content: data.content || '(empty)' });
      saveChatHistory();
      onRunCommandDone();
      return true;
    }
    if (trim.startsWith('/write ')) {
      const rest = trim.slice(7).trim();
      const firstLine = rest.indexOf('\n');
      const path = firstLine >= 0 ? rest.slice(0, firstLine).trim() : rest;
      const content = firstLine >= 0 ? rest.slice(firstLine + 1) : '';
      const res = await fetch('/api/file', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content })
      });
      const data = await res.json();
      addMessage('assistant', res.ok ? 'Written: ' + path : (data.error || 'Error'), !res.ok);
      history.push({ role: 'assistant', content: res.ok ? 'Written: ' + path : (data.error || 'Error') });
      saveChatHistory();
      onRunCommandDone();
      return true;
    }
    if (trim.startsWith('/list')) {
      const path = (trim.slice(5).trim() || '.').trim();
      const res = await fetch('/api/files?path=' + encodeURIComponent(path));
      const data = await res.json();
      if (!res.ok) { addMessage('assistant', data.error || 'Error', true); onRunCommandDone(); return true; }
      const names = (data.files || []).map(f => (f.isDir ? '[DIR] ' : '') + f.name).join('\n');
      addMessage('assistant', names || '(empty)');
      history.push({ role: 'assistant', content: names || '(empty)' });
      saveChatHistory();
      onRunCommandDone();
      return true;
    }
    if (trim.startsWith('/skill ')) {
      const rest = trim.slice(7).trim();
      const space = rest.indexOf(' ');
      const id = space > 0 ? rest.slice(0, space) : rest;
      let args = {};
      if (space > 0) {
        try { args = JSON.parse(rest.slice(space + 1).trim()) || {}; } catch (_) {}
      }
      const res = await fetch('/api/skills/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, args })
      });
      const data = await res.json();
      if (!res.ok) { addMessage('assistant', data.error || 'Error', true); onRunCommandDone(); return true; }
      const out = typeof data.result === 'object' ? JSON.stringify(data.result, null, 2) : String(data.result);
      addMessage('assistant', out || '(no output)');
      history.push({ role: 'assistant', content: out || '(no output)' });
      saveChatHistory();
      onRunCommandDone();
      return true;
    }
    if (trim === '/reset' || trim.startsWith('/reset ')) {
      clearChat();
      addMessage('assistant', 'Conversation cleared. Starting from scratch.');
      return true;
    }
    return false;
  }

  function onRunCommandDone() {
    ensureRegenerateButton();
    applyMessageSearch();
  }

  function parseSkillBlock(text) {
    const idMatch = text.match(/SKILL_ID:\s*([a-zA-Z0-9_-]+)/);
    const codeMatch = text.match(/SKILL_CODE:\s*([\s\S]+?)END_SKILL_CODE/);
    if (!idMatch || !codeMatch) return null;
    let name = idMatch[1];
    let description = '';
    const nameLine = text.match(/SKILL_NAME:\s*(.+)/);
    if (nameLine) name = nameLine[1].trim();
    const descLine = text.match(/SKILL_DESCRIPTION:\s*(.+?)(?=\nSKILL_CODE:|$)/s);
    if (descLine) description = descLine[1].trim();
    return {
      id: idMatch[1].trim(),
      name: name,
      description: description,
      code: codeMatch[1].trim()
    };
  }

  function addCreateSkillButton(msgDiv, rawContent) {
    const skill = parseSkillBlock(rawContent);
    if (!skill) return;
    const wrap = document.createElement('div');
    wrap.className = 'msg-create-skill';
    wrap.innerHTML = '<button type="button" class="btn btn-small create-skill-btn">Create skill</button> <span class="create-skill-status"></span>';
    msgDiv.appendChild(wrap);
    wrap.querySelector('.create-skill-btn').addEventListener('click', async () => {
      const statusEl = wrap.querySelector('.create-skill-status');
      statusEl.textContent = 'Creating...';
      try {
        const res = await fetch('/api/skills/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(skill)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
        statusEl.textContent = 'Created: ' + skill.id + '. Enable it on the Skills page.';
        wrap.querySelector('.create-skill-btn').disabled = true;
      } catch (e) {
        statusEl.textContent = e.message;
        statusEl.style.color = 'var(--red)';
      }
    });
  }

  async function send() {
    const text = userInput.value.trim();
    if (!text) return;
    userInput.value = '';
    addMessage('user', text);
    history.push({ role: 'user', content: text });

    if (await runCommand(text)) return;

    sendMessageOnly();
  }

  sendBtn.addEventListener('click', send);
  stopBtn.addEventListener('click', () => { if (abortController) abortController.abort(); });
  userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  customInstructionsEl.addEventListener('input', saveCustomInstructionsDebounced);
  customInstructionsEl.addEventListener('blur', () => {
    if (customInstructionsSaveTimeout) { clearTimeout(customInstructionsSaveTimeout); customInstructionsSaveTimeout = null; }
    saveCustomInstructionsImmediate();
  });
  customInstructionsToggle.addEventListener('click', () => {
    const wrap = customInstructionsToggle.closest('.custom-instructions-wrap');
    const expanded = customInstructionsPanel.hidden;
    customInstructionsPanel.hidden = !expanded;
    customInstructionsToggle.setAttribute('aria-expanded', String(expanded));
    if (wrap) wrap.setAttribute('data-expanded', String(expanded));
  });
  sidebarSearchEl.addEventListener('input', filterChatListBySearch);
  messageSearchEl.addEventListener('input', applyMessageSearch);
  document.getElementById('exportChatBtn').addEventListener('click', exportChat);
  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  });
  document.getElementById('clearChatBtn').addEventListener('click', () => {
    clearChat();
    addMessage('assistant', 'Conversation cleared. Starting from scratch.');
  });
  newChatBtn.addEventListener('click', createNewChat);
  loadConfig();
  loadChats().then(() => loadChatHistory(currentChatId));
})();
