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
  let currentChannelOwner = null;
  let chatListData = [];
  let abortController = null;
  let customInstructionsSaveTimeout = null;
  let uiSettings = { showToolCalls: true, promptLibrary: true };

  async function loadChats() {
    try {
      const res = await fetch('/api/chats');
      if (!res.ok) return;
      const data = await res.json();
      const myChats = data.chats || [];
      const channelChats = data.channelChats || [];
      const unified = myChats.map(c => ({ ...c, channelOwner: null, channelLabel: null }));
      channelChats.forEach(cc => {
        (cc.chats || []).forEach(c => {
          unified.push({ ...c, channelOwner: cc.username, channelLabel: cc.label });
        });
      });
      unified.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      chatListData = unified;
      if (currentChannelOwner == null) {
        currentChatId = data.currentChatId || (myChats[0] && myChats[0].id) || null;
      }
      renderChatList(unified);
      return currentChatId;
    } catch (_) {
      return null;
    }
  }

  function filterChatListBySearch() {
    const q = (sidebarSearchEl.value || '').trim().toLowerCase();
    chatListEl.querySelectorAll('li').forEach(li => {
      const title = (li.dataset.title || '').toLowerCase();
      const label = (li.dataset.channelLabel || '').toLowerCase();
      const match = !q || title.includes(q) || label.includes(q);
      li.style.display = match ? '' : 'none';
    });
  }

  function renderChatList(chats) {
    chatListEl.innerHTML = '';
    chats.forEach(c => {
      const li = document.createElement('li');
      li.dataset.chatId = c.id;
      li.dataset.channelOwner = c.channelOwner || '';
      li.dataset.channelLabel = c.channelLabel || '';
      const title = (c.title || 'New chat').trim() || 'New chat';
      li.dataset.title = (c.channelLabel ? c.channelLabel + ': ' : '') + title;
      const isChannel = !!c.channelOwner;
      const displayTitle = (c.channelLabel ? c.channelLabel + ': ' : '') + title;
      li.classList.toggle('active', c.id === currentChatId && (c.channelOwner || null) === currentChannelOwner);
      if (isChannel) {
        li.innerHTML = '<span class="chat-title">' + escapeHtml(displayTitle) + '</span>';
        li.querySelector('.chat-title').addEventListener('click', () => switchChat(c.id, c.channelOwner));
      } else {
        li.innerHTML = '<span class="chat-title">' + escapeHtml(title) + '</span><button type="button" class="chat-edit" title="Rename">✎</button><button type="button" class="chat-delete" title="Delete chat">×</button>';
        li.querySelector('.chat-title').addEventListener('click', () => switchChat(c.id, null));
        li.querySelector('.chat-edit').addEventListener('click', (e) => { e.stopPropagation(); startRenameChat(li, c.id, title); });
        li.querySelector('.chat-delete').addEventListener('click', (e) => { e.stopPropagation(); deleteChat(c.id); });
      }
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

  function switchChat(chatId, channelOwner) {
    currentChatId = chatId;
    currentChannelOwner = channelOwner || null;
    document.querySelectorAll('.chat-list li').forEach(li => {
      li.classList.toggle('active', li.dataset.chatId === chatId && (li.dataset.channelOwner || null) === currentChannelOwner);
    });
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
    if (!currentChatId || currentChannelOwner) return;
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
      currentChannelOwner = null;
      customInstructionsEl.value = '';
      await loadChats();
      document.querySelectorAll('.chat-list li').forEach(li => {
        li.classList.toggle('active', li.dataset.chatId === data.id && !li.dataset.channelOwner);
      });
      history = [];
      messagesEl.innerHTML = '';
    } catch (_) {}
  }

  async function loadChatHistory(chatId) {
    try {
      let url = chatId ? '/api/chat/history?chatId=' + encodeURIComponent(chatId) : '/api/chat/history';
      if (currentChannelOwner) url += '&username=' + encodeURIComponent(currentChannelOwner);
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
      list.forEach((msg, idx) => {
        const isError = msg.role === 'assistant' && msg.content && msg.content.startsWith('Error');
        const div = addMessage(msg.role, msg.content || '', isError, idx);
        if (msg.role === 'assistant' && msg.content) addCreateSkillButton(div, msg.content);
      });
      ensureRegenerateButton();
      applyMessageSearch();
    } catch (_) {}
  }

  function saveChatHistory() {
    const body = { messages: history, chatId: currentChatId };
    if (currentChannelOwner) body.username = currentChannelOwner;
    fetch('/api/chat/history', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).catch(() => {});
  }

  async function clearChat() {
    try {
      const body = currentChannelOwner ? { username: currentChannelOwner } : {};
      await fetch('/api/chat/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
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
    const ui = cfg.ui || {};
    uiSettings.showToolCalls = ui.showToolCalls !== false;
    uiSettings.promptLibrary = ui.promptLibrary !== false;
    document.getElementById('promptsBtn').style.display = uiSettings.promptLibrary ? '' : 'none';

    // Load AI avatar (if configured) and expose as CSS variable for assistant messages.
    try {
      const url = '/static/ai-avatar?ts=' + Date.now();
      const img = new Image();
      img.onload = function () {
        document.documentElement.style.setProperty('--ai-avatar-url', 'url("' + url.replace(/"/g, '\\"') + '")');
        document.documentElement.setAttribute('data-ai-avatar', '1');
      };
      img.onerror = function () {
        document.documentElement.style.removeProperty('--ai-avatar-url');
        document.documentElement.removeAttribute('data-ai-avatar');
      };
      img.src = url;
    } catch (_) {
      // ignore avatar load errors
    }
  }

  function addMessage(role, content, isError = false, explicitIndex) {
    const div = document.createElement('div');
    div.className = 'msg ' + (role === 'user' ? 'user' : isError ? 'error' : 'assistant');
    div.dataset.raw = content;
    const msgIndex = explicitIndex !== undefined ? explicitIndex : history.length; // index in history[]
    div.dataset.index = msgIndex;
    const meta = role === 'user' ? 'You' : (isError ? 'Error' : 'ShadowAI');
    const avatarHtml =
      role === 'user'
        ? '<span class="msg-avatar msg-avatar-user" aria-hidden="true"></span>'
        : (isError
            ? '<span class="msg-avatar msg-avatar-ai" aria-hidden="true"></span>'
            : '<span class="msg-avatar msg-avatar-ai" aria-hidden="true"></span>');
    const editBtn = role === 'user' ? '<button type="button" class="msg-edit" title="Edit message">Edit</button>' : '';
    const actions = '<div class="msg-actions"><button type="button" class="msg-copy" title="Copy">Copy</button>' + editBtn + '</div>';
    div.innerHTML =
      '<div class="meta">' + avatarHtml + '<span class="msg-meta-label">' + escapeHtml(meta) + '</span></div>' +
      '<div class="msg-body">' + formatContent(content) + '</div>' +
      actions;
    const copyBtn = div.querySelector('.msg-copy');
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(content || '').then(() => { copyBtn.textContent = 'Copied!'; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500); }).catch(() => {});
    });
    const editBtnEl = div.querySelector('.msg-edit');
    if (editBtnEl) {
      editBtnEl.addEventListener('click', () => startEditMessage(div));
    }
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function startEditMessage(div) {
    const msgBody = div.querySelector('.msg-body');
    const actions = div.querySelector('.msg-actions');
    if (!msgBody || div.querySelector('.msg-edit-area')) return; // already editing
    const rawContent = div.dataset.raw || '';

    const textarea = document.createElement('textarea');
    textarea.className = 'msg-edit-area';
    textarea.value = rawContent;
    msgBody.replaceWith(textarea);
    textarea.focus();
    textarea.select();

    // Replace action buttons with confirm/cancel
    const origActions = actions.innerHTML;
    actions.innerHTML =
      '<button type="button" class="msg-edit-confirm msg-copy">Confirm</button>' +
      '<button type="button" class="msg-edit-cancel msg-copy">Cancel</button>';

    actions.querySelector('.msg-edit-confirm').addEventListener('click', () => confirmEdit(div, textarea.value, origActions));
    actions.querySelector('.msg-edit-cancel').addEventListener('click', () => cancelEdit(div, rawContent, origActions));
  }

  function cancelEdit(div, originalContent, origActionsHTML) {
    const textarea = div.querySelector('.msg-edit-area');
    if (!textarea) return;
    const body = document.createElement('div');
    body.className = 'msg-body';
    body.innerHTML = formatContent(originalContent);
    textarea.replaceWith(body);
    div.querySelector('.msg-actions').innerHTML = origActionsHTML;
    // Re-attach event listeners
    const copyBtn = div.querySelector('.msg-copy');
    if (copyBtn) copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(originalContent || '').then(() => { copyBtn.textContent = 'Copied!'; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500); }).catch(() => {});
    });
    const editBtnEl = div.querySelector('.msg-edit');
    if (editBtnEl) editBtnEl.addEventListener('click', () => startEditMessage(div));
  }

  function confirmEdit(div, newContent, origActionsHTML) {
    const trimmed = newContent.trim();
    if (!trimmed) { cancelEdit(div, div.dataset.raw || '', origActionsHTML); return; }

    const index = parseInt(div.dataset.index, 10);

    // Restore the div's body
    const textarea = div.querySelector('.msg-edit-area');
    const body = document.createElement('div');
    body.className = 'msg-body';
    body.innerHTML = formatContent(trimmed);
    textarea.replaceWith(body);
    div.dataset.raw = trimmed;
    div.querySelector('.msg-actions').innerHTML = origActionsHTML;
    const copyBtn = div.querySelector('.msg-copy');
    if (copyBtn) copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(trimmed || '').then(() => { copyBtn.textContent = 'Copied!'; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500); }).catch(() => {});
    });
    const editBtnEl = div.querySelector('.msg-edit');
    if (editBtnEl) editBtnEl.addEventListener('click', () => startEditMessage(div));

    // Update history: replace message at index and truncate everything after
    history[index] = { role: 'user', content: trimmed };
    history = history.slice(0, index + 1);

    // Remove all DOM messages after this one
    const allMsgs = Array.from(messagesEl.querySelectorAll('.msg, .typing-indicator'));
    const thisIdx = allMsgs.indexOf(div);
    if (thisIdx >= 0) {
      allMsgs.slice(thisIdx + 1).forEach(el => el.remove());
    }

    ensureRegenerateButton();
    sendMessageOnly();
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

  /** Open http(s) links from chat markdown in a new browser tab/window. */
  function externalLinksOpenInNewWindow(html) {
    if (!html) return html;
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    wrap.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href) || /^\/\//.test(href)) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      }
    });
    return wrap.innerHTML;
  }

  function formatContent(text) {
    if (!text) return '';
    if (typeof marked !== 'undefined') {
      marked.setOptions({ gfm: true, breaks: true });
      const raw = marked.parse(text, { async: false });
      if (typeof DOMPurify !== 'undefined') {
        return externalLinksOpenInNewWindow(
          DOMPurify.sanitize(raw, { ALLOWED_TAGS: ['p','br','strong','em','code','pre','ul','ol','li','table','thead','tbody','tr','th','td','h1','h2','h3','h4','h5','h6','blockquote','a','span','div'], ALLOWED_ATTR: ['href','class'] })
        );
      }
      return externalLinksOpenInNewWindow(raw);
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
      const body = { messages: history, agentId, stream: true, chatId: currentChatId, customInstructions };
      if (currentChannelOwner) body.channelChatOwner = currentChannelOwner;
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
      const pendingToolBlocks = [];

      function addToolCallBlock(name, args, result, isError) {
        const block = document.createElement('div');
        block.className = 'tool-call-block';
        const argsStr = args && typeof args === 'object' && Object.keys(args).length
          ? JSON.stringify(args, null, 2)
          : '';
        block.innerHTML =
          '<div class="tool-call-summary">' +
          '<span class="tool-call-toggle">▶</span>' +
          '<span class="tool-call-badge">' + escapeHtml(name) + '</span>' +
          '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (isError ? '⚠ error' : escapeHtml(String(result || '').slice(0, 80))) + '</span>' +
          '</div>' +
          '<div class="tool-call-details" hidden>' +
          (argsStr ? '<div class="tool-call-label">ARGS</div><pre style="margin:0 0 6px;">' + escapeHtml(argsStr) + '</pre>' : '') +
          '<div class="tool-call-label">RESULT</div><pre style="margin:0;">' + escapeHtml(String(result || '')) + '</pre>' +
          '</div>';
        block.querySelector('.tool-call-summary').addEventListener('click', () => {
          const details = block.querySelector('.tool-call-details');
          const toggle = block.querySelector('.tool-call-toggle');
          details.hidden = !details.hidden;
          toggle.textContent = details.hidden ? '▶' : '▼';
        });
        return block;
      }

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
              if (data.toolResult && uiSettings.showToolCalls) {
                const block = addToolCallBlock(data.toolResult.name, data.toolResult.args, data.toolResult.result, data.toolResult.error);
                pendingToolBlocks.push(block);
                // Attach to typing indicator while waiting for response
                const typingContent = typingEl.querySelector('.typing-content');
                if (typingContent) typingContent.after(block);
              }
              if (data.content) {
                if (!msgDiv) {
                  typingEl.remove();
                  msgDiv = addMessage('assistant', '');
                  msgDiv.dataset.raw = '';
                  contentEl = msgDiv.querySelector('.msg-body');
                  // Move any pending tool blocks into the message, before msg-body
                  pendingToolBlocks.forEach(b => msgDiv.insertBefore(b, contentEl));
                  pendingToolBlocks.length = 0;
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
              if (data.tokenStats) {
                const el = document.getElementById('tokenStats');
                if (el) el.textContent = `↑${data.tokenStats.promptTokens.toLocaleString()} ↓${data.tokenStats.evalTokens.toLocaleString()} tokens`;
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
    if (trim.startsWith('/rag ')) {
      const query = trim.slice(5).trim();
      if (!query) {
        addMessage('assistant', 'Usage: /rag &lt;query&gt; — runs a retrieval search against the knowledge index. You can also start a normal message with #rag to include retrieval context in the answer.', true);
        return true;
      }
      const scope = currentChannelOwner && currentChannelOwner.indexOf('project_') === 0 ? 'project' : 'global';
      const body = {
        scope: scope,
        query: query
      };
      if (scope === 'project' && currentProjectId) body.projectId = currentProjectId;
      try {
        const res = await fetch('/api/rag/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          addMessage('assistant', data.error || 'RAG query failed.', true);
          return true;
        }
        const results = Array.isArray(data.results) ? data.results : [];
        if (results.length === 0) {
          addMessage('assistant', 'No RAG results found for: ' + query);
          history.push({ role: 'assistant', content: 'No RAG results found for: ' + query });
        } else {
          const lines = [];
          lines.push('RAG results for: ' + query);
          lines.push('');
          results.forEach(function (r, idx) {
            lines.push((idx + 1) + '. (score ' + (typeof r.score === 'number' ? r.score.toFixed(3) : '—') + ')');
            if (r.source) lines.push('   Source: ' + r.source);
            lines.push('   ' + (r.text || '').trim());
            lines.push('');
          });
          const text = lines.join('\n').trim();
          addMessage('assistant', text);
          history.push({ role: 'assistant', content: text });
        }
        saveChatHistory();
        onRunCommandDone();
      } catch (e) {
        addMessage('assistant', e.message || 'RAG query failed.', true);
      }
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

  // ---------- Prompt library ----------
  const promptsModal = document.getElementById('promptsModal');
  const promptsBtn = document.getElementById('promptsBtn');
  const promptsCloseBtn = document.getElementById('promptsCloseBtn');
  const savePromptBtn = document.getElementById('savePromptBtn');
  const promptsList = document.getElementById('promptsList');

  function renderPrompts(prompts) {
    if (!prompts.length) {
      promptsList.innerHTML = '<div class="prompts-empty">No saved prompts yet. Type something and click "Save current input as prompt".</div>';
      return;
    }
    promptsList.innerHTML = '';
    prompts.forEach(p => {
      const div = document.createElement('div');
      div.className = 'prompt-item';
      div.innerHTML = '<span class="prompt-item-title">' + escapeHtml(p.title) + '</span><button type="button" class="prompt-item-del" title="Delete">×</button>';
      div.querySelector('.prompt-item-title').addEventListener('click', () => {
        userInput.value = p.content;
        promptsModal.hidden = true;
      });
      div.querySelector('.prompt-item-del').addEventListener('click', async (e) => {
        e.stopPropagation();
        await fetch('/api/prompts/' + encodeURIComponent(p.id), { method: 'DELETE' });
        loadPrompts();
      });
      promptsList.appendChild(div);
    });
  }

  async function loadPrompts() {
    try {
      const res = await fetch('/api/prompts');
      if (!res.ok) return;
      renderPrompts(await res.json());
    } catch (_) {}
  }

  promptsBtn.addEventListener('click', () => {
    promptsModal.hidden = false;
    loadPrompts();
  });
  promptsCloseBtn.addEventListener('click', () => { promptsModal.hidden = true; });
  promptsModal.addEventListener('click', (e) => { if (e.target === promptsModal) promptsModal.hidden = true; });

  savePromptBtn.addEventListener('click', async () => {
    const content = userInput.value.trim();
    if (!content) return;
    const title = prompt('Prompt title:', content.slice(0, 60));
    if (!title) return;
    await fetch('/api/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content })
    });
    loadPrompts();
  });

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
  // Check for pending editor → chat transfer
  const _editorPending = sessionStorage.getItem('shadowai_editor_to_chat');
  if (_editorPending) {
    try {
      const { prompt } = JSON.parse(_editorPending);
      userInput.value = prompt;
    } catch (_) {}
    sessionStorage.removeItem('shadowai_editor_to_chat');
  }

  loadConfig();
  loadChats().then(() => loadChatHistory(currentChatId));
})();
